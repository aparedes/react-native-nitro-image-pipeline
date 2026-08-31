/**
 * Serves the harness suites' test images over HTTP.
 *
 * The suites used to fetch from picsum.photos, which put a third-party host on
 * the critical path of every CI run: an outage there (a Cloudflare 522, say)
 * failed the build with `Failed to load image data`, and `clearCache()` at the
 * top of the pipeline suite meant not even a warm cache could absorb it.
 *
 * This is still a real HTTP server over a real socket, so Nuke/URLSession and
 * Coil/OkHttp take exactly the path they take in production — the only thing
 * removed is the public internet.
 *
 * Run it alongside the harness:
 *   bun run fixtures
 *
 * Android reaches it through `adb reverse tcp:8082 tcp:8082`, so `localhost`
 * resolves the same on both platforms and the suites need one URL.
 */
import { file } from 'bun';

const PORT = Number(process.env.FIXTURE_PORT ?? 8082);
const FIXTURES = new URL('../example/fixtures/', import.meta.url).pathname;

// Only these are servable — the path is never joined with untrusted input.
const IMAGES = ['gradient-200.png', 'checker-200.png'] as const;

const server = Bun.serve({
  port: PORT,
  // Bound to loopback: the simulator and (via adb reverse) the emulator reach
  // it, nothing else on the network does.
  hostname: '127.0.0.1',
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    const name = pathname.slice(1);
    if ((IMAGES as readonly string[]).includes(name)) {
      const image = file(FIXTURES + name);
      return new Response(image, {
        headers: {
          'Content-Type': 'image/png',
          // Mirror a normal image host so the `cache: disk | memory | none`
          // suites exercise the same caching decisions they would in the wild.
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Fixture server listening on http://localhost:${server.port}`);
for (const name of IMAGES) {
  console.log(`  http://localhost:${server.port}/${name}`);
}
