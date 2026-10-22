/**
 * Radar (`/lab/radar`) page model (01 8.2) and its builder. RadarView, EventRow and the enums are
 * section 05's (lib/lab/radar/view.ts), embedded unchanged.
 */
import type { LabEventClass, LabRadarFamily, LabWindowState } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import { RADAR_COPY, radarView } from '@/lib/lab/radar/view';
import { context, trendsView } from '@/lib/lab/view/legacy';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { TrendRow, TrendsView } from '@/lib/lab/view/legacy';
import type { SectionState } from '@/lib/lab/view/shared';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { EventRow, RadarView } from '@/lib/lab/radar/view';

export type RadarPageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  /** section 05 radarView(store, now), unchanged; null when layers.radar is not live */
  radar: RadarView | null;
  filters: { eventClass: LabEventClass | null; windowState: LabWindowState | null; clearHref: string | null };
  timeline: {
    state: SectionState;
    /** radar.events filtered by `filters`, 05 10.4 order kept; max 30 */
    lanes: RadarLaneModel[];
    /** families present in lanes */
    legend: { family: LabRadarFamily; label: string; token: string }[];
  };
  /** radar.candidates; text "Watching {n}: seen in one source so far." (05 17.2) */
  watching: { state: SectionState; text: string | null; rows: EventRow[] };
  /** v1 trends, unchanged maths */
  tide: { state: SectionState; weeks: string[]; series: TrendsView['series']; rows: TrendRow[] };
  /** waveLiftText = radar.waveLift.label, priorText = radar.waveLift.prior */
  leadTime: { state: SectionState; rows: RadarView['leadTime']['rows']; waveLiftText: string | null; priorText: string | null };
};

/** One lane = one section 05 EventRow plus its timeline lane. */
export type RadarLaneModel = {
  row: EventRow;
  lane: RadarView['timeline']['lanes'][number] | null;
  /** "?event=<row.id>" */
  href: string;
  /** open "Window open" | closing "Closing" | closed "Closed"; null window "Not confirmed" */
  stateLabel: string;
};

/* ── builder (01 8) ───────────────────────────────────────────────────── */

const FAMILY_ORDER: LabRadarFamily[] = ['hn', 'hf', 'github', 'vendor', 'x', 'producthunt', 'tiktok'];

export function laneStateLabel(row: EventRow): string {
  const L = LAB_COPY.radar.laneState;
  return row.window ? L[row.window.state] : L.none;
}

export function buildRadar(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null }): RadarPageView {
  const sample = Boolean(flags.sample);
  const c = LAB_COPY.radar;
  const live = inp.frame.layers.radar === 'live';
  const filtered = params.eventClass !== null || params.windowState !== null;
  const clear = new URLSearchParams();
  if (sample) clear.set('sample', '1');
  const view: RadarPageView = {
    frame: inp.frame,
    sheet: inp.sheet,
    radar: null,
    filters: { eventClass: params.eventClass, windowState: params.windowState, clearHref: filtered ? `/lab/radar${clear.toString() ? `?${clear}` : ''}` : null },
    timeline: { state: state('not_built', LAB_COPY.layer.radar), lanes: [], legend: [] },
    watching: { state: state('empty'), text: null, rows: [] },
    tide: { state: state('empty', c.noTopics), weeks: [], series: [], rows: [] },
    leadTime: { state: state('not_built', LAB_COPY.layer.radar), rows: [], waveLiftText: null, priorText: null },
  };
  if (inp.frame.mode.state === 'not_configured') return view;
  const P = 'radar';

  if (live) {
    section(P, 'timeline', () => {
      const radar = radarView(store, now, { sample, dry: Boolean(flags.dry) });
      view.radar = radar;
      const lanesById = new Map(radar.timeline.lanes.map((l) => [l.eventId, l]));
      const rows = radar.events.filter((r) => (params.eventClass === null || r.class === params.eventClass) && (params.windowState === null || r.window?.state === params.windowState)).slice(0, 30);
      const lanes: RadarLaneModel[] = rows.map((row) => ({ row, lane: lanesById.get(row.id) ?? null, href: withSample(`?event=${encodeURIComponent(row.id)}`, sample), stateLabel: laneStateLabel(row) }));
      const fams = new Set(lanes.flatMap((l) => (l.lane?.pings ?? []).map((p) => p.family)));
      view.timeline = {
        state: radar.state === 'never_run'
          ? state('empty', RADAR_COPY.neverRun, { label: LAB_COPY.frame.runNow, href: '#run' })
          : lanes.length ? READY
          : filtered && radar.events.length ? state('empty', c.noMatch, view.filters.clearHref ? { label: c.clearFilters, href: view.filters.clearHref } : null)
          : state('empty', RADAR_COPY.noEvents),
        lanes,
        legend: FAMILY_ORDER.filter((f) => fams.has(f)).map((f) => ({ family: f, label: c.familyLabels[f], token: `--lab-cat-${FAMILY_ORDER.indexOf(f) + 1}` })),
      };
      view.watching = radar.candidates.length
        ? { state: READY, text: RADAR_COPY.watching(radar.candidates.length), rows: radar.candidates }
        : { state: state('empty'), text: null, rows: [] };
      view.leadTime = {
        state: radar.leadTime.rows.length ? READY : state('empty', c.noLead),
        rows: radar.leadTime.rows,
        waveLiftText: radar.waveLift.label || null,
        priorText: radar.waveLift.prior || null,
      };
    }, (s) => {
      view.timeline = { ...view.timeline, state: s };
    });
  }

  view.tide = section(P, 'tide', () => {
    const t = trendsView(context(store, now, new Date(now.getTime() - 7 * 86_400_000)), store.ideas.all());
    return { state: t.rows.length ? READY : state('empty', c.noTopics), weeks: t.weeks, series: t.series, rows: t.rows };
  }, (s) => ({ ...view.tide, state: s }));
  return view;
}
