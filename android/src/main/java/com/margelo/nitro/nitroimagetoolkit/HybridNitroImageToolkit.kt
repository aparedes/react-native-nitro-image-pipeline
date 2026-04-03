package com.margelo.nitro.nitroimagetoolkit

import android.content.Context
import coil3.BitmapImage
import coil3.DrawableImage
import coil3.request.ErrorResult
import coil3.request.SuccessResult
import androidx.core.graphics.drawable.toBitmap
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.request.transformations
import coil3.transform.RoundedCornersTransformation
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.image.HybridImage
import com.margelo.nitro.image.HybridImageSpec
import com.margelo.nitro.nitroimagetoolkit.transform.BlurTransformation
import okio.Path.Companion.toOkioPath

class HybridNitroImageToolkit: HybridNitroImageToolkitSpec() {
    private val context get() = NitroModules.Companion.applicationContext as Context
    private val imageLoader: ImageLoader by lazy {
        ImageLoader.Builder(context)
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizePercent(context, 0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("nitro_image_cache").toOkioPath())
                    .maxSizeBytes(256L * 1024 * 1024)
                    .build()
            }
            .build()
    }



    override fun loadImage(
        url: String,
        options: Options?
    ): Promise<HybridImageSpec> = Promise.Companion.async {
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
        val request = ImageRequest.Builder(context)
            .data(url)
            .allowHardware(true)
            .memoryCacheKey(memoryCacheKey)
            .transformations(transformations)
            .build()

        val result = imageLoader.execute(request)
        when (result) {
            is ErrorResult -> throw result.throwable
            is SuccessResult -> {
                val bitmap = when (val img = result.image) {
                    is BitmapImage -> img.bitmap
                    is DrawableImage -> img.drawable.toBitmap()
                    else -> throw Error("Unsupported image type: ${img.javaClass.simpleName}")
                }
                HybridImage(bitmap)
            }
        }
    }

    override fun preLoadImage(url: String): Promise<Unit> = Promise.Companion.async {
        val request = ImageRequest.Builder(context).data(url).build()
        imageLoader.execute(request)
    }

    override fun preLoadImages(urls: Array<String>): Promise<Unit> = Promise.Companion.async {
        for (url in urls) {
            val request = ImageRequest.Builder(context).data(url).build()
            imageLoader.execute(request)
        }
    }

    override fun gaussianBlur(
        image: HybridImageSpec,
        radius: Double
    ): Promise<HybridImageSpec> {
        TODO("Not yet implemented")
    }

    override fun clearCache() {
        TODO("Not yet implemented")
    }
}