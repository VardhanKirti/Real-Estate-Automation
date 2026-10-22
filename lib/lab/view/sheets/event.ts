/**
 * Event sheet (`?event=<id>`) model (01 15.2) and its builder. EventSheetView, EventRow, AngleCell
 * and the enums are section 05's; `data` is eventSheetView's output unchanged.
 */
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { RADAR_COPY, eventSheetView } from '@/lib/lab/radar/view';
import { ALL_TAKEN_COPY } from '@/lib/lab/radar/angles';
import { NOVELTY_LABEL } from '@/lib/lab/radar/novelty';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtAge, fmtRatio } from '@/lib/lab/view/format';
import type { LabNovelty } from '@/lib/schemas';
import type { EventSheetView } from '@/lib/lab/radar/view';
import type { AngleId } from '@/lib/lab/radar/angles';

export type EventSheetUi = {
  /** section 05 eventSheetView(store, id, now), unchanged */
  data: EventSheetView;
  /** open "Window open, {d}d {h}h left" | closing "Closing: {coverage.label} covered" | closed "Closed {fmtAge} ago" | null window "Not confirmed yet" */
  stateText: string;
  /** "{coverage.label} covered it. First wave so far {ratio} (n {k})."; k under 5 -> "First wave so far: not enough yet (n {k})." */
  waveSummary: string;
  /** section 05 11.4 prior text, verbatim */
  waveLiftPrior: string;
  /** data.posts with confidence 'low' and not yet reviewed (05 11.1 C3) */
  possibleMatches: EventSheetView['posts'];
  /** the five 05 tags, for "change" */
  noveltyOptions: { id: LabNovelty; label: string }[];
  make: {
    /** data.angles order (05 ANGLE_ORDER) */
    options: { id: AngleId; label: string; taken: boolean; recommended: boolean }[];
    /** data.recommendedAngle (05 recommendAngle; never null) */
    defaultAngle: AngleId;
    /** data.recommendCopy when every angle is taken */
    note: string | null;
    /** data.actions.make false -> "This window has closed." */
    disabledReason: string | null;
  };
};

/* ── builder (01 15) ──────────────────────────────────────────────────── */

const HOUR = 3_600_000;
const NOVELTY_ORDER: LabNovelty[] = ['new_category', 'new_flagship', 'new_surface', 'point_release', 'ecosystem'];

export function eventStateText(data: Pick<EventSheetView, 'window' | 'coverage'>, closingAt: string | null, now: Date): string {
  const L = LAB_COPY.sheet;
  const w = data.window;
  if (!w) return L.eventUnconfirmed;
  if (w.state === 'open') {
    const left = Math.max(0, (Date.parse(closingAt ?? w.closesAt) - now.getTime()) / HOUR);
    return fill(L.eventOpen, { d: Math.floor(left / 24), h: Math.floor(left % 24) });
  }
  if (w.state === 'closing') return fill(L.eventClosing, { coverage: data.coverage.label });
  return fill(L.eventClosed, { age: fmtAge(Math.max(0, (now.getTime() - Date.parse(w.closesAt)) / HOUR)) });
}

export function waveSummaryOf(data: Pick<EventSheetView, 'posts' | 'coverage'>): string {
  const L = LAB_COPY.sheet;
  if (!data.posts.length) return L.waveNone;
  const first = data.posts.filter((p) => p.wavePosition === 'first' && p.ratio !== null && !p.isOwned).map((p) => p.ratio as number).sort((a, b) => a - b);
  const k = first.length;
  if (k < 5) return fill(L.waveThin, { coverage: data.coverage.label, k });
  const mid = k >> 1;
  const med = k % 2 ? first[mid] : (first[mid - 1] + first[mid]) / 2;
  return fill(L.waveSummary, { coverage: data.coverage.label, ratio: fmtRatio(med), k });
}

export function buildEventSheet(store: LabStore, id: string, now: Date, env: LabLayerEnv): EventSheetUi | null {
  const data = eventSheetView(store, id, now, { sample: env.sample, dry: env.dry });
  if (!data) return null;
  const ev = store.events.get(id);
  const allTaken = data.recommendCopy === ALL_TAKEN_COPY || data.angles.every((a) => a.angle === 'other' || a.taken);
  return {
    data,
    stateText: eventStateText(data, ev?.windowClosingAt ?? null, now),
    waveSummary: waveSummaryOf(data),
    waveLiftPrior: RADAR_COPY.waveLiftPrior,
    possibleMatches: data.posts.filter((p) => p.confidence === 'low' && p.confirmed === null),
    noveltyOptions: NOVELTY_ORDER.map((n) => ({ id: n, label: NOVELTY_LABEL[n] })),
    make: {
      options: data.angles.filter((a) => a.angle !== 'other').map((a) => ({ id: a.angle as AngleId, label: a.label, taken: a.taken, recommended: a.angle === data.recommendedAngle })),
      defaultAngle: data.recommendedAngle,
      note: allTaken ? ALL_TAKEN_COPY : null,
      disabledReason: env.readOnly ?? (data.actions.make ? null : LAB_COPY.sheet.windowClosed),
    },
  };
}
