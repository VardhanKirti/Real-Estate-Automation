/**
 * Pings: observations, velocity, robust z and the qualifying rules (05 section 5).
 * `upsertPing` is the only writer of lab_event_pings rows built from a source.
 */
import type { LabEventPing, LabRadarFamily, LabRadarSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { AI_LEXICON, SOURCE_FAMILY } from '@/lib/lab/radar/config';
import { isReuploader } from '@/lib/lab/radar/fetch/hf';
import { canonicalKey } from '@/lib/lab/radar/names';
import type { RawPing } from '@/lib/lab/radar/types';
import { DAY, HOUR, median } from '@/lib/lab/radar/util';

/** 5.2: under this many baseline pings the z is not used and the fixed floors decide. */
export const BASELINE_MIN_N = 50;
export const MAD_SCALE = 1.4826;

type VelocityInput = Pick<LabEventPing, 'source' | 'metricPrev' | 'metricLast' | 'prevSeenAt' | 'lastSeenAt' | 'firstSeenAt' | 'sourceTime'>;

/**
 * 5.1. Repeat observation: (last - prev) / max(0.25, hours between reads). First observation:
 * metric / max(0.25, hours since the item's own time). tiktok_cc: rank climbed per day.
 */
export function velocityPerH(p: VelocityInput): number | null {
  if (p.metricLast === null) return null;
  if (p.source === 'tiktok_cc') {
    if (p.metricPrev === null || !p.prevSeenAt) return null;
    const days = Math.max(0.25 / 24, (Date.parse(p.lastSeenAt) - Date.parse(p.prevSeenAt)) / DAY);
    return (p.metricPrev - p.metricLast) / days;
  }
  if (p.metricPrev !== null && p.prevSeenAt) {
    const h = Math.max(0.25, (Date.parse(p.lastSeenAt) - Date.parse(p.prevSeenAt)) / HOUR);
    return (p.metricLast - p.metricPrev) / h;
  }
  const start = p.sourceTime ?? p.firstSeenAt;
  const h = Math.max(0.25, (Date.parse(p.firstSeenAt) - Date.parse(start)) / HOUR);
  return p.metricLast / h;
}

/** 5.2: (v - med) / (1.4826 x MAD); MAD 0 gives null. */
export function robustZ(v: number | null, baseline: readonly number[]): { z: number | null; median: number | null; mad: number | null; n: number } {
  const med = median(baseline);
  if (v === null || med === null) return { z: null, median: med, mad: null, n: baseline.length };
  const mad = median(baseline.map((x) => Math.abs(x - med)))!;
  return { z: mad === 0 ? null : (v - med) / (MAD_SCALE * mad), median: med, mad, n: baseline.length };
}

/** 5.2: velocities of this source's AI-lexicon pings first seen in the last 30 days. */
export function sourceBaseline(store: LabStore, source: LabRadarSource, now: Date): number[] {
  return store.eventPings
    .forSource(source, new Date(now.getTime() - 30 * DAY).toISOString())
    .filter((p) => p.lexicon && p.velocityPerH !== null && !p.isBaseline)
    .map((p) => p.velocityPerH!);
}

export type QualifyCtx = {
  /** baseline size for the source (z used only at 50 or more) */
  baselineN: number;
  now: Date;
  /** github: token present (fake-star filter on) */
  githubToken?: boolean;
  /** github without token: owner is an Organization or 180+ days old */
  ownerEstablished?: boolean | null;
  /** github with token: fake-star result (null = not checked yet) */
  fakeStar?: { flagged: boolean; reason: string | null } | null;
  /** tiktok_cc: yesterday's rank (null = new in list) */
  prevRank?: number | null;
  /** x: distinct watch-list authors that mention the event within 6 h (synthetic ping) */
  authors?: number;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** 5.3. The reason string shows in the Event sheet's source list. */
export function qualifies(p: Pick<LabEventPing, 'source' | 'title' | 'metricLast' | 'rank' | 'velocityPerH' | 'robustZ' | 'isLaunch' | 'firstSeenAt' | 'externalId'> & { createdAt?: string | null; family?: LabRadarFamily }, ctx: QualifyCtx): { ok: boolean; reason: string } {
  switch (p.source) {
    case 'hn': {
      if (!AI_LEXICON.test(p.title)) return { ok: false, reason: 'HN: not an AI story' };
      const pts = p.metricLast ?? 0;
      if (pts >= 100) return { ok: true, reason: `HN: ${fmtInt(pts)} points` };
      if (ctx.baselineN >= BASELINE_MIN_N) {
        if (p.robustZ !== null && p.robustZ >= 3) return { ok: true, reason: `HN: ${fmtInt(p.velocityPerH ?? 0)} points/h, well above normal` };
        return { ok: false, reason: `HN: ${fmtInt(pts)} points` };
      }
      if ((p.velocityPerH ?? 0) >= 30) return { ok: true, reason: `HN: ${fmtInt(p.velocityPerH!)} points/h` };
      return { ok: false, reason: `HN: ${fmtInt(pts)} points` };
    }
    case 'hf_models': {
      if (isReuploader(p.externalId)) return { ok: false, reason: 'HF: a reupload' };
      const fresh = p.createdAt ? Date.parse(p.firstSeenAt) - Date.parse(p.createdAt) <= 14 * DAY : false;
      if (p.rank !== null && p.rank <= 20 && fresh) return { ok: true, reason: `HF: trending #${p.rank}` };
      return { ok: false, reason: p.rank !== null ? `HF: trending #${p.rank}` : 'HF: not trending' };
    }
    case 'hf_spaces':
      return p.rank !== null && p.rank <= 15 ? { ok: true, reason: `HF space: trending #${p.rank}` } : { ok: false, reason: `HF space: trending #${p.rank ?? '?'}` };
    case 'github': {
      const stars = p.metricLast ?? 0;
      const young = p.createdAt ? Date.parse(p.firstSeenAt) - Date.parse(p.createdAt) <= 7 * DAY : false;
      const fast = (p.velocityPerH ?? 0) >= 50;
      if (!fast && !(stars >= 500 && young)) return { ok: false, reason: `GitHub: ${fmtInt(stars)} stars` };
      const base = fast ? `GitHub: ${fmtInt(p.velocityPerH!)} stars/h` : `GitHub: ${fmtInt(stars)} stars in a week`;
      if (ctx.githubToken) {
        if (!ctx.fakeStar) return { ok: false, reason: `${base} (star check pending)` };
        if (ctx.fakeStar.flagged) return { ok: false, reason: ctx.fakeStar.reason ?? 'GitHub: stars look bought' };
        return { ok: true, reason: base };
      }
      if (ctx.ownerEstablished) return { ok: true, reason: base };
      return { ok: false, reason: `${base}, owner too new to count without a GitHub token` };
    }
    case 'vendor':
      return p.isLaunch ? { ok: true, reason: 'Vendor: launch post' } : { ok: false, reason: 'Vendor: not a launch post' };
    case 'x': {
      if (p.isLaunch) return { ok: true, reason: 'X: launch post from the vendor' };
      if ((ctx.authors ?? 0) >= 3) return { ok: true, reason: `X: ${ctx.authors} watched accounts in 6h` };
      return { ok: false, reason: 'X: mention' };
    }
    case 'producthunt': {
      const v = p.metricLast ?? 0;
      return v >= 300 ? { ok: true, reason: `Product Hunt: ${fmtInt(v)} votes` } : { ok: false, reason: `Product Hunt: ${fmtInt(v)} votes` };
    }
    case 'tiktok_cc': {
      if (ctx.prevRank === null || ctx.prevRank === undefined) return { ok: true, reason: `TikTok: new in the top list at #${p.rank ?? '?'}` };
      const climb = ctx.prevRank - (p.rank ?? ctx.prevRank);
      return climb >= 10 ? { ok: true, reason: `TikTok: up ${climb} places to #${p.rank}` } : { ok: false, reason: `TikTok: #${p.rank ?? '?'}` };
    }
    default:
      return { ok: false, reason: 'Not a ping source' };
  }
}

/** The family a ping counts toward: a vendor-handle launch tweet is family `vendor` (05 3.7). */
export const familyOf = (raw: Pick<RawPing, 'source' | 'isLaunch'>): LabRadarFamily => (raw.source === 'x' && raw.isLaunch ? 'vendor' : SOURCE_FAMILY[raw.source]);

/**
 * Insert or update one ping from a source read. Repeated polls keep first_seen, the event link
 * and the first metric; velocity and z are recomputed; qualification uses `ctx`.
 */
export function upsertPing(store: LabStore, raw: RawPing, opts: { now: Date; dry: boolean; baseline?: readonly number[]; ctx?: Partial<QualifyCtx> }): LabEventPing {
  const id = `${raw.source}:${raw.externalId}`;
  const at = opts.now.toISOString();
  const prev = store.eventPings.get(id);
  const rowBase: LabEventPing = prev
    ? {
        ...prev,
        title: raw.title || prev.title,
        url: raw.url || prev.url,
        author: raw.author ?? prev.author,
        vendor: raw.vendor ?? prev.vendor,
        sourceTime: prev.sourceTime ?? raw.sourceTime,
        prevSeenAt: prev.lastSeenAt,
        lastSeenAt: at,
        metricPrev: prev.metricLast,
        metricLast: raw.metric ?? prev.metricLast,
        rank: raw.rank ?? prev.rank,
        name: prev.name ?? raw.name,
        nameKey: prev.nameKey ?? (raw.name ? canonicalKey(raw.name) : null),
        isLaunch: prev.isBaseline ? false : prev.isLaunch || raw.isLaunch,
        family: prev.family,
      }
    : {
        id,
        source: raw.source,
        family: familyOf(raw),
        externalId: raw.externalId,
        eventId: null,
        matchRule: null,
        name: raw.name,
        nameKey: raw.name ? canonicalKey(raw.name) : null,
        title: raw.title,
        url: raw.url,
        author: raw.author,
        vendor: raw.vendor,
        sourceTime: raw.sourceTime,
        firstSeenAt: at,
        lastSeenAt: at,
        prevSeenAt: null,
        metricFirst: raw.metric,
        metricPrev: null,
        metricLast: raw.metric,
        rank: raw.rank,
        velocityPerH: null,
        robustZ: null,
        isLaunch: raw.isBaseline ? false : raw.isLaunch,
        isBaseline: raw.isBaseline,
        qualifies: false,
        qualifyReason: null,
        fakeStar: null,
        fakeStarInfo: null,
        lexicon: false,
        dry: opts.dry,
      };
  const lexicon = AI_LEXICON.test(rowBase.title) || ['hf_models', 'hf_spaces', 'github', 'tiktok_cc'].includes(raw.source);
  const velocity = velocityPerH(rowBase);
  const baseline = opts.baseline ?? sourceBaseline(store, raw.source, opts.now);
  const z = robustZ(velocity, baseline).z;
  const fake = opts.ctx?.fakeStar ?? null;
  const row: LabEventPing = {
    ...rowBase,
    velocityPerH: velocity === null ? null : Math.round(velocity * 100) / 100,
    robustZ: z === null ? null : Math.round(z * 100) / 100,
    lexicon,
    fakeStar: fake ? fake.flagged : rowBase.fakeStar,
    fakeStarInfo: fake ? fake : rowBase.fakeStarInfo,
  };
  if (row.isBaseline) {
    row.qualifies = false;
    row.qualifyReason = null;
  } else {
    const prevFake = rowBase.fakeStarInfo as { flagged?: boolean; reason?: string | null } | null;
    const q = qualifies({ ...row, createdAt: raw.extra.createdAt ?? null }, {
      baselineN: baseline.length,
      now: opts.now,
      prevRank: raw.source === 'tiktok_cc' ? (prev ? prev.metricLast : null) : undefined,
      ...opts.ctx,
      fakeStar: fake ?? (prevFake && typeof prevFake.flagged === 'boolean' ? { flagged: prevFake.flagged, reason: prevFake.reason ?? null } : null),
    });
    // a ping that once qualified keeps counting (its t0 evidence never disappears)
    row.qualifies = prev?.qualifies ? true : q.ok;
    row.qualifyReason = prev?.qualifies ? prev.qualifyReason : q.reason;
  }
  store.eventPings.upsert(row);
  return row;
}
