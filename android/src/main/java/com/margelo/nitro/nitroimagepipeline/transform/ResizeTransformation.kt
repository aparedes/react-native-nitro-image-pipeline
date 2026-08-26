package com.margelo.nitro.nitroimagepipeline.transform

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import coil3.size.Size
import coil3.transform.Transformation
import kotlin.math.max

/**
 * Scales the input to fill exactly [width] × [height] pixels and center-crops the overflow (CSS
 * `object-fit: cover`), upscaling smaller sources. It runs before [BlurTransformation] and rounded
 * corners so their pixel units refer to the final bitmap — matching Nuke's
 * `ImageProcessors.Resize(contentMode: .aspectFill, crop: true)` on iOS.
 */
class ResizeTransformation(
    private val width: Int,
    private val height: Int,
) : Transformation() {

  init {
    require(width > 0 && height > 0) { "width and height must be > 0." }
  }

  override val cacheKey = "${ResizeTransformation::class.java.name}-$width-$height"

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    val softwareInput =
        if (input.config == Bitmap.Config.HARDWARE) input.copy(Bitmap.Config.ARGB_8888, false)
        else input
    if (softwareInput.width == width && softwareInput.height == height) return softwareInput

    val scale = max(width.toFloat() / softwareInput.width, height.toFloat() / softwareInput.height)
    val matrix =
        Matrix().apply {
          setScale(scale, scale)
          postTranslate(
              (width - softwareInput.width * scale) / 2f,
              (height - softwareInput.height * scale) / 2f,
          )
        }
    val config = softwareInput.config ?: Bitmap.Config.ARGB_8888
    val output = Bitmap.createBitmap(width, height, config)
    Canvas(output)
        .drawBitmap(softwareInput, matrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    return output
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is ResizeTransformation && width == other.width && height == other.height
  }

  override fun hashCode(): Int = 31 * width + height

  override fun toString() = "ResizeTransformation(width=$width, height=$height)"
}
