/**
 * Script sheet (`?script=<id>`) model (01 17.2) and its builder. ScriptSheetView is section 07's
 * (07 7.8), embedded unchanged as `data`.
 */
import { LAB_BANDS, type LabBand } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { scriptSheetView, type ScriptSheetView } from '@/lib/lab/gen/view';
import { predictionChip } from '@/lib/lab/ledger/view';
import { BAND_LABEL } from '@/lib/lab/ledger/outcome';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';

export type ScriptSheetUi = {
  /** section 07 scriptSheetView(store, id, opts) */
  data: ScriptSheetView;
  /** ?ver= or data.version */
  viewingVersion: number;
  /** sample: LAB_COPY.readOnly | older version: "Viewing v{n}. Open the latest version to edit." | published: "Published scripts are read-only." */
  readOnly: string | null;
  /** data.gate.passed ? "Ready" : "{toFix} to fix, {toConsider} to consider" */
  headerText: string;
  freeze: {
    state: 'open' | 'frozen' | 'gate_failing' | 'not_built';
    /** frozen: "A prediction is frozen once. It is graded 7 days after posting." */
    disabledReason: string | null;
    /** frozen: LAB_COPY.frozenAt "Frozen {d MMM}, {HH:mm}" (from data.prediction) */
    chipText: string | null;
    /** "Edited after freeze. The ledger grades the prediction frozen on v{n}." when data.version > the frozen version */
    editedAfterFreeze: string | null;
    /** section 06 predictionChip(store, { scriptId }) */
    systemChip: { text: string | null; record: string | null; hiddenReason: string | null } | null;
    /** section 06 LAB_BANDS with 06 labels */
    bands: { id: LabBand; label: string }[];
  };
  /** 07's candidates (data.publishCandidates, ranked by 07's cosine rule); noFreezeConfirm = ledger live and nothing frozen */
  publish: { candidates: ScriptSheetView['publishCandidates']; noFreezeConfirm: boolean };
};

/* ── builder (01 17) ──────────────────────────────────────────────────── */

export function buildScriptSheet(store: LabStore, id: string, ver: number | null, now: Date, env: LabLayerEnv): ScriptSheetUi | null {
  const latest = scriptSheetView(store, id, { now, dry: env.dry, sample: env.sample, readOnly: Boolean(env.readOnly) });
  if (!latest) return null;
  const viewing = ver && ver !== latest.version && latest.versions.some((v) => v.version === ver) ? ver : latest.version;
  const data = viewing === latest.version ? latest : (scriptSheetView(store, id, { now, dry: env.dry, sample: env.sample, readOnly: Boolean(env.readOnly), version: viewing }) ?? latest);
  const L = LAB_COPY.sheet;
  const readOnly = env.readOnly ?? (viewing !== latest.version ? fill(L.readOnlyOld, { n: viewing }) : latest.status === 'published' ? L.readOnlyPublished : null);
  const ledgerLive = env.layers.ledger === 'live';
  const p = latest.prediction;
  const frozen = p.state === 'frozen';
  const freezeState: ScriptSheetUi['freeze']['state'] = !ledgerLive ? 'not_built' : frozen ? 'frozen' : latest.gate.passed ? 'open' : 'gate_failing';
  return {
    data,
    viewingVersion: viewing,
    readOnly,
    headerText: data.gate.passed ? LAB_COPY.studio.gateReady : fill(LAB_COPY.studio.gateToFix, { b: data.gate.toFix, w: data.gate.toConsider }),
    freeze: {
      state: freezeState,
      // 07 7.8: a failing gate never blocks a freeze; it only explains the state
      disabledReason: frozen ? L.frozenOnce : env.readOnly,
      chipText: frozen ? (p.frozenText ?? null) : null,
      editedAfterFreeze: frozen && p.frozenVersion !== null && latest.version > p.frozenVersion ? fill(L.editedAfterFreeze, { n: p.frozenVersion }) : null,
      systemChip: ledgerLive ? predictionChip(store, { scriptId: id }) : null,
      bands: LAB_BANDS.map((b) => ({ id: b, label: BAND_LABEL[b] })),
    },
    publish: { candidates: latest.publishCandidates, noFreezeConfirm: ledgerLive && !frozen },
  };
}
