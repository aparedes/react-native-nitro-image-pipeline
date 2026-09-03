package com.margelo.nitro.nitroimagepipeline

import android.content.Context
import android.graphics.Bitmap
import androidx.core.graphics.drawable.toBitmap
import androidx.core.net.toUri
import coil3.BitmapImage
import coil3.ColorImage
import coil3.DrawableImage
import coil3.ImageLoader
import coil3.decode.DecodeResult
import coil3.decode.Decoder
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.CachePolicy
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.request.transformations
import coil3.size.Scale
import coil3.size.Size
import coil3.transform.RoundedCornersTransformation
import com.google.net.cronet.okhttptransport.CronetInterceptor
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.image.HybridImage
import com.margelo.nitro.image.HybridImageSpec
import com.margelo.nitro.nitroimagepipeline.transform.BlurTransformation
import com.margelo.nitro.nitroimagepipeline.transform.HardwareBitmapTransformation
import com.margelo.nitro.nitroimagepipeline.transform.ResizeTransformation
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import org.chromium.net.CronetEngine

class HybridNitroImagePipeline : HybridNitroImagePipelineSpec() {
  private val context
    get() = NitroModules.applicationContext as Context

  private val imageLoader: ImageLoader
    get() = getOrCreateImageLoader(context)

  init {
    // Build the shared loader now, on a background thread, instead of on
    // whichever thread the first request happens to run on. Creating it
    // builds a CronetEngine, an OkHttpClient and the disk cache — well over
    // a frame's worth of work — and the first `PipelineImageLoader` request
    // would otherwise do that on the main thread.
    (NitroModules.applicationContext as? Context)?.let { warmUpImageLoader(it) }
  }

  override fun loadImage(url: String, options: Options?): Promise<HybridImageSpec> = Promise.async {
    when (val result = imageLoader.execute(buildRequest(context, url, options))) {
      is ErrorResult -> throw result.throwable
      is SuccessResult -> HybridImage(bitmapOf(result))
    }
  }

  override fun createImageLoader(
      url: String,
      options: ViewOptions?,
  ): com.margelo.nitro.image.HybridImageLoaderSpec = PipelineImageLoader(context, url, options)

  // Preloading warms the disk cache only: the memory cache is skipped and the
  // decode step is replaced with a no-op (Coil's documented preload pattern),
  // so prefetching N URLs costs network + disk I/O instead of N full-resolution
  // bitmaps on the heap. The image is decoded — subsampled to the requested
  // size — only when a loadImage actually displays it.
  private fun preloadRequest(url: String): ImageRequest =
      ImageRequest.Builder(context)
          .data(requestData(context, url))
          .memoryCachePolicy(CachePolicy.DISABLED)
          .decoderFactory { _, _, _ -> Decoder { DecodeResult(ColorImage(), false) } }
          .build()

  override fun preLoadImage(url: String): Promise<Unit> = Promise.async {
    imageLoader.execute(preloadRequest(url))
  }

  override fun preLoadImages(urls: Array<String>): Promise<Unit> = Promise.async {
    coroutineScope {
      urls.map { url -> async { imageLoader.execute(preloadRequest(url)) } }.awaitAll()
    }
    Unit
  }

  override fun gaussianBlur(image: HybridImageSpec, radius: Double): Promise<HybridImageSpec> =
      Promise.async {
        val hybridImage = image as? HybridImage ?: throw Error("Image is not a HybridImage")
        // `radius` is a Gaussian sigma in source-image pixels — see BlurTransformation.
        val sigma = radius.toFloat()
        if (sigma <= 0f) {
          hybridImage
        } else {
          val blurred = BlurTransformation(sigma).transform(hybridImage.bitmap, Size.ORIGINAL)
          HybridImage(blurred)
        }
      }

  override fun setMemoryCacheLimit(bytes: Double) {
    require(bytes >= 0 && bytes.isFinite()) {
      "Memory cache limit must be a non-negative, finite number of bytes (got $bytes)"
    }
    imageLoader.memoryCache?.apply {
      maxSize = bytes.toLong()
      // Setting maxSize only affects future inserts; evict down to it now so
      // the call frees memory immediately.
      trimToSize(bytes.toLong())
    }
  }

