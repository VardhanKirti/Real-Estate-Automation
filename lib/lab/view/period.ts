/**
 * Period scrubber model (01 section 6). Weeks start Monday 00:00 and months are calendar months, in
 * the process local time zone (TZ, the Mac mini's zone).
 */
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';

export type PeriodView = {
  unit: 'w' | 'm';
  /** 0 = current, -1 = previous ... */
  offset: number;
  /** "This week" | "Last week" | "Week of 21 Sep" | "This month" | "Last month" | "August" */
  label: string;
  /** ISO, inclusive */
  from: string;
  /** ISO, exclusive (now when offset 0) */
  to: string;
  /** 13 ticks, offset -12..0 */
  ticks: { offset: number; label: string; current: boolean; href: string }[];
  /** null at -12 */
  prevHref: string | null;
  /** null at 0 */
  nextHref: string | null;
  unitHrefs: { w: string; m: string };
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // Monday 0
  d.setDate(d.getDate() - dow);
  return d;
}

/** [from, to) of a period, with `to` = now at offset 0. */
export function periodRange(unit: 'w' | 'm', offset: number, now: Date): { from: Date; to: Date } {
  const o = clampOffset(offset);
  if (unit === 'w') {
    const start = weekStart(now);
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * o);
    const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    return { from, to: o === 0 ? now : end };
  }
  const from = new Date(now.getFullYear(), now.getMonth() + o, 1);
  const end = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to: o === 0 ? now : end };
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(-12, Math.min(0, Math.round(offset)));
}

export function periodLabel(unit: 'w' | 'm', offset: number, now: Date): string {
  const o = clampOffset(offset);
  const c = LAB_COPY.today;
  if (unit === 'w') {
    if (o === 0) return c.thisWeek;
    if (o === -1) return c.lastWeek;
    const { from } = periodRange('w', o, now);
    return fill(c.weekOf, { d: `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]}` });
  }
  if (o === 0) return c.thisMonth;
  if (o === -1) return c.lastMonth;
  const { from } = periodRange('m', o, now);
  const name = MONTHS_LONG[from.getMonth()];
  return from.getFullYear() === now.getFullYear() ? name : `${name} ${from.getFullYear()}`;
}

/**
 * The scrubber model. `href(unit, offset)` builds the link for a position (the page keeps its
 * other params); offset outside -12..0 clamps (AC-01-11).
 */
export function periodFor(unit: 'w' | 'm', offset: number, now: Date, href: (unit: 'w' | 'm', offset: number) => string = (u, o) => `?period=${u}&offset=${o}`): PeriodView {
  const o = clampOffset(offset);
  const { from, to } = periodRange(unit, o, now);
  const ticks: PeriodView['ticks'] = [];
  for (let k = -12; k <= 0; k++) ticks.push({ offset: k, label: periodLabel(unit, k, now), current: k === o, href: href(unit, k) });
  return {
    unit,
    offset: o,
    label: periodLabel(unit, o, now),
    from: from.toISOString(),
    to: to.toISOString(),
    ticks,
    prevHref: o > -12 ? href(unit, o - 1) : null,
    nextHref: o < 0 ? href(unit, o + 1) : null,
    unitHrefs: { w: href('w', 0), m: href('m', 0) },
  };
}
