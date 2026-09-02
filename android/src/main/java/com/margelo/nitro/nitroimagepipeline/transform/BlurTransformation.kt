package com.margelo.nitro.nitroimagepipeline.transform

import android.graphics.Bitmap
import android.graphics.Canvas
import coil3.size.Size
import coil3.transform.Transformation

/**
 * Gaussian blur of standard deviation [sigma], measured in *source image pixels*.
 *
 * The unit is the point of this class: the same sigma on the same source file produces the same
 * result here and on iOS. It is deliberately not a "radius" — CoreImage, RenderScript and React
 * Native's `blurRadius` each define radius differently, which is why blurs never matched across
 * platforms.
 *
 * The kernel is `android/src/main/cpp/GaussianBlur.cpp`, a port of the iOS one: three box-blur
 * passes whose widths are solved for the requested sigma, clamping at the image edges. There is no
 * upper bound on sigma and no downscaling — `bun run verify:blur` measures both kernels against
 * each other.
 *
 * For reference, React Native's `<Image blurRadius={n} />` halves its input before convolving, so
 * `blurRadius={n}` is roughly `sigma = n / 2`.
 */
class BlurTransformation(private val sigma: Float) : Transformation() {

  init {
    require(sigma > 0f && sigma.isFinite()) { "sigma must be > 0." }
  }

  override val cacheKey = "${BlurTransformation::class.java.name}-$sigma"

  override suspend fun transform(input: Bitmap, size: Size): Bitmap {
    // The kernel blurs in place, on premultiplied ARGB_8888 pixels. A plain
    // copy is the cheapest way to get a mutable bitmap of that layout — also
    // from a hardware bitmap, which a software canvas could not draw. Only a
    // non-premultiplied input goes through a canvas, which converts it.
    val output =
        if (
            input.config == Bitmap.Config.HARDWARE ||
                (input.config == Bitmap.Config.ARGB_8888 &&
                    (input.isPremultiplied || !input.hasAlpha()))
        ) {
          input.copy(Bitmap.Config.ARGB_8888, true) ?: error("Bitmap.copy returned null")
        } else {
          Bitmap.createBitmap(input.width, input.height, Bitmap.Config.ARGB_8888).also {
            Canvas(it).drawBitmap(input, 0f, 0f, null)
          }
        }
    check(nativeBlur(output, sigma)) { "Native blur failed (see logcat)." }
    return output
  }

  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    return other is BlurTransformation && sigma == other.sigma
  }

  override fun hashCode(): Int = sigma.hashCode()

  override fun toString() = "BlurTransformation(sigma=$sigma)"

  private companion object {
    init {
      // Nitro loads the library at module registration, but the transformation
      // must not depend on that order; loadLibrary is idempotent.
      System.loadLibrary("NitroImagePipeline")
    }

    /** Blurs [bitmap] (mutable ARGB_8888) in place. Returns false on failure. */
    @JvmStatic private external fun nativeBlur(bitmap: Bitmap, sigma: Float): Boolean
  }
}
