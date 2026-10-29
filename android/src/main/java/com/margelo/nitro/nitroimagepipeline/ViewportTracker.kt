package com.margelo.nitro.nitroimagepipeline

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
 * doesn't flip on every scroll event. Only scrolling and layout are watched — a view moved by a
 * transform animation alone is re-evaluated on the next scroll or layout.
 *
 * One tracker per window, with a single scroll listener and a single layout listener for all of its
 * views, so a hundred images cost one pass over a hundred positions per scroll event rather than a
 * hundred listeners. Main thread only.
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

  private val scrollListener = ViewTreeObserver.OnScrollChangedListener { update() }
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { update() }

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
          }
      observer = null
      root.get()?.let { trackers.remove(it) }
    }
  }

  private fun update() {
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