  override fun clearCache(): Promise<Unit> = Promise.async {
    imageLoader.memoryCache?.clear()
    // DiskCache.clear() does file I/O; keep it off the JS thread but await
    // completion so callers can rely on the cache being empty, and so an
    // IOException rejects the promise instead of crashing the process.
    withContext(Dispatchers.IO) { imageLoader.diskCache?.clear() }
  }

  companion object {
    // Coil requires a single DiskCache instance per directory, so the loader
    // must be shared across all HybridNitroImagePipeline instances.
    @Volatile private var sharedImageLoader: ImageLoader? = null

    /**
     * The [ImageRequest] for [url] with [options] applied — shared by [loadImage] and
     * [PipelineImageLoader] so both hit the same caches with identical cache keys.
     *
     * With [hardwareResult], a transformed result is converted to a hardware bitmap before it is
     * cached (see [HardwareBitmapTransformation]). Only for callers that draw the result: its
     * pixels cannot be read back, and its cache key differs from the software one.
     */
    internal fun buildRequest(
        context: Context,
        url: String,
        options: Options?,
        hardwareResult: Boolean = false,
    ): ImageRequest {
      val blur = options?.blur?.toFloat() ?: 0f
      val resize =
          options?.resize?.let { r ->
            val width = r.width.roundToInt()
            val height = r.height.roundToInt()
            if (width > 0 && height > 0) width to height else null
          }
      val roundedCorners: RoundedCornersTransformation? =
          options
              ?.cornerRadius
              ?.match(
                  first = { radius ->
                    if (radius > 0.0) RoundedCornersTransformation(radius.toFloat()) else null
                  },
                  second = { radii ->
                    // RoundedCornersTransformation rejects negative radii; treat them as square.
                    val topLeft = (radii.topLeft?.toFloat() ?: 0f).coerceAtLeast(0f)
                    val topRight = (radii.topRight?.toFloat() ?: 0f).coerceAtLeast(0f)
                    val bottomLeft = (radii.bottomLeft?.toFloat() ?: 0f).coerceAtLeast(0f)
                    val bottomRight = (radii.bottomRight?.toFloat() ?: 0f).coerceAtLeast(0f)
                    if (topLeft > 0f || topRight > 0f || bottomLeft > 0f || bottomRight > 0f) {
                      RoundedCornersTransformation(topLeft, topRight, bottomLeft, bottomRight)
                    } else {
                      null
                    }
                  },
              )
      val transformations = buildList {
        // Resize first: blur sigma and corner radii are in pixels of the bitmap
        // they run on, so they must see the final size. Coil's
        // RoundedCornersTransformation already scale-fills and center-crops
        // to the request size (`resize`, when set) as part of its own draw,
        // so with rounded corners and no blur the explicit resize would only
        // add an intermediate bitmap — and the radii still apply to the final
        // size, because that is the size its output has.
        if (resize != null && (blur > 0f || roundedCorners == null)) {
          add(ResizeTransformation(resize.first, resize.second))
        }
        if (blur > 0f) add(BlurTransformation(blur))
        roundedCorners?.let { add(it) }
        // Without transformations Coil decodes straight to a hardware bitmap
        // already (allowHardware below); only a transformed result needs the
        // explicit upload.
        if (hardwareResult && isNotEmpty() && HardwareBitmapTransformation.isSupported) {
          add(HardwareBitmapTransformation.instance)
        }
      }
      return ImageRequest.Builder(context)
          .data(requestData(context, url))
          .apply {
            when (options?.cache) {
              CacheOption.MEMORY -> {
                memoryCachePolicy(CachePolicy.ENABLED)
                diskCachePolicy(CachePolicy.DISABLED)
              }
              CacheOption.DISK -> {
                memoryCachePolicy(CachePolicy.DISABLED)
                diskCachePolicy(CachePolicy.ENABLED)
              }
              CacheOption.NONE -> {
                memoryCachePolicy(CachePolicy.DISABLED)
                diskCachePolicy(CachePolicy.DISABLED)
              }
              null -> Unit // Coil defaults: both enabled
            }
            // Ask the decoder for the target size so a large source is
            // subsampled near it instead of decoded at full resolution;
            // ResizeTransformation then makes the size exact.
            resize?.let { (width, height) ->
              size(width, height)
              scale(Scale.FILL)
            }
          }
          .allowHardware(true)
          .transformations(transformations)
          .build()
    }

    /**
     * What Coil should load for [url]. Coil itself handles `http(s)://`, `file://`, `content://`
     * and plain absolute paths. The one form it doesn't is a bare resource name — a string with
     * no scheme, like `src_assets_logo` — which is what React Native's `require()` resolves to
     * in a release build (assets are packed into `res/drawable-*`). Resolve that to the resource
     * id here; the density-qualified variant is then picked by the resources system, like
     * `<Image>` does. An unknown name is passed through so Coil reports the failure as an
     * [ErrorResult] (the loaders must not throw while building a request).
     */
    internal fun requestData(context: Context, url: String): Any {
      if (url.startsWith("/") || url.toUri().scheme != null) return url
      // Tolerate `logo.png`: RN's generated names carry no extension, but nitro-image's
      // `{ resource: 'logo.png' }` convention does.
      val name = url.substringBefore('.')
      for (type in RESOURCE_TYPES) {
        val id = context.resources.getIdentifier(name, type, context.packageName)
        if (id != 0) return id
      }
      return url
    }

    /** Where React Native puts bundled image assets, then the other image resource types. */
    private val RESOURCE_TYPES = arrayOf("drawable", "mipmap", "raw")

    /** The decoded bitmap of a successful load. */
    internal fun bitmapOf(result: SuccessResult): Bitmap =
        when (val img = result.image) {
          is BitmapImage -> img.bitmap
          is DrawableImage -> img.drawable.toBitmap()
          else -> throw Error("Unsupported image type: ${img.javaClass.simpleName}")
        }

    internal fun getOrCreateImageLoader(context: Context): ImageLoader =
        sharedImageLoader
            ?: synchronized(this) {
              sharedImageLoader ?: createImageLoader(context).also { sharedImageLoader = it }
            }

    /**
     * The shared loader, creating it on [Dispatchers.IO] if it doesn't exist yet. Use this from
     * main-thread coroutines: once the loader exists this returns synchronously (so memory-cache
     * hits stay synchronous), and until then the expensive creation runs off the main thread.
     */
    internal suspend fun awaitImageLoader(context: Context): ImageLoader =
        sharedImageLoader ?: withContext(Dispatchers.IO) { getOrCreateImageLoader(context) }

    /** Starts creating the shared loader on a background thread, if it doesn't exist yet. */
    private fun warmUpImageLoader(context: Context) {
      if (sharedImageLoader != null) return
      CoroutineScope(Dispatchers.IO).launch {
        // Warm-up only: an uncaught exception here would take the process
        // down. If creation fails, `sharedImageLoader` stays null and the
        // next request retries it and surfaces the error itself.
        runCatching { getOrCreateImageLoader(context) }
      }
    }

    private fun createImageLoader(context: Context): ImageLoader {
      val okHttpClient =
          OkHttpClient.Builder()
              .apply {
                try {
                  val cronetEngine = CronetEngine.Builder(context).build()
                  addInterceptor(CronetInterceptor.newBuilder(cronetEngine).build())
                } catch (_: Exception) {
                  // Cronet unavailable (no GMS or unsupported device) — use plain OkHttp
                }
              }
              .build()

      return ImageLoader.Builder(context)
          .components { add(OkHttpNetworkFetcherFactory(callFactory = okHttpClient)) }
          .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.25).build() }
          .diskCache {
            DiskCache.Builder()
                .directory(context.cacheDir.resolve("nitro_image_cache").toOkioPath())
                .maxSizeBytes(256L * 1024 * 1024)
                .build()
          }
          .build()
    }
  }
}
