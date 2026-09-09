package com.margelo.nitro.nitroimagepipeline.transform

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import coil3.size.Size
import coil3.transform.Transformation
import com.margelo.nitro.nitroimagepipeline.ResizeFit
import kotlin.math.max

/**
 * Resizes the input into a [width] × [height] pixel box under [fit] (see [FitGeometry] for the size
 * each mode produces). The default — [ResizeFit.COVER] with [allowUpscale] — scales the input to
 * fill the box exactly and center-crops the overflow (CSS `object-fit: cover`), upscaling smaller
 * sources, on the very same code path (and cache key) it had before `fit` existed, matching Nuke's
 * `ImageProcessors.Resize(contentMode: .aspectFill, crop: true)` on iOS. Every other fit runs
 * through [FitGeometry], matching iOS's `FitResizeProcessor`.
 *
 * It runs before [BlurTransformation] and rounded corners so their pixel units refer to the final
 * bitmap.
 */
class ResizeTransformation(
    private val width: Int,
    private val height: Int,
    private val fit: ResizeFit = ResizeFit.COVER,
    private val allowUpscale: Boolean = true,
) : Transformation() {

  init {
    require(width > 0 && height > 0) { "width and height must be > 0." }
  }

  private val isDefaultFit: Boolean
    get() = fit == ResizeFit.COVER && allowUpscale

  // The default keeps its original key so results cached by earlier versions stay valid.
  override val cacheKey = buildString {
    append(ResizeTransformation::class.java.name)
        .append('-')
        .append(width)
        .append('-')
        .append(height)
    if (fit != ResizeFit.COVER) append('-').append(fit.name.lowercase())
    if (!allowUpscale) append("-noupscale")
  }

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    val softwareInput =
        if (input.config == Bitmap.Config.HARDWARE) input.copy(Bitmap.Config.ARGB_8888, false)
        else input
    return if (isDefaultFit) cover(softwareInput) else fitted(softwareInput)
  }

  private fun cover(input: Bitmap): Bitmap {
    if (input.width == width && input.height == height) return input

    val scale = max(width.toFloat() / input.width, height.toFloat() / input.height)
    val matrix =
        Matrix().apply {
          setScale(scale, scale)
          postTranslate((width - input.width * scale) / 2f, (height - input.height * scale) / 2f)
        }
    return draw(input, width, height, matrix)
  }

  private fun fitted(input: Bitmap): Bitmap {
    val geometry = FitGeometry.of(input.width, input.height, width, height, fit, allowUpscale)
    // `center` of a source that fits the box, or `contain` without upscaling
    // of a small source: the bitmap is already the output.
    if (geometry.isIdentity) return input

    val matrix =
        Matrix().apply {
          // Scale to the rounded size exactly, so the drawn extent is whole pixels.
          setScale(
              geometry.scaledWidth.toFloat() / input.width,
              geometry.scaledHeight.toFloat() / input.height,
          )
          postTranslate(geometry.originX.toFloat(), geometry.originY.toFloat())
        }
    return draw(input, geometry.outputWidth, geometry.outputHeight, matrix)
  }

  private fun draw(input: Bitmap, outputWidth: Int, outputHeight: Int, matrix: Matrix): Bitmap {
    val config = input.config ?: Bitmap.Config.ARGB_8888
    val output = Bitmap.createBitmap(outputWidth, outputHeight, config)
    Canvas(output)
        .drawBitmap(input, matrix, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    return output
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is ResizeTransformation &&
        width == other.width &&
        height == other.height &&
        fit == other.fit &&
        allowUpscale == other.allowUpscale
  }

  override fun hashCode(): Int {
    var result = 31 * width + height
    result = 31 * result + fit.hashCode()
    result = 31 * result + allowUpscale.hashCode()
    return result
  }

  override fun toString() =
      "ResizeTransformation(width=$width, height=$height, fit=$fit, allowUpscale=$allowUpscale)"
}
