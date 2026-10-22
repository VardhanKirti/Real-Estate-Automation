'use client';

import { XYChart, type XYChartProps } from './XYChart';

export type { XYSeries } from './XYChart';
export type GLineChartProps = XYChartProps;

/**
 * GLineChart (S00 §5.3, GP3): lines on one baseline. `variant="step"` draws
 * flat buckets with a peak tag and per-bucket hover (S02 Touches); `syncId`
 * shares the cursor with other charts; `carried` dashes carried segments.
 */
export function GLineChart(props: GLineChartProps) {
  return <XYChart kind="line" {...props} />;
}
