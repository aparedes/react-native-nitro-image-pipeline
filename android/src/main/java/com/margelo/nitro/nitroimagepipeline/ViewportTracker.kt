package com.margelo.nitro.nitroimagepipeline

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * Tells views whether they are near the visible part of their window, so their images can be
 * released while they are far off-screen and loaded again before they scroll back in.
 *
 * Detaching already releases an image, but a lot of off-screen views stay attached: every cell of a
 * `ScrollView` grid, a `FlatList` without `removeClippedSubviews`, a horizontal carousel inside a
 * vertical list. Each of those would otherwise keep its bitmap for as long as it is mounted.
 *
 * "Near" means within [ENTER_MARGIN] window sizes of the window on any side; a near view only
 * counts as far again once it is more than [EXIT_MARGIN] away, so a view sitting on the edge
 * doesn't flip on every scroll event.
 *
 * Scrolls and layouts are checked right away. A move by anything else — a transform, a
 * native-driver animation — is checked within [DRAW_CHECK_DELAY_MS] of the frame that drew it, at
 * most that often while frames keep coming, and never while nothing draws. The same check corrects
 * a first decision `track()` made before the view's final position was applied. Known limits: a
 * skew is applied through `View.setAnimationMatrix`, which `getLocationInWindow` doesn't see (and
 * RN then also zeroes the translation), so a skewed view is judged at its untransformed position;
 * and the extent tested is the untransformed size, so a scaled view is judged by its unscaled size,
 * which the one-window margin absorbs.
 *
 * One tracker per window, with a single scroll, layout and pre-draw listener for all of its views,
 * so a hundred images cost one pass over a hundred positions per scroll event rather than a hundred
 * listeners. Main thread only.
 */
internal class ViewportTracker private constructor(root: View) {
  /** What a view's current owner does when the view comes near or goes far. */
  class Entry(val onNear: () -> Unit, val onFar: () -> Unit, val onReplaced: () -> Unit) {
    internal var near = false
    // Remembered rather than looked up again: once a view is detached its rootView is no longer
    // the window's, and untracking must still find it.
    internal var tracker: ViewportTracker? = null
  }

  // Weak: the tracker lives in [trackers], keyed weakly by this same root.
  private val root = WeakReference(root)
  private val entries = LinkedHashMap<View, Entry>()
  private val snapshot = ArrayList<Map.Entry<View, Entry>>()
  private val location = IntArray(2)
  private var observer: ViewTreeObserver? = null
  // Whether [drawCheck] is posted. Cleared by every update(), whatever ran it.
  private var drawCheckPending = false

  private val scrollListener = ViewTreeObserver.OnScrollChangedListener { update() }
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { update() }
  private val drawCheck = Runnable { update() }
  // A transform (translation, scale, rotation — what RN's `transform` and native-driver
  // animations set) moves a view without a scroll or a layout, but every frame showing the move
  // is drawn. Checking on each of those frames would multiply update()'s cost by the frame rate,
  // so a drawn frame only schedules one check, at most DRAW_CHECK_DELAY_MS later, unless one is
  // already pending — and every update() cancels it, having just seen the latest positions. So
  // the last frame of any move is always checked, a scroll frame costs no extra pass (its scroll
  // update runs after pre-draw and cancels the check), and a layout-only frame costs one trailing
  // pass (its layout update runs before pre-draw). It also corrects a first decision made against a
  // not-yet-final position. Never cancels the frame.
  private val drawListener = ViewTreeObserver.OnPreDrawListener {
    if (!drawCheckPending) {
      drawCheckPending = true
      mainHandler.postDelayed(drawCheck, DRAW_CHECK_DELAY_MS)
    }
    true
  }

  private fun track(view: View, entry: Entry) {
    // A view shows one image at a time: a new owner (the view was given another loader) replaces
    // the old one, which must never touch the view again.
    entries
        .put(view, entry)
        ?.takeIf { it !== entry }
        ?.let {
          it.tracker = null
          it.onReplaced()
        }
    entry.tracker = this
    if (observer == null) {
      observer =
          view.viewTreeObserver.also {
            it.addOnScrollChangedListener(scrollListener)
            it.addOnGlobalLayoutListener(layoutListener)
            it.addOnPreDrawListener(drawListener)
          }
    }
    entry.near = isNear(view, ENTER_MARGIN)
    if (entry.near) entry.onNear() else entry.onFar()
  }

  private fun untrack(view: View, entry: Entry) {
    entry.tracker = null
    if (entries[view] !== entry) return
    entries.remove(view)
    if (entries.isEmpty()) {
      observer
          ?.takeIf { it.isAlive }
          ?.let {
            it.removeOnScrollChangedListener(scrollListener)
            it.removeOnGlobalLayoutListener(layoutListener)
            it.removeOnPreDrawListener(drawListener)
          }
      // Even when the observer is dead: a check posted before it died must not outlive the entries.
      mainHandler.removeCallbacks(drawCheck)
      drawCheckPending = false
      observer = null
      root.get()?.let { trackers.remove(it) }
    }
  }

  private fun update() {
    // Whatever triggered this pass, it sees the latest positions: a pending draw check is
    // redundant.
    if (drawCheckPending) {
      drawCheckPending = false
      mainHandler.removeCallbacks(drawCheck)
    }
    // A snapshot: the callbacks start or cancel loads, which may re-enter track/untrack.
    snapshot.addAll(entries.entries)
    try {
      for ((view, entry) in snapshot) {
        if (entries[view] !== entry || !view.isAttachedToWindow) continue
        if (entry.near) {
          if (!isNear(view, EXIT_MARGIN)) {
            entry.near = false
            entry.onFar()
          }
        } else if (isNear(view, ENTER_MARGIN)) {
          entry.near = true
          entry.onNear()
        }
      }
    } finally {
      snapshot.clear()
    }
  }

  /** Whether [view] overlaps the window grown by [margin] window sizes on every side. */
  private fun isNear(view: View, margin: Float): Boolean {
    val root = root.get() ?: return true
    val width = root.width
    val height = root.height
    // The window isn't laid out yet: nothing is known to be far.
    if (width == 0 || height == 0) return true
    view.getLocationInWindow(location)
    val marginX = width * margin
    val marginY = height * margin
    val left = location[0]
    val top = location[1]
    return left + view.width > -marginX &&
        left < width + marginX &&
        top + view.height > -marginY &&
        top < height + marginY
  }

  companion object {
    /** A far view counts as near once it is within this many window sizes of the window. */
    const val ENTER_MARGIN = 1f

    /** A near view counts as far once it is more than this many window sizes away. */
    const val EXIT_MARGIN = 1.5f

    /** At most this long after a drawn frame, positions are checked again (see drawListener). */
    const val DRAW_CHECK_DELAY_MS = 100L

    private val mainHandler = Handler(Looper.getMainLooper())

    private val trackers = WeakHashMap<View, ViewportTracker>()

    /**
     * Starts tracking [view], which must be attached, for [entry]'s owner: calls `onNear` or
     * `onFar` right away with where the view is now, then again whenever that changes.
     */
    fun track(view: View, entry: Entry) {
      val root = view.rootView
      trackers.getOrPut(root) { ViewportTracker(root) }.track(view, entry)
    }

    /** Stops tracking [view] for [entry]'s owner. A no-op if another owner has replaced it. */
    fun untrack(view: View, entry: Entry) {
      entry.tracker?.untrack(view, entry)
    }
  }
}
