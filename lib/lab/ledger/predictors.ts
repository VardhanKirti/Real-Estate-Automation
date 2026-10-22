/**
 * The predictor registry (06 section 3). Final list; sections 01, 07 and 08 use these ids and
 * no others. S0 transcribed it as data; lane L owns this file.
 */
export type PredictorKind = 'ranking' | 'forecast' | 'classifier' | 'pairwise';
export type PredictorDef = {
  /** matches LabPredictorIdSchema */
  id: string;
  /** UI name */
  label: string;
  kinds: PredictorKind[];
  replayable: boolean;
  scope: 'owned' | 'all';
  version: string;
  liveFreeze: 'manual' | 'auto_pre_post' | 'auto_early' | 'section_07';
  isBaseline: boolean;
};

export const PREDICTORS: PredictorDef[] = [
  { id: 'creator_median', label: 'Your normal (baseline)', kinds: ['forecast'], replayable: true, scope: 'all', version: 'cm-1', liveFreeze: 'auto_pre_post', isBaseline: true },
  { id: 'brody', label: 'Your pick', kinds: ['ranking'], replayable: false, scope: 'owned', version: 'brody-1', liveFreeze: 'manual', isBaseline: false },
  { id: 'sh_6h', label: '6-hour forecast', kinds: ['forecast', 'ranking', 'classifier'], replayable: true, scope: 'all', version: 'sh-1', liveFreeze: 'auto_early', isBaseline: false },
  { id: 'sh_24h', label: '24-hour forecast', kinds: ['forecast', 'ranking', 'classifier'], replayable: true, scope: 'all', version: 'sh-1', liveFreeze: 'auto_early', isBaseline: false },
  { id: 'mv_6h', label: '6-hour forecast (multi-point)', kinds: ['forecast', 'ranking', 'classifier'], replayable: true, scope: 'all', version: 'mv-1', liveFreeze: 'auto_early', isBaseline: false },
  { id: 'mv_24h', label: '24-hour forecast (multi-point)', kinds: ['forecast', 'ranking', 'classifier'], replayable: true, scope: 'all', version: 'mv-1', liveFreeze: 'auto_early', isBaseline: false },
  { id: 'comment_intent', label: 'Comment requests', kinds: ['ranking'], replayable: false, scope: 'owned', version: 'ci-1', liveFreeze: 'auto_early', isBaseline: false },
  { id: 'judge', label: 'Hook judge', kinds: ['pairwise'], replayable: false, scope: 'owned', version: 'judge-v1', liveFreeze: 'section_07', isBaseline: false },
];

/** external:<tool> predictors are created on first use with this shape (06 section 3). */
export function externalPredictor(tool: string, toolLabel?: string): PredictorDef {
  return { id: `external:${tool}`, label: toolLabel ?? tool, kinds: ['ranking'], replayable: false, scope: 'owned', version: 'ext-1', liveFreeze: 'manual', isBaseline: false };
}

/** The registry entry for an id; `external:<tool>` gets its first-use shape (label = the tool slug unless given). */
export function predictorDef(id: string, toolLabel?: string): PredictorDef {
  const def = PREDICTORS.find((p) => p.id === id);
  if (def) return def;
  if (id.startsWith('external:')) return externalPredictor(id.slice('external:'.length), toolLabel);
  return { id, label: id, kinds: ['ranking'], replayable: false, scope: 'owned', version: 'unknown', liveFreeze: 'manual', isBaseline: false };
}
