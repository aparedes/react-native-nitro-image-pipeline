package com.margelo.nitro.nitroimagepipeline.transform

import android.graphics.Bitmap
import android.os.Build
import coil3.size.Size
import coil3.transform.Transformation

/**
 * Uploads the transformed bitmap to a [Bitmap.Config.HARDWARE] bitmap (API 26+), so that is what
 * the memory cache holds and the view draws.
 *
 * Coil decodes straight to a hardware bitmap when a request has no transformations, but with any
 * (resize, blur, rounded corners) the decode and the transformations run on software bitmaps and
 * the software result is what gets cached. Every view showing it then costs a texture upload (and,
 * with the pixels kept for the bitmap, a copy in RAM). Appending this transformation converts the
 * result once, on the transformation thread, and it stays converted in the cache.
 *
 * A hardware bitmap's pixels are not readable, so this must only be added by callers that draw the
 * result — `PipelineImageLoader.requestImage` — never by `loadImage`, whose `HybridImage` needs
 * readable pixels for `toArrayBuffer`/`toBase64`. The extra cache key keeps the two paths' cache
 * entries apart.
 *
 * Below API 26, or if the upload fails, the software bitmap is passed through unchanged.
 */
class HardwareBitmapTransformation private constructor() : Transformation() {

  override val cacheKey = HardwareBitmapTransformation::class.java.name

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    if (!isSupported || input.config == Bitmap.Config.HARDWARE) return input
    return input.copy(Bitmap.Config.HARDWARE, false) ?: input
  }

  override fun toString() = "HardwareBitmapTransformation"

  companion object {
    val isSupported: Boolean
      get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

    val instance = HardwareBitmapTransformation()
  }
}
