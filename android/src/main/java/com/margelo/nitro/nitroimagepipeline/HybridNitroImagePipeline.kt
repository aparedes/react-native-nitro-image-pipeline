package com.margelo.nitro.nitroimagepipeline

import android.content.Context
import androidx.core.graphics.drawable.toBitmap
import coil3.BitmapImage
import coil3.DrawableImage
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.request.transformations
import coil3.size.Size
import coil3.transform.RoundedCornersTransformation
import com.google.net.cronet.okhttptransport.CronetInterceptor
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.image.HybridImage
import com.margelo.nitro.image.HybridImageSpec
import com.margelo.nitro.nitroimagepipeline.transform.BlurTransformation
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import org.chromium.net.CronetEngine

class HybridNitroImagePipeline : HybridNitroImagePipelineSpec() {
  private val context
    get() = NitroModules.applicationContext as Context

  private val okHttpClient: OkHttpClient by lazy {
    val builder = OkHttpClient.Builder()
    try {
      val cronetEngine = CronetEngine.Builder(context).build()
      builder.addInterceptor(CronetInterceptor.newBuilder(cronetEngine).build())
    } catch (_: Exception) {
      // Cronet unavailable (no GMS or unsupported device) — use plain OkHttp
    }
    builder.build()
  }

  private val imageLoader: ImageLoader by lazy {
    ImageLoader.Builder(context)
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

  override fun loadImage(url: String, options: Options?): Promise<HybridImageSpec> =
      Promise.async {
        val blur = options?.blur?.toFloat() ?: 0f
        val cornerRadius = options?.cornerRadius?.toFloat() ?: 0f
        val transformations = buildList {
          if (blur > 0f) add(BlurTransformation(context, blur))
          if (cornerRadius > 0f) add(RoundedCornersTransformation(cornerRadius))
        }
        val memoryCacheKey = buildString {
          append(url)
          if (blur > 0f) append("_blur$blur")
          if (cornerRadius > 0f) append("_corner$cornerRadius")
        }
        val request =
            ImageRequest.Builder(context)
                .data(url)
                .allowHardware(true)
                .memoryCacheKey(memoryCacheKey)
                .transformations(transformations)
                .build()

        val result = imageLoader.execute(request)
        when (result) {
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

  override fun preLoadImage(url: String): Promise<Unit> =
      Promise.async {
        val request = ImageRequest.Builder(context).data(url).build()
        imageLoader.execute(request)
      }

  override fun preLoadImages(urls: Array<String>): Promise<Unit> =
      Promise.async {
        for (url in urls) {
          val request = ImageRequest.Builder(context).data(url).build()
          imageLoader.execute(request)
        }
      }

  override fun gaussianBlur(image: HybridImageSpec, radius: Double): Promise<HybridImageSpec> =
      Promise.async {
        val hybridImage = image as? HybridImage ?: throw Error("Image is not a HybridImage")
        val clampedRadius = radius.toFloat().coerceIn(0.01f, 25f)
        val blurred =
            BlurTransformation(context, clampedRadius).transform(hybridImage.bitmap, Size.ORIGINAL)
        HybridImage(blurred)
      }

  override fun clearCache() {
    imageLoader.memoryCache?.clear()
    imageLoader.diskCache?.clear()
  }
}
