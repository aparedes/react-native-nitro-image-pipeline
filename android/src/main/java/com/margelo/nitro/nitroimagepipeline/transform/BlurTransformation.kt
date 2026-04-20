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

class BlurTransformation(
    private val context: Context,
    private val radius: Float = 10f,
    private val sampling: Float = 1f,
) : Transformation() {

  init {
    require(radius in 0.01..25.0) { "radius must be in (0, 25]." }
    require(sampling >= 1f) { "sampling must be >= 1." }
  }

  override val cacheKey = "${BlurTransformation::class.java.name}-$radius-$sampling"

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    // Auto-scale so the blurred image is at most 512px on the longest side.
    // Blur is a low-pass filter so blurring at lower resolution is identical in quality.
    val autoSampling = (maxOf(input.width, input.height) / 512f).coerceAtLeast(sampling)
    val scaledWidth = (input.width / autoSampling).toInt().coerceAtLeast(1)
    val scaledHeight = (input.height / autoSampling).toInt().coerceAtLeast(1)
    val softwareInput = if (input.config == Bitmap.Config.HARDWARE) input.copy(Bitmap.Config.ARGB_8888, false) else input
    val softwareConfig = softwareInput.config ?: Bitmap.Config.ARGB_8888

    val output = Bitmap.createBitmap(scaledWidth, scaledHeight, softwareConfig)
    output.applyCanvas {
      scale(1 / autoSampling, 1 / autoSampling)
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

    return output.scale(input.width, input.height)
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is BlurTransformation &&
        context == other.context &&
        radius == other.radius &&
        sampling == other.sampling
  }

  override fun hashCode(): Int {
    var result = context.hashCode()
    result = 31 * result + radius.hashCode()
    result = 31 * result + sampling.hashCode()
    return result
  }

  override fun toString() = "BlurTransformation(radius=$radius, sampling=$sampling)"
}
