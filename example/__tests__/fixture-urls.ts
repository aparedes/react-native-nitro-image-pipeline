/**
 * URLs for the images the harness suites load.
 *
 * These are served by `scripts/fixture-server.ts` on the host rather than
 * fetched from picsum.photos, so a third-party outage can no longer fail the
 * build. Start it with `bun run fixtures` before running the suites locally;
 * CI starts it as a workflow step.
 *
 * `localhost` resolves on both platforms: the iOS simulator shares the host's
 * network, and the Android job reverses the port with
 * `adb reverse tcp:8082 tcp:8082`, the same way it already reaches Metro.
 */
const HOST = `http://localhost:${process.env.FIXTURE_PORT ?? 8082}`;

/** 200×200 diagonal gradient. Smooth, so blurring visibly changes it. */
export const GRADIENT_URL = `${HOST}/gradient-200.png`;

/** 200×200 checkerboard. High-frequency — the hard case for a resize kernel. */
export const CHECKER_URL = `${HOST}/checker-200.png`;

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so this fails
 * without touching the network at all.
 */
export const INVALID_URL = 'https://not-a-real-url.invalid/image.jpg';
