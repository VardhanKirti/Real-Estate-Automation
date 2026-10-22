'use client';

import { XYChart, type XYChartProps } from './XYChart';

export type GAreaChartProps = XYChartProps;

/**
 * GAreaChart (S00 §5.3, GP3): GLineChart with a series-colour fill, 18% at
 * the line to 0 at the baseline. `variant="step"` is the stepped silhouette;
 * `syncId` shares the crosshair and keyboard cursor (ACGP3.5); `carried`
 * dashes the line over carried-forward points (S03 F4) while the area stays
 * filled, because the carried value is still the best known value.
 */
export function GAreaChart(props: GAreaChartProps) {
  return <XYChart kind="area" {...props} />;
}
