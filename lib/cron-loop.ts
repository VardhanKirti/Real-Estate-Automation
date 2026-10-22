import { SESSION_COOKIE } from '@/lib/auth-gate';

/**
 * The 60-second cron tick, ported from the 2026-10-06 parts bin.
 * instrumentation.ts imports this only on the node runtime, and only when
 * GLADOS_CRON=1 at boot; the tick route checks the switch again on every call.
 * This file must stay free of node: imports (no lib/creds, no fs): Next
 * compiles instrumentation for the edge bundle too.
 *
 * It POSTs /api/cron/tick over loopback rather than importing the runner, so
 * jobs run in the same module graph as every other route (one db handle). With
 * an operator password the middleware wants the session cookie, whose value is
 * GLADOS_SESSION_SECRET (loaded from .env.local at boot): a password set after
 * boot needs one restart before the tick authenticates (it logs the 401).
 */
export function cronBootEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GLADOS_CRON === '1';
}

export function tickHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const secret = (env.GLADOS_SESSION_SECRET || '').trim();
  return secret ? { cookie: `${SESSION_COOKIE}=${secret}` } : {};
}

let started = false;

export function startCronLoop(): void {
  if (started || !cronBootEnabled()) return;
  started = true;
  const port = (process.env.PORT || '').trim() || '4100';
  const url = `http://127.0.0.1:${port}/api/cron/tick`;
  let busy = false;

  const tick = async () => {
    if (busy) return; // a slow job is still running; the next tick catches up
    busy = true;
    try {
      const res = await fetch(url, { method: 'POST', headers: tickHeaders() });
      if (!res.ok) {
        console.warn(`[cron] tick answered ${res.status}${res.status === 401 ? ' (password set since boot: restart to pick up the session secret)' : ''}`);
        return;
      }
      const body = (await res.json()) as { ran?: { cronId: string; ok: boolean; summary: string }[] };
      for (const r of body.ran ?? []) console.log(`[cron] ${r.cronId} ${r.ok ? 'ok' : 'FAILED'}: ${r.summary.slice(0, 200)}`);
    } catch (err) {
      console.warn('[cron] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };

  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, 60_000).unref?.();
  console.log('[cron] runner on (GLADOS_CRON=1), ticking every 60s');
}
