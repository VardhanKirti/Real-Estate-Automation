/**
 * Event class: spike vs adopted tool (05 section 9). Decided at t0 + 96 h from the attention
 * series, re-checked at t0 + 168 h; a new wave on a spike makes it adopted.
 */
import type { LabEvent, LabEventClass } from '@/lib/schemas';
import { DAY, HOUR, median } from '@/lib/lab/radar/util';

export const CLASS_RULE = { decideAtH: 96, baselineShare: 0.2, recheckAtH: 168, day7Floor: 0.3 } as const;
/** 9.4 own refit: spike right when week-5 share < 0.15, adopted right when >= 0.20. */
export const WEEK5 = { spikeBelow: 0.15, adoptedFrom: 0.2 } as const;

export type Series = readonly { day: string; v: number }[];

const dayMs = (d: string) => Date.parse(`${d}T00:00:00.000Z`);
const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10);
const vAt = (s: Series, d: string): number | null => s.find((x) => x.day === d)?.v ?? null;

/** 9.2 numbers over a series around t0. */
export function classNumbers(series: Series, t0: string): { peak: number | null; peakDay: string | null; preMedian: number | null; baselineShare: number | null } {
  const t0d = dayOf(t0);
  const win = series.filter((x) => x.day >= addDays(t0d, -1) && x.day <= addDays(t0d, 4));
  if (!win.length) return { peak: null, peakDay: null, preMedian: null, baselineShare: null };
  const top = win.reduce((a, b) => (b.v > a.v ? b : a));
  const pre = series.filter((x) => x.day >= addDays(t0d, -7) && x.day < t0d).map((x) => x.v);
  const preMedian = median(pre) ?? 0;
  return { peak: top.v, peakDay: top.day, preMedian, baselineShare: top.v > 0 ? preMedian / top.v : null };
}

/**
 * 9.3: the first day d after lastWaveStart + 7 d with v(d) >= 0.5 x the previous wave's peak
 * and v(d) >= 2 x the median of the 7 days before d. Null when none.
 */
export function detectNewWave(series: Series, lastWaveStart: string): string | null {
  const start = dayOf(lastWaveStart);
  const from = addDays(start, 7);
  const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
  for (const x of sorted) {
    if (x.day <= from) continue;
    const prev = sorted.filter((y) => y.day >= addDays(start, -1) && y.day < x.day);
    const peak = prev.length ? Math.max(...prev.map((y) => y.v)) : 0;
    const before = sorted.filter((y) => y.day >= addDays(x.day, -7) && y.day < x.day).map((y) => y.v);
    const m = median(before);
    if (peak > 0 && x.v >= 0.5 * peak && m !== null && x.v >= 2 * m) return x.day;
  }
  return null;
}

export type ClassResult = { class: LabEventClass; classInfo: LabEvent['classInfo']; wave: { n: number; startedAt: string } | null };

/**
 * 9.2 at `now`. Before 96 h: unknown. At 96 h: adopted when baseline share >= 0.20, else spike.
 * At 168 h: a spike with v(peak + 7 d) / peak >= 0.30 becomes adopted. A new wave makes it adopted.
 * No attention data: unknown (spike clock).
 */
export function classifyEvent(e: Pick<LabEvent, 't0' | 'class' | 'classInfo' | 'attention' | 'waveN' | 'waveStartedAt'>, now: Date): ClassResult {
  const info = { ...e.classInfo };
  if (!e.t0 || !e.attention.length) return { class: e.class, classInfo: info, wave: null };
  const ageH = (now.getTime() - Date.parse(e.t0)) / HOUR;
  let cls: LabEventClass = e.class;
  let wave: ClassResult['wave'] = null;
  const nums = classNumbers(e.attention, e.t0);
  if (cls === 'unknown' && ageH >= CLASS_RULE.decideAtH && nums.peak !== null) {
    info.peak = nums.peak;
    info.preMedian = nums.preMedian;
    info.baselineShare = nums.baselineShare === null ? null : Math.round(nums.baselineShare * 1000) / 1000;
    info.decidedAt = now.toISOString();
    cls = (nums.baselineShare ?? 0) >= CLASS_RULE.baselineShare ? 'adopted' : 'spike';
  }
  if (cls === 'spike' && ageH >= CLASS_RULE.recheckAtH && nums.peak && nums.peakDay) {
    const d7 = vAt(e.attention, addDays(nums.peakDay, 7));
    if (d7 !== null) {
      info.day7Share = Math.round((d7 / nums.peak) * 1000) / 1000;
      if (info.day7Share >= CLASS_RULE.day7Floor) cls = 'adopted';
    }
  }
  if (cls !== 'unknown') {
    const d = detectNewWave(e.attention, e.waveStartedAt ?? e.t0);
    if (d) {
      cls = 'adopted';
      wave = { n: e.waveN + 1, startedAt: `${d}T00:00:00.000Z` };
    }
  }
  // own refit: week-5 share once decided and 30 days old
  if (info.decidedAt && nums.peak && nums.peakDay && now.getTime() - dayMs(nums.peakDay) >= 34 * DAY) {
    const w5 = e.attention.filter((x) => x.day >= addDays(nums.peakDay!, 28) && x.day <= addDays(nums.peakDay!, 34)).map((x) => x.v);
    if (w5.length) {
      const share = w5.reduce((a, b) => a + b, 0) / w5.length / nums.peak;
      info.week5Share = Math.round(share * 1000) / 1000;
      info.classCorrect = cls === 'spike' && share < WEEK5.spikeBelow ? true : cls === 'adopted' && share >= WEEK5.adoptedFrom ? true : (cls === 'spike' && share >= WEEK5.adoptedFrom) || (cls === 'adopted' && share < WEEK5.spikeBelow) ? false : null;
    }
  }
  return { class: cls, classInfo: info, wave };
}

export const CLASS_LABEL: Record<LabEventClass, string> = { spike: 'Spike (days)', adopted: 'Adopted tool (weeks, comes back)', unknown: 'Class decided at 96h' };
