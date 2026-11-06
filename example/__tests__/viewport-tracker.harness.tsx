import { useEffect, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
} from 'react-native';
import { describe, expect, it, render, waitFor } from 'react-native-harness';
import { type ImageLoader, NativeNitroImage } from 'react-native-nitro-image';
import { NitroImagePipeline } from 'react-native-nitro-image-pipeline';

import { CHECKER_URL, GRADIENT_URL } from './fixture-urls';

// Android only: ViewportTracker releases attached views more than
// EXIT_MARGIN (1.5) windows away and loads them within ENTER_MARGIN (1).
// Three window widths is past both. iOS has no viewport gating — it loads
// on attach wherever the view is — so only the "eventually loads" parts
// hold there.
const FAR_X = 3 * Dimensions.get('window').width;

const styles = StyleSheet.create({
  fixed: { width: 100, height: 50 },
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Resolves when the animation completes.
type Move = (toX: number, duration: number) => Promise<void>;

// A transform animation is slow enough that the tracker has to notice it
// while it is still running: when it finishes, React Native syncs the final
// value back to the shadow tree, and that commit lays the window out again —
// which would hide a tracker that only reacts to scroll and layout.
const SLOW = 4000;
// Linear from FAR_X (3 windows) to 0: after 3 s the view is 0.75 windows
// from the screen, inside ENTER_MARGIN since 1.5 s.
const MID_FLIGHT = 3000;

/** An image whose only way of moving is a native-driver translateX. */
function Mover({
  loader,
  fromX,
  onReady,
}: {
  loader: ImageLoader;
  fromX: number;
  onReady: (move: Move) => void;
}) {
  const [translateX] = useState(() => new Animated.Value(fromX));
  useEffect(() => {
    onReady(
      (toX, duration) =>
        new Promise<void>((resolve) => {
          Animated.timing(translateX, {
            toValue: toX,
            duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }).start(() => resolve());
        }),
    );
  });
  const moved = { transform: [{ translateX }] };
  return (
    <Animated.View style={moved}>
      <NativeNitroImage image={loader} style={styles.fixed} />
    </Animated.View>
  );
}

describe('viewport gating and transforms', () => {
  it('loads a view attached far off-screen once a transform brings it on-screen', async () => {
    let loads = 0;
    const loader = NitroImagePipeline.createImageLoader(GRADIENT_URL, {
      onLoad: () => {
        loads += 1;
      },
    });
    let move: Move | undefined;
    await render(
      <Mover
        loader={loader}
        fromX={FAR_X}
        onReady={(m) => {
          move = m;
        }}
      />,
    );
    await sleep(1000);
    // Gated while far on Android; iOS loads on attach.
    if (Platform.OS === 'android') expect(loads).toBe(0);
    const arrived = move?.(0, SLOW);
    // Loaded while the animation is still running, by the transform alone.
    await waitFor(() => expect(loads).toBeGreaterThan(0), {
      timeout: MID_FLIGHT,
    });
    await arrived;
  });

  it('releases a view a transform moves far away and reloads it when moved back', async () => {
    // Android only: iOS never releases an attached view, so it never reloads.
    if (Platform.OS !== 'android') return;
    let loads = 0;
    const loader = NitroImagePipeline.createImageLoader(CHECKER_URL, {
      onLoad: () => {
        loads += 1;
      },
    });
    let move: Move | undefined;
    await render(
      <Mover
        loader={loader}
        fromX={0}
        onReady={(m) => {
          move = m;
        }}
      />,
    );
    await waitFor(() => expect(loads).toBeGreaterThan(0), { timeout: 5000 });
    await sleep(500);
    const settled = loads;
    await move?.(FAR_X, SLOW);
    // Give the tracker time to see the move and release.
    await sleep(500);
    const back = move?.(0, SLOW);
    // A release + reload reports another onLoad (a memory-cache hit still
    // reports); a move the tracker never saw reports nothing. It has to
    // happen mid-flight, by the transform alone.
    await waitFor(() => expect(loads).toBeGreaterThan(settled), {
      timeout: MID_FLIGHT,
    });
    await back;
  });
});
