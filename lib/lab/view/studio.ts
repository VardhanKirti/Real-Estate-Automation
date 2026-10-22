/**
 * Studio (`/lab/studio`) page model (01 11.2) and its builder. StudioView and IdeaSheetView are
 * section 07's (lib/lab/gen/view.ts), embedded unchanged.
 */
import { LAUNCH_ANGLES, type LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { studioView } from '@/lib/lab/gen/view';
import { gateCounts } from '@/lib/lab/gen/rules';
import { predictionChip } from '@/lib/lab/ledger/view';
import { ANGLE_LABEL } from '@/lib/lab/radar/angles';
import { context, scriptRow } from '@/lib/lab/view/legacy';
import { buildIdeaSheet } from '@/lib/lab/view/sheets/idea';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { ScriptRow } from '@/lib/lab/view/legacy';
import type { SectionState } from '@/lib/lab/view/shared';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import type { StudioView } from '@/lib/lab/gen/view';

export type StudioPageView = {
  frame: LabFrameView;
  /** never kind 'idea' at >= 768px (D5); the server fills `selected` instead */
  sheet: SheetPayload | null;
  /** section 07 studioView(store, opts), unchanged */
  studio: StudioView;
  groups: {
    id: 'open_window' | 'early' | 'no_window' | 'used' | 'dismissed';
    /** "Window open" | "Early" | "No window" | "Used" | "Dismissed" */
    label: string;
    /** used, dismissed start collapsed */
    collapsed: boolean;
    items: IdeaListItemView[];
  }[];
  /** gateText from 07 gate; predictionText = 06 predictionChip({scriptId}).text, or its hiddenReason, or "no prediction" */
  scripts: { state: SectionState; rows: (ScriptRow & { gateText: string; predictionText: string | null })[] };
  /** = studio.diversity.text (07 7.3.7) */
  diversity: { state: SectionState; text: string };
  /** copy table 11.4, from 07 7.3.8 */
  generate: { state: 'ready' | 'no_material' | 'full' | 'running' | 'dry' | 'read_only' | 'cli_missing'; disabledReason: string | null; line: string; lineHref: string | null };
  seeds: { state: SectionState; title: 'Your audience keeps asking'; rows: SeedRowView[] };
  /** ?idea= or the first open idea (16) */
  selected: IdeaSheetUi | null;
  /** when ?new=1 */
  newIdea: NewIdeaFormView | null;
  /** when no ideas at all */
  emptyCard: SectionState | null;
};

export type IdeaListItemView = { id: string; href: string; title: string; groundedText: string; windowText: string | null; selected: boolean; hasScript: boolean };

/** One section 07 comment seed (7.13.5). */
export type SeedRowView = {
  seedId: string;
  /** the seed label, at most 80 characters, shown in quotes */
  label: string;
  /** "7 asks . 4 posts" */
  countText: string;
  /** "/lab/studio?idea=<id>" when an open idea already came from this seed */
  ideaHref: string | null;
  make: { label: 'Make this'; disabledReason: string | null };
};

export type NewIdeaFormView = {
  fields: {
    title: { label: 'Idea'; placeholder: 'What is the video about, in one line?'; max: 120 };
    /** section 05 LAUNCH_ANGLES with 05 labels, 'other' last */
    angle: { label: 'Angle'; options: { id: LaunchAngle; label: string }[] };
    /** open and closing events */
    eventId: { label: 'Launch (optional)'; options: { id: string; label: string }[] };
    notes: { label: 'Notes (optional)'; max: 500 };
  };
  submitLabel: 'Ground it';
};

/* ── builder (01 11) ──────────────────────────────────────────────────── */

const DAY = 86_400_000;

export function buildStudio(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null; env: LabLayerEnv }): StudioPageView {
  const sample = Boolean(flags.sample);
  const S = (h: string) => withSample(h, sample);
  const L = LAB_COPY.studio;
  const studio = studioView(store, { now, dry: Boolean(flags.dry), sample, readOnly: Boolean(inp.env.readOnly) });
  const sheet = inp.sheet?.kind === 'idea' ? null : inp.sheet;
  const selectedId = inp.sheet?.kind === 'idea' ? inp.sheet.id : params.sheet?.kind === 'idea' ? params.sheet.id : null;
  const view: StudioPageView = {
    frame: inp.frame,
    sheet,
    studio,
    groups: [],
    scripts: { state: state('empty', L.noScripts), rows: [] },
    diversity: { state: READY, text: studio.diversity.text },
    generate: { state: studio.generate.state, disabledReason: studio.generate.disabledReason, line: studio.generate.line, lineHref: studio.generate.state === 'no_material' ? S('?setup=checklist') : null },
    seeds: { state: state('not_built'), title: 'Your audience keeps asking', rows: [] },
    selected: null,
    newIdea: null,
    emptyCard: null,
  };
  if (inp.frame.mode.state === 'not_configured') return view;
  const P = 'studio';

  section(P, 'groups', () => {
    const byId = new Map(store.ideas.all().map((i) => [i.id, i]));
    const winOf = (id: string, timing: string | null): string | null => {
      const e = byId.get(id)?.eventId ? store.events.get(byId.get(id)!.eventId!) : null;
      return e?.windowState ?? timing;
    };
    const ids: Record<StudioPageView['groups'][number]['id'], typeof studio.ideas> = { open_window: [], early: [], no_window: [], used: [], dismissed: [] };
    for (const i of studio.ideas) {
      if (i.status === 'used') ids.used.push(i);
      else if (i.status === 'dismissed') ids.dismissed.push(i);
      else {
        const w = winOf(i.id, i.timing);
        if (w === 'open' || w === 'closing') ids.open_window.push(i);
        else if (w === 'early') ids.early.push(i);
        else ids.no_window.push(i);
      }
    }
    const order = (xs: typeof studio.ideas) => xs.slice().sort((a, b) => b.fit - a.fit || a.id.localeCompare(b.id));
    for (const k of Object.keys(ids) as (keyof typeof ids)[]) ids[k] = order(ids[k]);
    const pick = selectedId && byId.has(selectedId) ? selectedId : (ids.open_window[0] ?? ids.early[0] ?? ids.no_window[0])?.id ?? null;
    const textOf = (w: string | null) => (w === 'open' ? LAB_COPY.today.windowOpen : w === 'closing' ? LAB_COPY.today.windowClosing : w === 'early' ? LAB_COPY.today.windowEarly : null);
    view.groups = (['open_window', 'early', 'no_window', 'used', 'dismissed'] as const).map((g) => ({
      id: g,
      label: L.groups[g],
      collapsed: g === 'used' || g === 'dismissed',
      items: ids[g].map((i) => ({ id: i.id, href: S(`/lab/studio?idea=${encodeURIComponent(i.id)}`), title: i.title, groundedText: fill(LAB_COPY.today.grounded, { n: i.evidence.length }), windowText: textOf(winOf(i.id, i.timing)), selected: i.id === pick, hasScript: Boolean(i.scriptId) })),
    }));
    if (pick) view.selected = buildIdeaSheet(store, pick, now, inp.env);
    if (!studio.ideas.length) view.emptyCard = state('empty', L.emptyIdeas, { label: LAB_COPY.frame.generateIdeas, href: '#generate' });
  }, () => undefined);

  view.scripts = section(P, 'scripts', () => {
    const c = context(store, now, new Date(now.getTime() - 7 * DAY));
    const ledgerLive = inp.frame.layers.ledger === 'live';
    const rows = store.scripts.all().flatMap((s) => {
      const r = scriptRow(c, s.id);
      const v = store.scripts.latestVersion(s.id);
      if (!r || !v) return [];
      const g = gateCounts(v.gate);
      const chip = ledgerLive ? predictionChip(store, { scriptId: s.id }) : null;
      return [{ ...r, href: S(`?script=${encodeURIComponent(s.id)}`), gateText: v.gate.passed ? L.gateReady : fill(L.gateToFix, { b: g.toFix, w: g.toConsider }), predictionText: chip ? (chip.text ?? chip.hiddenReason ?? L.noPrediction) : null }];
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { state: rows.length ? READY : state('empty', L.noScripts), rows };
  }, (s) => ({ state: s, rows: [] }));

  const cl = inp.frame.layers.comments;
  view.seeds = cl === 'not_built'
    ? { state: state('not_built'), title: 'Your audience keeps asking', rows: [] }
    : cl === 'off'
      ? { state: state('off', LAB_COPY.layer.commentsOff, { label: LAB_COPY.frame.setUp, href: S('?setup=spend') }), title: 'Your audience keeps asking', rows: [] }
      : {
          state: studio.seeds.length ? READY : state('empty', L.noSeeds),
          title: 'Your audience keeps asking',
          rows: studio.seeds.map((sd) => ({
            seedId: sd.id,
            label: sd.label.slice(0, 80),
            countText: fill(L.seedCount, { asks: sd.comments, posts: sd.posts }),
            ideaHref: sd.ideaId ? S(`/lab/studio?idea=${encodeURIComponent(sd.ideaId)}`) : null,
            make: { label: 'Make this', disabledReason: inp.env.readOnly },
          })),
        };

  if (params.newIdea) {
    const events = store.events.all({ status: ['confirmed'] }).filter((e) => e.windowState === 'open' || e.windowState === 'closing');
    view.newIdea = {
      fields: {
        title: { label: 'Idea', placeholder: 'What is the video about, in one line?', max: 120 },
        angle: { label: 'Angle', options: LAUNCH_ANGLES.map((a) => ({ id: a, label: ANGLE_LABEL[a] })) },
        eventId: { label: 'Launch (optional)', options: events.map((e) => ({ id: e.id, label: e.name })) },
        notes: { label: 'Notes (optional)', max: 500 },
      },
      submitLabel: 'Ground it',
    };
  }
  return view;
}
