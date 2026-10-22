/**
 * Kit part 2: data viz (SPEC Phase 1 lane 1e, S00 §5.3, GP3, X1). Re-exported
 * from components/g/index.ts. Pure geometry lives in lib/chart-geometry.ts,
 * event placement in lib/timeline-place.ts, the shared cursor in
 * lib/chart-sync.ts.
 */
export { GBar, type GBarProps, type GBarSegment, type GBarTone } from './GBar';
export { GDriverBars, type GDriverBarsProps, type GDriverRow } from './GDriverBars';
export { GRuler, type GRulerProps } from './GRuler';
export { GDotCloud, DOT_CLOUD_CAP, type GDotCloudProps } from './GDotCloud';
export { GRings, type GRingsProps, type GRingsStatus } from './GRings';
export { GBlob, type GBlobProps, type GBlobState } from './GBlob';
export { GSparkline, type GSparklineProps } from './GSparkline';
export { GLineChart, type GLineChartProps, type XYSeries } from './GLineChart';
export { GAreaChart, type GAreaChartProps } from './GAreaChart';
export {
  GBarChart, type GBarChartProps, type StageColumn, type SeriesBar, type GroupedBar, type BarKey, type HorizontalBar,
} from './GBarChart';
export { GStackedBar, type GStackedBarProps, type StackedColumn, type StackKey } from './GStackedBar';
export { GDonut, type GDonutProps, type DonutSlice } from './GDonut';
export { GFunnelStep, funnelConversions, type GFunnelStepProps, type FunnelStage } from './GFunnelStep';
export { GTimelineStrip, type GTimelineStripProps, type TimelineEvent } from './GTimelineStrip';
export { GTickStrip, type GTickStripProps, type TickRunState } from './GTickStrip';
export { GShareBar, type GShareBarProps, type GShareSegment } from './GShareBar';
export { GDotMatrix, type GDotMatrixProps, type DotColumn } from './GDotMatrix';
export { GRingGauge, type GRingGaugeProps } from './GRingGauge';
export { GRadar, type GRadarProps, type RadarAxis, type RadarLayer } from './GRadar';
export { GTreemap, type GTreemapProps, type TreemapBlock, type TreemapKind } from './GTreemap';
export { GHeatmap, type GHeatmapProps } from './GHeatmap';
export { GDiff, type GDiffProps } from './GDiff';
export { GVizStage, type GVizStageProps } from './GVizStage';
export { GLegend, type GLegendProps, type GLegendItem } from './GLegend';
export { GChartTooltip, type GChartTooltipProps } from './GChartTooltip';
export type { VizColor, VizStateKind, VizStateProps, SeriesSlot, CatSlot } from './viz-shared';

/** Every data viz primitive this lane exports, as its `data-g` name (ACGP3.1, tests/g-viz.test.ts). */
export const G_VIZ_PRIMITIVES = [
  'GBar', 'GDriverBars', 'GRuler', 'GDotCloud', 'GRings', 'GBlob', 'GSparkline', 'GLineChart', 'GAreaChart', 'GBarChart',
  'GStackedBar', 'GDonut', 'GFunnelStep', 'GTimelineStrip', 'GTickStrip', 'GShareBar', 'GDotMatrix', 'GRingGauge', 'GRadar',
  'GTreemap', 'GHeatmap', 'GDiff', 'GVizStage', 'GLegend', 'GChartTooltip',
] as const;
