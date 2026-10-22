'use client';

import { BarStages, type BarStagesProps, type StageColumn } from './BarStages';

export type FunnelStage = {
  id: string;
  label: string;
  count: number;
  /** conversion from the previous stage, 0..1; omitted = computed from the counts; null = "—" */
  conversion?: number | null;
  sub?: string;
  tip?: StageColumn['tip'];
};

export type GFunnelStepProps = Omit<BarStagesProps, 'columns' | 'measure' | 'flow' | 'conversionRow' | 'kit'> & {
  stages: readonly FunnelStage[];
};

/** Conversion from the previous stage for each stage (first = null; a zero previous = null). */
export function funnelConversions(stages: readonly Pick<FunnelStage, 'count' | 'conversion'>[]): (number | null)[] {
  return stages.map((s, i) => {
    if (s.conversion !== undefined) return s.conversion;
    if (i === 0) return null;
    const prev = stages[i - 1].count;
    return prev > 0 ? s.count / prev : null;
  });
}

/**
 * GFunnelStep (C5: S02 wins over S00's card-per-stage row): the funnel stage
 * chart is `GBarChart variant="stages" measure="count" flow` plus the
 * conversion row; the worst step's conversion reads in `--g-warn`.
 */
export function GFunnelStep({ stages, ...rest }: GFunnelStepProps) {
  const conv = funnelConversions(stages);
  const columns: StageColumn[] = stages.map((s, i) => ({ id: s.id, label: s.label, value: s.count, sub: s.sub, conversion: conv[i], tip: s.tip }));
  return <BarStages {...rest} columns={columns} measure="count" flow conversionRow kit="GFunnelStep" />;
}
