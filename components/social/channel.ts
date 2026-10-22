import { seriesIndexFor } from '@/lib/series';
import type { VizColor } from '@/components/g';

/** Series slot for a channel key (SPEC C19), as a kit colour; untracked channels read muted. */
export function channelVizColor(key: string): VizColor {
  const i = seriesIndexFor(key);
  return i ? (`series-${i}` as VizColor) : 'muted';
}
