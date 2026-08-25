@file:Suppress("DEPRECATION")

package com.margelo.nitro.nitroimagepipeline.transform

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.renderscript.Allocation
import android.renderscript.Element
import android.renderscript.RenderScript
import android.renderscript.ScriptIntrinsicBlur
import androidx.core.graphics.applyCanvas
import androidx.core.graphics.scale
import coil3.size.Size
import coil3.transform.Transformation
import kotlin.math.ceil
import kotlin.math.max

/**
 * Gaussian blur of standard deviation [sigma], measured in *source image pixels*.
 *
 * The unit is the point of this class: the same sigma on the same source file produces the same
 * result here and on iOS. It is deliberately not a "radius" — RenderScript, CoreImage and React
 * Native's `blurRadius` each define radius differently, which is why blurs never matched across
 * platforms.
 *
 * For reference, React Native's `<Image blurRadius={n} />` halves its input before convolving, so
 * `blurRadius={n}` is roughly `sigma = n / 2`.
 */
class BlurTransformation(
    private val context: Context,
    private val sigma: Float,
) : Transformation() {

  init {
    require(sigma > 0f && sigma.isFinite()) { "sigma must be > 0." }
  }

  override val cacheKey = "${BlurTransformation::class.java.name}-$sigma"

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    // ScriptIntrinsicBlur's `radius` maps to a Gaussian sigma of 0.4 * radius + 0.6, and radius is
    // capped at 25 — so a single pass tops out at sigma ~10.6px. Larger blurs are reached by
    // blurring a downscaled copy: scaling down by `s`, blurring with sigma/s and scaling back up
    // multiplies the effective sigma by `s`. A blur is a low-pass filter, so the detail the
    // downscale drops is detail the blur was going to remove anyway. Downscale only as far as the
    // sigma ceiling forces, which keeps small blurs pixel-exact.
    val sampling = max(1f, sigma / MAX_SIGMA)
    val scaledWidth = ceil(input.width / sampling).toInt().coerceAtLeast(1)
    val scaledHeight = ceil(input.height / sampling).toInt().coerceAtLeast(1)
    // Rounding to whole pixels shifts the scale slightly; derive the sigma from the scale actually
    // applied rather than the requested one.
    val scaleX = scaledWidth.toFloat() / input.width
    val scaleY = scaledHeight.toFloat() / input.height
    val scaledSigma = sigma * max(scaleX, scaleY)
    val radius = ((scaledSigma - SIGMA_INTERCEPT) / SIGMA_SLOPE).coerceIn(MIN_RADIUS, MAX_RADIUS)

    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    val softwareInput =
        if (input.config == Bitmap.Config.HARDWARE) input.copy(Bitmap.Config.ARGB_8888, false)
        else input
    val softwareConfig = softwareInput.config ?: Bitmap.Config.ARGB_8888

    val output = Bitmap.createBitmap(scaledWidth, scaledHeight, softwareConfig)
    output.applyCanvas {
      scale(scaleX, scaleY)
      drawBitmap(softwareInput, 0f, 0f, paint)
    }

    var script: RenderScript? = null
    var tmpIn: Allocation? = null
    var tmpOut: Allocation? = null
    var blur: ScriptIntrinsicBlur? = null
    try {
      script = RenderScript.create(context)
      tmpIn =
          Allocation.createFromBitmap(
              script,
              output,
              Allocation.MipmapControl.MIPMAP_NONE,
              Allocation.USAGE_SCRIPT,
          )
      tmpOut = Allocation.createTyped(script, tmpIn.type)
      blur = ScriptIntrinsicBlur.create(script, Element.U8_4(script))
      blur.setRadius(radius)
      blur.setInput(tmpIn)
      blur.forEach(tmpOut)
      tmpOut.copyTo(output)
    } finally {
      script?.destroy()
      tmpIn?.destroy()
      tmpOut?.destroy()
      blur?.destroy()
    }

    return if (scaledWidth == input.width && scaledHeight == input.height) output
    else output.scale(input.width, input.height)
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is BlurTransformation && context == other.context && sigma == other.sigma
  }

  override fun hashCode(): Int = 31 * context.hashCode() + sigma.hashCode()

  override fun toString() = "BlurTransformation(sigma=$sigma)"

  private companion object {
    // sigma = 0.4 * radius + 0.6, per RenderScript's ScriptIntrinsicBlur.
    const val SIGMA_SLOPE = 0.4f
    const val SIGMA_INTERCEPT = 0.6f
    const val MIN_RADIUS = 0.01f
    const val MAX_RADIUS = 25f
    const val MAX_SIGMA = SIGMA_SLOPE * MAX_RADIUS + SIGMA_INTERCEPT
  }
}
