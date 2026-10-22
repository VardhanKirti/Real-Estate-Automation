'use client';
/**
 * GladOS run progress row and stage list (02 8.2, 09.4.4): 09's RunRowProgress and BatchProgress
 * stages in, the shared draw-only components out. No fake progress: the bar is determinate only when
 * 09 says the count is known, and an indeterminate row never shows a percentage.
 */
import { ProgressRow as DrawRow, StageList as DrawStages } from '@/components/lab/v2/shared/Progress';
import { progressRowView, stageViews } from '@/components/lab/v2/shared/progressView';

import type { BatchProgress, RunRowProgress } from '@/lib/lab/setup/progress';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

export function ProgressRow({ row, onStop, compact, stopping }: { row: RunRowProgress; onStop?: () => void; compact?: boolean; stopping?: boolean }) {
  const v = progressRowView(row);
  return <DrawRow row={stopping ? { ...v, stateText: LAB_UI.stopping, canStop: false } : v} onStop={onStop} compact={compact} />;
}

export function StageList({ stages }: { stages: BatchProgress['stages'] }) {
  return <DrawStages stages={stageViews(stages)} />;
}
