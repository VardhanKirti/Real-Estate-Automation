/**
 * The only place a Content Lab number becomes text (01 5.5, SPEC.md C7). Pure; safe in the browser.
 * Ratios always print one decimal; negatives use U+2212; no output ever holds U+2013 or U+2014.
 */

export const MINUS = '−';

const sign = (x: number, s: string) => (x < 0 ? `${MINUS}${s}` : s);

/** 0.8x, 1.4x, 12.6x; 100 and over prints 99x+. */
export function fmtRatio(x: number): string {
  if (!Number.isFinite(x)) return '';
  if (x >= 99.95) return '99x+';
  return `${(Math.round(x * 10) / 10).toFixed(1)}x`;
}

/** 1.6x to 3.1x */
export function fmtRange(lo: number, hi: number): string {
  return `${fmtRatio(lo)} to ${fmtRatio(hi)}`;
}

/** 0, 999, 1.2k, 12k, 1.4M */
export function fmtCount(n: number): string {
  const a = Math.abs(n);
  const strip = (s: string) => s.replace(/\.0$/, '');
  let out: string;
  if (a >= 1e6) out = `${strip((a / 1e6).toFixed(a >= 1e7 ? 0 : 1))}M`;
  else if (a >= 1e3) {
    const k = a / 1e3;
    out = k >= 999.5 ? '1M' : `${strip(k.toFixed(k >= 10 ? 0 : 1))}k`;
  } else out = String(Math.round(a));
  return sign(n, out);
}

/** <1h, 9h, 47h, 2d, 13d, 3w (hours under 48, days under 21, else weeks). */
export function fmtAge(hours: number): string {
  const h = Math.max(0, hours);
  if (h < 1) return '<1h';
  if (h < 48) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 21) return `${Math.floor(d)}d`;
  return `${Math.floor(d / 7)}w`;
}

/** $0.42, $8.20, $30.00 */
export function fmtUsd(x: number): string {
  return sign(x, `$${Math.abs(x).toFixed(2)}`);
}

/** 0..1 -> 62% */
export function fmtPct(x: number): string {
  return sign(x, `${Math.round(Math.abs(x) * 100)}%`);
}

/** +18%, −3%, 0% */
export function fmtDelta(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return '0%';
  return r > 0 ? `+${r}%` : `${MINUS}${Math.abs(r)}%`;
}

/** A signed count difference: +4, −3, 0 (the Breakouts hero delta, 01 7.3). */
export function fmtSigned(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  return r > 0 ? `+${r}` : `${MINUS}${Math.abs(r)}`;
}

/** 14:30 in the Lab's local time zone (GLADOS_TZ, else the process zone). */
export function fmtClock(iso: string, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? zone(), hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${hh.padStart(2, '0')}:${get('minute').padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 21 Sep (local zone). */
export function fmtDayMonth(iso: string, tz?: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? zone(), day: 'numeric', month: 'numeric' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '1');
  return `${get('day')} ${MONTHS[get('month') - 1]}`;
}

/** n 41 */
export function nText(n: number): string {
  return `n ${Math.max(0, Math.round(n))}`;
}

/** Replace {name} slots in a LAB_COPY template. Unknown slots stay as written. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z0-9_ ]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function zone(): string {
  const tz = typeof process !== 'undefined' ? process.env?.GLADOS_TZ?.trim() : undefined;
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return tz;
    } catch {
      // fall through
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 9s, 1m 12s, 1h 04m (09.8 progress header and typical duration). */
export function fmtElapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * A sentence shown under its own title: drops a leading "<title>: " so a card does not say its name twice
 * ("Your normal (baseline)" over "Your normal (baseline): typically off by x1.9" reads "Typically off by x1.9").
 */
export function underTitle(text: string, title: string): string {
  const head = `${title}: `;
  if (!text.startsWith(head)) return text;
  const rest = text.slice(head.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
