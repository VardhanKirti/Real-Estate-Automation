/**
 * Next.js boot hook (experimental.instrumentationHook in next.config.mjs), Node.js runtime only.
 * The imports are dynamic and behind the runtime check because this file is also compiled for the
 * edge runtime, which must never trace node:fs or sqlite.
 *
 * 1. Cache warm-up (lib/warm.ts), in the background: nothing is awaited, so the server is ready as
 *    fast as before, and a page that arrives early shares the in-flight call (lib/swr.ts).
 * 2. Cron tick (lib/cron-loop.ts), only when GLADOS_CRON=1 (off by default; the always-on host).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Demo mode (a fresh clone's default) needs its store before the first page.
    try {
      const { ensureDemoStore } = await import('./lib/demo/store');
      ensureDemoStore();
    } catch (err) {
      console.warn(`[demo] store not built: ${err instanceof Error ? err.message : String(err)}`);
    }

    void import('@/lib/warm')
      .then(async ({ warmCaches, warmEnabled }) => {
        if (!warmEnabled()) return;
        const t0 = Date.now();
        const results = await warmCaches();
        const failed = results.filter((r) => !r.ok).map((r) => r.name);
        console.log(`[warm] ${results.length} live reads cached in ${Date.now() - t0} ms${failed.length ? ` (${failed.length} failed: ${failed.join(', ')})` : ''}`);
      })
      .catch((err) => console.warn(`[warm] skipped: ${err instanceof Error ? err.message : String(err)}`));

    if (process.env.GLADOS_CRON === '1') {
      const { startCronLoop } = await import('./lib/cron-loop');
      startCronLoop();
    }
  }
}
