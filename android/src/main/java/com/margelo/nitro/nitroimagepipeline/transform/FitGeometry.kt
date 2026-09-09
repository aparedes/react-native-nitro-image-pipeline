package com.margelo.nitro.nitroimagepipeline.transform

import com.margelo.nitro.nitroimagepipeline.ResizeFit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The resize geometry both platforms implement — a port of `FitGeometry` in
 * `ios/FitResizeProcessor.swift`; `example/__tests__/fit-geometry.ts` is the copy the harness
 * checks both against. With a `w` × `h` source and a `W` × `H` box:
 * ```
 * cover   : sx = sy = max(W/w, H/h)
 * contain : sx = sy = min(W/w, H/h)
 * stretch : sx = W/w ; sy = H/h
 * center  : sx = sy = 1
 * if !allowUpscale: sx = min(sx, 1) ; sy = min(sy, 1)
 * scaled  = (round(w·sx), round(h·sy))
 * output  = (min(W, scaled.w), min(H, scaled.h))
 * origin  = trunc((output − scaled) / 2)        — a centred, whole-pixel crop
 * ```
 *
 * The source is drawn scaled to `scaled` at `origin` on an `output`-sized canvas. Rounding is
 * half-away-from-zero (`roundToInt()` here, `.rounded()` in Swift — identical for the positive
 * values involved), and the divisions are done in the same order in `Double` on both sides so the
 * two agree to the pixel.
 */
internal data class FitGeometry(
    val sourceWidth: Int,
    val sourceHeight: Int,
    val scaledWidth: Int,
    val scaledHeight: Int,
    val outputWidth: Int,
    val outputHeight: Int,
    val originX: Int,
    val originY: Int,
) {
  /**
   * Whether the source is already the output — nothing to draw. Both sizes are compared with the
   * *source*: `scaled == output` alone also holds for every plain downscale (nothing is cropped),
   * which is not an identity.
   */
  val isIdentity: Boolean
    get() =
        scaledWidth == sourceWidth &&
            scaledHeight == sourceHeight &&
            outputWidth == sourceWidth &&
            outputHeight == sourceHeight

  companion object {
    fun of(
        sourceWidth: Int,
        sourceHeight: Int,
        boxWidth: Int,
        boxHeight: Int,
        fit: ResizeFit,
        allowUpscale: Boolean,
    ): FitGeometry {
      val source = sourceWidth.toDouble() to sourceHeight.toDouble()
      val box = boxWidth.toDouble() to boxHeight.toDouble()
      var scaleX: Double
      var scaleY: Double
      when (fit) {
        ResizeFit.COVER -> {
          val scale = max(box.first / source.first, box.second / source.second)
          scaleX = scale
          scaleY = scale
        }
        ResizeFit.CONTAIN -> {
          val scale = min(box.first / source.first, box.second / source.second)
          scaleX = scale
          scaleY = scale
        }
        ResizeFit.STRETCH -> {
          scaleX = box.first / source.first
          scaleY = box.second / source.second
        }
        ResizeFit.CENTER -> {
          scaleX = 1.0
          scaleY = 1.0
        }
      }
      if (!allowUpscale) {
        scaleX = min(scaleX, 1.0)
        scaleY = min(scaleY, 1.0)
      }
      val scaledWidth = (source.first * scaleX).roundToInt().coerceAtLeast(1)
      val scaledHeight = (source.second * scaleY).roundToInt().coerceAtLeast(1)
      val outputWidth = min(boxWidth, scaledWidth)
      val outputHeight = min(boxHeight, scaledHeight)
      return FitGeometry(
          sourceWidth = sourceWidth,
          sourceHeight = sourceHeight,
          scaledWidth = scaledWidth,
          scaledHeight = scaledHeight,
          outputWidth = outputWidth,
          outputHeight = outputHeight,
          // Integer division truncates toward zero, like `.rounded(.towardZero)` on iOS.
          originX = (outputWidth - scaledWidth) / 2,
          originY = (outputHeight - scaledHeight) / 2,
      )
    }
  }
}
