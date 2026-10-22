/**
 * Idea sheet (`?idea=<id>`, and Studio detail) model (01 16.1) and its builder. IdeaSheetView is
 * section 07's (lib/lab/gen/view.ts), embedded unchanged as `data`.
 */
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { ideaSheetView } from '@/lib/lab/gen/view';
import { predictionChip } from '@/lib/lab/ledger/view';
import { ANGLE_LABEL } from '@/lib/lab/radar/angles';
import { eventStateText } from '@/lib/lab/view/sheets/event';
import { eventSheetView } from '@/lib/lab/radar/view';
import { windowTextOf } from '@/lib/lab/view/today';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';
import { withSample } from '@/lib/lab/view/section';
import type { IdeaSheetView } from '@/lib/lab/gen/view';

export type IdeaSheetUi = {
  /** section 07 ideaSheetView(store, id, opts), unchanged */
  data: IdeaSheetView;
  /** from section 05 when data.eventId is set */
  event: { id: string; href: string; name: string; stateText: string } | null;
  /** section 05 label for the angle (launch ideas) or the v1 angle text */
  angleLabel: string;
  windowText: string | null;
  prediction: {
    state: 'shown' | 'hidden' | 'no_script' | 'not_built';
    /** section 06 predictionChip(store, { scriptId }) once the idea has a script */
    chip: { text: string | null; record: string | null; hiddenReason: string | null } | null;
  };
  /** "Grounded in 4 breakouts and 1 dud from the same creators" (07 7.5 grounding counts) */
  groundingText: string;
  actions: {
    writeScript: { label: 'Write script' | 'Open script'; disabledReason: string | null };
    sendEngine: { disabledReason: string | null };
    askWizard: { disabledReason: string | null };
    dismiss: boolean;
    markUsed: boolean;
    reopen: boolean;
  };
};

/* ── builder (01 16) ──────────────────────────────────────────────────── */

export function groundingTextOf(data: IdeaSheetView): string {
  const L = LAB_COPY.sheet;
  const g = data.grounding;
  const b = g?.exemplars?.length ?? 0;
  const d = g?.duds?.length ?? 0;
  if (!b && !d) return data.evidence.length ? fill(L.grounding, { b: data.evidence.length, bWord: data.evidence.length === 1 ? 'breakout' : 'breakouts', d: 0, dWord: 'duds' }) : L.groundingNone;
  return fill(L.grounding, { b, bWord: b === 1 ? 'breakout' : 'breakouts', d, dWord: d === 1 ? 'dud' : 'duds' });
}

export function buildIdeaSheet(store: LabStore, id: string, now: Date, env: LabLayerEnv): IdeaSheetUi | null {
  const data = ideaSheetView(store, id, { now, dry: env.dry, sample: env.sample, readOnly: Boolean(env.readOnly) });
  if (!data) return null;
  let event: IdeaSheetUi['event'] = null;
  let ws: 'early' | 'open' | 'closing' | 'closed' | null = data.timing === 'early' || data.timing === 'open' || data.timing === 'closing' || data.timing === 'closed' ? data.timing : null;
  if (data.eventId) {
    const ev = eventSheetView(store, data.eventId, now, { sample: env.sample, dry: env.dry });
    const row = store.events.get(data.eventId);
    if (ev) {
      event = { id: ev.id, href: withSample(`?event=${encodeURIComponent(ev.id)}`, env.sample), name: ev.name, stateText: eventStateText(ev, row?.windowClosingAt ?? null, now) };
      ws = ev.window?.state ?? ws;
    }
  }
  let prediction: IdeaSheetUi['prediction'];
  if (env.layers.ledger !== 'live') prediction = { state: 'not_built', chip: null };
  else if (!data.scriptId) prediction = { state: 'no_script', chip: null };
  else {
    const chip = predictionChip(store, { scriptId: data.scriptId });
    prediction = chip.hiddenReason && !chip.text ? { state: 'hidden', chip: { text: null, record: null, hiddenReason: chip.hiddenReason } } : chip.text ? { state: 'shown', chip } : { state: 'no_script', chip: null };
  }
  const ro = env.readOnly;
  return {
    data,
    event,
    angleLabel: data.launchAngle ? ANGLE_LABEL[data.launchAngle] : data.angle,
    windowText: windowTextOf(ws),
    prediction,
    groundingText: groundingTextOf(data),
    actions: {
      writeScript: { label: data.scriptId ? 'Open script' : 'Write script', disabledReason: data.scriptId ? null : ro },
      sendEngine: { disabledReason: ro },
      askWizard: { disabledReason: ro },
      dismiss: !ro && data.status === 'open',
      markUsed: !ro && data.status === 'open',
      reopen: !ro && data.status !== 'open',
    },
  };
}
