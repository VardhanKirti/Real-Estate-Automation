import { SharePie } from '@/components/SharePie';
import { formatFollowers } from '@/components/SocialStats';
import type { PieItem } from '@/lib/social-chart';
import { channelColor } from '@/lib/series';

/** Audience share as a donut: one slice per account, total reach at center.
 * Each slice wears its channel's series colour (SPEC C19). */
export function AudiencePie({
  items,
  total,
  framed = true,
  stacked = false,
  donutPx,
}: {
  items: PieItem[];
  total: number;
  framed?: boolean;
  stacked?: boolean;
  donutPx?: number;
}) {
  return (
    <SharePie
      items={items.map((i) => ({ ...i, color: i.color ?? channelColor(i.key) }))}
      total={total}
      centerLabel="total reach"
      format={formatFollowers}
      framed={framed}
      stacked={stacked}
      donutPx={donutPx}
      ariaLabel="Audience share by account"
    />
  );
}
