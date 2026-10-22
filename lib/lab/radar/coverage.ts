/**
 * The coverage wave (05 section 11): which tracked and owned posts covered a launch, where they
 * sit in the wave, and the share of active tracked creators who are in.
 */
import type { LabEvent, LabEventCoverage, LabPost, LabWavePosition, LabWindowState } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { angleByRule } from '@/lib/lab/radar/angles';
import { textTokens } from '@/lib/lab/radar/events';
import { keyTokens, splitKey, versionTokens } from '@/lib/lab/radar/names';
import { DAY, HOUR } from '@/lib/lab/radar/util';

export const COVERAGE_BEFORE_H = 24;
export const COVERAGE_AFTER_D = 30;
export const FAMILY_VERSION_SPAN = 40;
/** 11.2: the ratio is null until the post is 6 h old. */
export const RATIO_MIN_AGE_H = 6;

/** activeTrackedCount: tracked sources, status active, with 1+ post in the last 30 days (11.3). */
export function activeTrackedCount(store: LabStore, now: Date): number {
  const since = now.getTime() - 30 * DAY;
  const posts = store.posts.all();
  const recent = new Set(posts.filter((p) => p.postedAt && Date.parse(p.postedAt) >= since).map((p) => p.sourceId));
  return store.sources.all('tracked').filter((s) => s.status === 'active' && recent.has(s.id)).length;
}

/** A coverage row that counts toward share, rank and angles: high confidence or confirmed, never rejected. */
export const counts = (c: Pick<LabEventCoverage, 'confidence' | 'confirmed'>): boolean => c.confirmed !== false && (c.confidence === 'high' || c.confirmed === true);

/** coverageShare = distinct tracked creators with a counting covering post / activeTrackedCount. */
export function coverageShare(rows: readonly LabEventCoverage[], active: number): { creators: number; active: number; share: number | null; label: string } {
  const creators = new Set(rows.filter((c) => !c.isOwned && counts(c)).map((c) => c.sourceId)).size;
  return { creators, active, share: active > 0 ? creators / active : null, label: `${creators} of ${active} creators` };
}

/** 11.1 C2: every non-version token and every version token of the key within 40 characters of each other. */
export function familyVersionMatch(text: string, key: string): boolean {
  const need = [...keyTokens(key), ...versionTokens(key)];
  if (need.length < 2 || !versionTokens(key).length) return false;
  const lower = text.normalize('NFKC').toLowerCase().replace(/(?<=[a-z])(?=\d)/g, ' ');
  const positions = need.map((t) => {
    const re = new RegExp(`(?<![a-z0-9.])${t.replace(/[.]/g, '\\.')}(?![a-z0-9]|\\.\\d)`, 'g');
    return [...lower.matchAll(re)].map((m) => m.index!);
  });
  if (positions.some((p) => !p.length)) return false;
  // any choice of one position per token spanning 40 characters or less
  const anchor = positions[0];
  return anchor.some((a) => positions.every((ps) => ps.some((p) => Math.abs(p - a) <= FAMILY_VERSION_SPAN)));
}

/** Which match rule a post's text hits for an event, first hit wins (11.1). */
export function coverageRule(e: Pick<LabEvent, 'key' | 'aliases' | 'clusterId'>, text: string, primaryCluster: string | null): { rule: 'name' | 'family_version' | 'cluster'; confidence: 'high' | 'low' } | null {
  const toks = textTokens(text);
  const keys = [e.key, ...e.aliases];
  for (const k of keys) {
    const kt = splitKey(k);
    if (kt.length && toks.some((_, i) => kt.every((t, j) => toks[i + j] === t))) return { rule: 'name', confidence: 'high' };
  }
  if (keys.some((k) => familyVersionMatch(text, k))) return { rule: 'family_version', confidence: 'high' };
  if (e.clusterId && primaryCluster && e.clusterId === primaryCluster) return { rule: 'cluster', confidence: 'low' };
  return null;
}

/** The window state an event was in at `at`, from its log (10.3), else its clock. */
export function stateAt(e: Pick<LabEvent, 'windowLog' | 't0' | 'windowClosingAt' | 'windowClosesAt'>, at: string): LabWindowState | null {
  const before = e.windowLog.filter((l) => l.at <= at).sort((a, b) => a.at.localeCompare(b.at));
  if (before.length) return before[before.length - 1].to;
  if (!e.t0 || at < e.t0) return null;
  if (e.windowClosingAt && at < e.windowClosingAt) return 'open';
  if (e.windowClosesAt && at < e.windowClosesAt) return 'closing';
  return e.windowClosingAt ? 'closed' : 'open';
}

/** 11.2 wave position: pre before t0; first while the window was open; else follow. */
export function wavePosition(e: Pick<LabEvent, 'windowLog' | 't0' | 'windowClosingAt' | 'windowClosesAt'>, postedAt: string): LabWavePosition {
  if (!e.t0 || postedAt < e.t0) return 'pre';
  return stateAt(e, postedAt) === 'open' ? 'first' : 'follow';
}

/** Rank by posted time among counting tracked rows: 1 + distinct creators who covered it earlier. */
export function rankCreators(rows: LabEventCoverage[]): LabEventCoverage[] {
  const sorted = [...rows].sort((a, b) => a.postedAt.localeCompare(b.postedAt) || a.postId.localeCompare(b.postId));
  const seen = new Set<string>();
  return sorted.map((c) => {
    if (c.isOwned || !counts(c)) return { ...c, creatorRank: null };
    const rank = 1 + [...seen].filter((s) => s !== c.sourceId).length;
    seen.add(c.sourceId);
    return { ...c, creatorRank: rank };
  });
}

