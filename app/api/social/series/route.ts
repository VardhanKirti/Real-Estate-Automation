import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { AGGREGATE_SERIES } from '@/lib/series';
import {
  audienceSeries,
  dmSeries,
  syncFromZernioConfig,
  GROWTH_RANGES,
} from '@/lib/social';

export const dynamic = 'force-dynamic';

/**
 * Labelled history series for the Social pop-out charts.
 *   ?metric=audience → per-channel + "All audience" follower/subscriber series
 *   ?metric=dms      → total DMs-over-time
 * Growth per range is derived client-side from these points. Each series
 * carries a series index (lib/series.ts), never a colour: the client maps it
 * to the --series-<n> token.
 */
export async function GET(request: Request) {
  const metric = new URL(request.url).searchParams.get('metric');
  const db = getDb();
  syncFromZernioConfig(db);

  if (metric === 'audience') {
    const { channels, all } = audienceSeries(db);
    return NextResponse.json({ metric, ranges: GROWTH_RANGES, series: [all, ...channels] });
  }

  if (metric === 'dms') {
    return NextResponse.json({
      metric,
      ranges: GROWTH_RANGES,
      series: [{ key: 'total', label: 'Total DMs', series: AGGREGATE_SERIES, points: dmSeries(db) }],
    });
  }

  return NextResponse.json({ error: "metric must be 'audience' or 'dms'" }, { status: 400 });
}
