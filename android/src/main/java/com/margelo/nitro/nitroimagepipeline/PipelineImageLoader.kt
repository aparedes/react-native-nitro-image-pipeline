package com.margelo.nitro.nitroimagepipeline

import android.content.Context
import android.util.Log
import android.view.View
import android.widget.ImageView
import androidx.annotation.Keep
import coil3.request.ErrorResult
import coil3.request.SuccessResult
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.Promise
import com.margelo.nitro.image.HybridImage
import com.margelo.nitro.image.HybridImageLoaderSpec
import com.margelo.nitro.image.HybridImageSpec
import com.margelo.nitro.image.HybridImageView
import com.margelo.nitro.image.HybridNitroImageViewSpec
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * An `ImageLoader` (react-native-nitro-image) backed by the shared pipeline.
 *
 * `<NativeNitroImage image={loader} />` drives it entirely natively: the view calls [requestImage]
 * when it attaches to the window and [dropImage] when it detaches. The load runs at the view's
 * laid-out size with no JS round trips, and detaching cancels the request and releases the bitmap —
 * the decoded image stays in the shared memory/disk caches, so re-attaching (list recycling) is
 * instant.
 *
 * [ViewOptions] values are in points (dp); this class converts them to the pixel-based [Options] of
 * the shared request builder using the display density, so cache keys match an equivalent
 * `loadImage` call. View sizes are already physical pixels on Android, so only blur and corner
 * radii need scaling.
 */
@DoNotStrip
@Keep
class PipelineImageLoader(
    private val context: Context,
    private val url: String,
    private val options: ViewOptions?,
) : HybridImageLoaderSpec() {
  // Per-view in-flight work, keyed by the view's identity, so a loader shared
  // between several views cancels only the right request. Confined to the
  // main thread — the view calls requestImage/dropImage there.
  private val jobs = HashMap<HybridNitroImageViewSpec, Job>()
  private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  /** An explicit `resize` override (pixels), when set and valid. */
  private val explicitResize: ResizeOptions?
    get() = options?.resize?.takeIf { it.width > 0 && it.height > 0 }

  /**
   * The point-based [ViewOptions] as pixel-based [Options], resolved against the display [scale]
   * and the target size in pixels.
   */
  private fun pixelOptions(scale: Float, resize: ResizeOptions?): Options {
    val cornerRadius =
        options?.cornerRadius?.match(
            first = { radius -> Variant_Double_CornerRadii.create(radius * scale) },
            second = { radii ->
              Variant_Double_CornerRadii.create(
                  CornerRadii(
                      topLeft = radii.topLeft?.times(scale),
                      topRight = radii.topRight?.times(scale),
                      bottomLeft = radii.bottomLeft?.times(scale),
                      bottomRight = radii.bottomRight?.times(scale),
                  ))
            },
        )
    return Options(
        blur = options?.blur?.times(scale),
        cache = options?.cache,
        cornerRadius = cornerRadius,
        resize = resize,
    )
  }

  override fun loadImage(): Promise<HybridImageSpec> = Promise.async {
    // No view to measure here: use the explicit resize if given, and the
    // display density for the point-based options.
    val scale = context.resources.displayMetrics.density
    val request =
        HybridNitroImagePipeline.buildRequest(context, url, pixelOptions(scale, explicitResize))
    when (val result = HybridNitroImagePipeline.getOrCreateImageLoader(context).execute(request)) {
      is ErrorResult -> throw result.throwable
      is SuccessResult -> HybridImage(HybridNitroImagePipeline.bitmapOf(result))
    }
  }

  override fun requestImage(forView: HybridNitroImageViewSpec) {
    val view = forView as? HybridImageView ?: return
    val imageView = view.imageView
    jobs[forView]?.cancel()
    val job =
        mainScope.launch {
          // Views attach before they are laid out, so the size may not be
          // known yet — wait for the first non-empty layout.
          val resize = explicitResize ?: measuredSize(imageView)
          val scale = imageView.resources.displayMetrics.density
          val request =
              HybridNitroImagePipeline.buildRequest(context, url, pixelOptions(scale, resize))
          val loader = HybridNitroImagePipeline.getOrCreateImageLoader(context)
          val result = loader.execute(request)
          // Cancellation normally surfaces as a CancellationException at the
          // suspension point above, but make it explicit: a job that was
          // dropped or replaced while the result was in flight must never
          // touch the view.
          if (!isActive) return@launch
          when (result) {
            is SuccessResult -> imageView.setImageBitmap(HybridNitroImagePipeline.bitmapOf(result))
            is ErrorResult -> Log.w(TAG, "Failed to load $url", result.throwable)
          }
        }
    jobs[forView] = job
    job.invokeOnCompletion { if (jobs[forView] === job) jobs.remove(forView) }
  }

  override fun dropImage(forView: HybridNitroImageViewSpec) {
    val view = forView as? HybridImageView ?: return
    jobs.remove(forView)?.cancel()
    view.imageView.setImageDrawable(null)
  }

  /** The view's laid-out size in pixels, suspending until it has one. */
  private suspend fun measuredSize(view: ImageView): ResizeOptions {
    if (view.width > 0 && view.height > 0) {
      return ResizeOptions(view.width.toDouble(), view.height.toDouble())
    }
    return suspendCancellableCoroutine { continuation ->
      val listener =
          object : View.OnLayoutChangeListener {
            override fun onLayoutChange(
                v: View,
                left: Int,
                top: Int,
                right: Int,
                bottom: Int,
                oldLeft: Int,
                oldTop: Int,
                oldRight: Int,
                oldBottom: Int,
            ) {
              val width = right - left
              val height = bottom - top
              if (width > 0 && height > 0) {
                v.removeOnLayoutChangeListener(this)
                continuation.resume(ResizeOptions(width.toDouble(), height.toDouble()))
              }
            }
          }
      view.addOnLayoutChangeListener(listener)
      continuation.invokeOnCancellation { view.removeOnLayoutChangeListener(listener) }
    }
  }

  companion object {
    private const val TAG = "PipelineImageLoader"
  }
}
