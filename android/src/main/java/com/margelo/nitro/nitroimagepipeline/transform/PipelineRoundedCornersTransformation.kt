package com.margelo.nitro.nitroimagepipeline.transform

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import coil3.size.Size
import coil3.transform.Transformation
import kotlin.math.min

/**
 * Rounds the corners of the input **at its own size**, in pixels of that bitmap — a port of
 * `ios/RoundedCornersProcessor.swift`, including its CSS-style clamping of radii that overlap.
 *
 * Coil's own `RoundedCornersTransformation` scale-fills and crops its input to the *request* size
 * as part of its draw. That is right for the default resize (the request size is the output size)
 * and is why [ResizeTransformation] is skipped for "rounded corners, no blur" there. Under any
 * other fit the request size is only the box — a `contain` or `center` bitmap is smaller — so
 * Coil's transformation would scale the result back up to the box. This one leaves the size alone.
 */
class PipelineRoundedCornersTransformation(
    topLeft: Float,
    topRight: Float,
    bottomLeft: Float,
    bottomRight: Float,
) : Transformation() {
  // Negative radii would make the path undefined; treat them as square.
  private val topLeft = topLeft.coerceAtLeast(0f)
  private val topRight = topRight.coerceAtLeast(0f)
  private val bottomLeft = bottomLeft.coerceAtLeast(0f)
  private val bottomRight = bottomRight.coerceAtLeast(0f)

  override val cacheKey =
      "${PipelineRoundedCornersTransformation::class.java.name}-$topLeft-$topRight-$bottomLeft-$bottomRight"

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    val softwareInput =
        if (input.config == Bitmap.Config.HARDWARE) input.copy(Bitmap.Config.ARGB_8888, false)
        else input
    val width = softwareInput.width
    val height = softwareInput.height
    if (width <= 0 || height <= 0) return softwareInput

    // Clamp the way CSS `border-radius` does: if two radii on one edge
    // overlap, all four scale down proportionally until they fit.
    var scale = 1f
    for ((edge, pair) in
        listOf(
            width to topLeft + topRight,
            width to bottomLeft + bottomRight,
            height to topLeft + bottomLeft,
            height to topRight + bottomRight,
        )) {
      if (pair > edge) scale = min(scale, edge / pair)
    }
    val tl = topLeft * scale
    val tr = topRight * scale
    val bl = bottomLeft * scale
    val br = bottomRight * scale

    val path =
        Path().apply {
          addRoundRect(
              RectF(0f, 0f, width.toFloat(), height.toFloat()),
              // x/y radius pairs, clockwise from the top-left corner.
              floatArrayOf(tl, tl, tr, tr, br, br, bl, bl),
              Path.Direction.CW,
          )
        }
    val paint =
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
          shader = BitmapShader(softwareInput, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        }
    // Always ARGB_8888: the corners need an alpha channel whatever the input has.
    val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Canvas(output).drawPath(path, paint)
    return output
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is PipelineRoundedCornersTransformation &&
        topLeft == other.topLeft &&
        topRight == other.topRight &&
        bottomLeft == other.bottomLeft &&
        bottomRight == other.bottomRight
  }

  override fun hashCode(): Int {
    var result = topLeft.hashCode()
    result = 31 * result + topRight.hashCode()
    result = 31 * result + bottomLeft.hashCode()
    result = 31 * result + bottomRight.hashCode()
    return result
  }

  override fun toString() =
      "PipelineRoundedCornersTransformation(topLeft=$topLeft, topRight=$topRight, " +
          "bottomLeft=$bottomLeft, bottomRight=$bottomRight)"
}
