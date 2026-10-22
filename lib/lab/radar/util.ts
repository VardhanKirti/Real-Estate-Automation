/**
 * Small shared helpers for the Radar: time in the Lab's zone, medians, the request
 * adapter every fetcher uses (labFetch with RADAR_UA), and the age label (05 17.2).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { labFetch } from '@/lib/lab/net';
import { RADAR_UA } from '@/lib/lab/radar/config';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const hoursBetween = (a: string | number, b: string | number): number => ((typeof b === 'number' ? b : Date.parse(b)) - (typeof a === 'number' ? a : Date.parse(a))) / HOUR;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Local calendar parts of `now` in `tz` (IANA). */
export function localParts(now: Date, tz: string): { day: string; hour: number; minute: number; weekday: string; dayLong: string } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const long = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday, dayLong: long.replace(',', '') };
}

/** Minutes since local midnight. */
export const localMinutes = (now: Date, tz: string): number => {
  const p = localParts(now, tz);
  return p.hour * 60 + p.minute;
};

/** 05 17.2: under 1 h `{m}m`, under 48 h `{h}h`, else `{d}d`. */
export function ageLabel(fromIso: string | null, now: Date): string {
  if (!fromIso) return '';
  const ms = Math.max(0, now.getTime() - Date.parse(fromIso));
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** `HH:MM` in tz. */
export function clock(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** The fetch every Radar fetcher uses by default: labFetch (dry guard) with RADAR_UA on every request. */
export const radarFetch: FetchLike = async (url, init) => {
  const res = await labFetch(url, { method: init?.method ?? 'GET', headers: { 'User-Agent': RADAR_UA, ...(init?.headers ?? {}) }, body: init?.body });
  return res;
};

/** Wrap any FetchLike so every request carries RADAR_UA (AC-05-2). */
export function withUa(f: FetchLike): FetchLike {
  return (url, init) => f(url, { ...init, headers: { ...(init?.headers ?? {}), 'User-Agent': RADAR_UA } });
}

export async function getJson(f: FetchLike, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await withUa(f)(url, { headers: { Accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

export async function getText(f: FetchLike, url: string): Promise<string> {
  const res = await withUa(f)(url, {});
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.text();
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
export const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
