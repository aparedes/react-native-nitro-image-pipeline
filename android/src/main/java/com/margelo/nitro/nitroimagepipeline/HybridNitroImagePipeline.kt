package com.margelo.nitro.nitroimagepipeline

import android.content.Context
import androidx.core.graphics.drawable.toBitmap
import coil3.BitmapImage
import coil3.DrawableImage
import coil3.ImageLoader
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
import com.margelo.nitro.nitroimagepipeline.transform.ResizeTransformation
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import org.chromium.net.CronetEngine

class HybridNitroImagePipeline : HybridNitroImagePipelineSpec() {
  private val context
    get() = NitroModules.applicationContext as Context

  private val imageLoader: ImageLoader
    get() = getOrCreateImageLoader(context)

  override fun loadImage(url: String, options: Options?): Promise<HybridImageSpec> = Promise.async {
    val blur = options?.blur?.toFloat() ?: 0f
    val resize =
        options?.resize?.let { r ->
          val width = r.width.roundToInt()
          val height = r.height.roundToInt()
          if (width > 0 && height > 0) width to height else null
        }
    val transformations = buildList {
      // Resize first: blur sigma and corner radii are in pixels of the bitmap
      // they run on, so they must see the final size.
      resize?.let { (width, height) -> add(ResizeTransformation(width, height)) }
      if (blur > 0f) add(BlurTransformation(context, blur))
      options?.cornerRadius?.match(
          first = { radius ->
            if (radius > 0.0) add(RoundedCornersTransformation(radius.toFloat()))
          },
          second = { radii ->
            // RoundedCornersTransformation rejects negative radii; treat them as square.
            val topLeft = (radii.topLeft?.toFloat() ?: 0f).coerceAtLeast(0f)
            val topRight = (radii.topRight?.toFloat() ?: 0f).coerceAtLeast(0f)
            val bottomLeft = (radii.bottomLeft?.toFloat() ?: 0f).coerceAtLeast(0f)
            val bottomRight = (radii.bottomRight?.toFloat() ?: 0f).coerceAtLeast(0f)
            if (topLeft > 0f || topRight > 0f || bottomLeft > 0f || bottomRight > 0f) {
              add(RoundedCornersTransformation(topLeft, topRight, bottomLeft, bottomRight))
            }
          },
      )
    }
    val request =
        ImageRequest.Builder(context)
            .data(url)
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

    when (val result = imageLoader.execute(request)) {
      is ErrorResult -> throw result.throwable
      is SuccessResult -> {
        val bitmap =
            when (val img = result.image) {
              is BitmapImage -> img.bitmap
              is DrawableImage -> img.drawable.toBitmap()
              else -> throw Error("Unsupported image type: ${img.javaClass.simpleName}")
            }
        HybridImage(bitmap)
      }
    }
  }

  override fun preLoadImage(url: String): Promise<Unit> = Promise.async {
    val request = ImageRequest.Builder(context).data(url).build()
    imageLoader.execute(request)
  }

  override fun preLoadImages(urls: Array<String>): Promise<Unit> = Promise.async {
    coroutineScope {
      urls
          .map { url ->
            async {
              val request = ImageRequest.Builder(context).data(url).build()
              imageLoader.execute(request)
            }
          }
          .awaitAll()
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
          val blurred =
              BlurTransformation(context, sigma).transform(hybridImage.bitmap, Size.ORIGINAL)
          HybridImage(blurred)
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

    private fun getOrCreateImageLoader(context: Context): ImageLoader =
        sharedImageLoader
            ?: synchronized(this) {
              sharedImageLoader ?: createImageLoader(context).also { sharedImageLoader = it }
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