function matchText(store: LabStore, p: LabPost): string {
  const d = store.dissections.get(p.id);
  const t = store.transcripts.get(p.id);
  return [p.caption, d?.hookText ?? '', (t?.text ?? '').slice(0, 600)].join('\n');
}

/** The rated L2 ratio of a post for coverage (11.2): null until 6 h old. */
export function postRatio(store: LabStore, p: LabPost, now: Date): { ratio: number | null; ageH: number | null; isBreakout: boolean } {
  const m = store.measures.get(p.id);
  if (!p.postedAt || (now.getTime() - Date.parse(p.postedAt)) / HOUR < RATIO_MIN_AGE_H || !m) return { ratio: null, ageH: null, isBreakout: false };
  const ageH = m.judgedAgeH ?? Math.round(((Date.parse(m.computedAt) - Date.parse(p.postedAt)) / HOUR) * 10) / 10;
  return { ratio: m.breakout, ageH: m.breakout === null ? null : ageH, isBreakout: m.isBreakout };
}

/**
 * 11.1 and 11.2 over the store: rows for every confirmed event not closed more than 30 days ago.
 * Brody's reviews (`confirmed`) and manual angles are kept; rejected rows stay rejected.
 */
export function matchCoverage(store: LabStore, now: Date): { rows: number; events: number } {
  const at = now.toISOString();
  const sources = new Map(store.sources.all().map((s) => [s.id, s]));
  const posts = store.posts.all().filter((p) => p.postedAt && (sources.get(p.sourceId)?.kind === 'tracked' || sources.get(p.sourceId)?.kind === 'owned'));
  const primary = new Map<string, string | null>();
  for (const t of store.topics.all()) if (t.isPrimary) primary.set(t.postId, t.clusterId);
  let rows = 0;
  let events = 0;
  store.transaction(() => {
    for (const e of store.events.all({ status: ['confirmed'] })) {
      if (!e.t0) continue;
      if (e.windowState === 'closed' && e.windowClosesAt && now.getTime() - Date.parse(e.windowClosesAt) > 30 * DAY) continue;
      events++;
      const lo = Date.parse(e.t0) - COVERAGE_BEFORE_H * HOUR;
      const hi = Date.parse(e.t0) + COVERAGE_AFTER_D * DAY;
      const existing = new Map(store.eventCoverage.forEvent(e.id).map((c) => [c.postId, c]));
      const next: LabEventCoverage[] = [];
      for (const p of posts) {
        const t = Date.parse(p.postedAt!);
        if (t < lo || t > hi) continue;
        const prev = existing.get(p.id);
        const hit = coverageRule(e, matchText(store, p), primary.get(p.id) ?? null);
        if (!hit && !(prev && (prev.matchRule === 'manual' || prev.confirmed !== null))) continue;
        const r = postRatio(store, p, now);
        const d = store.dissections.get(p.id);
        const ruleAngle = angleByRule([p.caption.slice(0, 200), d?.hookText ?? ''].join(' '));
        next.push({
          eventId: e.id,
          postId: p.id,
          sourceId: p.sourceId,
          platform: p.platform,
          isOwned: p.isOwned,
          postedAt: p.postedAt!,
          hoursSinceT0: Math.round(((t - Date.parse(e.t0)) / HOUR) * 10) / 10,
          waveN: e.waveN,
          wavePosition: wavePosition(e, p.postedAt!),
          creatorRank: null,
          matchRule: prev?.matchRule === 'manual' ? 'manual' : (hit?.rule ?? prev!.matchRule),
          confidence: prev?.matchRule === 'manual' ? prev.confidence : (hit?.confidence ?? prev!.confidence),
          confirmed: prev ? prev.confirmed : null,
          angle: prev && prev.angleSource !== 'rule' ? prev.angle : prev && prev.angle !== 'other' && ruleAngle === 'other' ? prev.angle : ruleAngle,
          angleSource: prev && prev.angleSource !== 'rule' ? prev.angleSource : 'rule',
          ratio: r.ratio,
          ratioAgeH: r.ageH,
          isBreakout: r.isBreakout,
          computedAt: at,
        });
      }
      for (const c of rankCreators(next)) {
        store.eventCoverage.upsert(c);
        rows++;
      }
    }
  });
  return { rows, events };
}

/**
 * 11.3: cumulative distinct tracked creators by hour for the first 168 h, then by day to 30
 * days (only up to `now`).
 */
export function waveSeries(e: Pick<LabEvent, 't0'>, rows: readonly LabEventCoverage[], now: Date): { h: number; creators: number }[] {
  if (!e.t0) return [];
  const t0 = Date.parse(e.t0);
  const pts = rows
    .filter((c) => !c.isOwned && counts(c))
    .map((c) => ({ h: (Date.parse(c.postedAt) - t0) / HOUR, s: c.sourceId }))
    .sort((a, b) => a.h - b.h);
  const maxH = Math.min(30 * 24, Math.max(0, Math.floor((now.getTime() - t0) / HOUR)));
  const steps: number[] = [];
  for (let h = 0; h <= Math.min(168, maxH); h++) steps.push(h);
  for (let h = 192; h <= maxH; h += 24) steps.push(h);
  return steps.map((h) => ({ h, creators: new Set(pts.filter((p) => p.h <= h).map((p) => p.s)).size }));
}
