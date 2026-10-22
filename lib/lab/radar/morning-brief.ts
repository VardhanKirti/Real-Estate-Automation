/**
 * Alerts and the morning brief (05 section 14). Composed by the `brief` job at the first tick
 * at or after 07:30 local, stored in lab_brief (one row per local day) and written to the brain
 * through labBrainRoot(). Never sent anywhere on its own (the Wizard hook is wizard.ts).
 */
import type { LabEvent, LabMorningBrief, LabMorningBriefItem, LabMorningBriefKind, LabPlatform } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { GENERATED_MARKER, writeBrainDocs } from '@/lib/brain-docs';
import { labBrainRoot } from '@/lib/lab/brain';
import { ANGLE_LABEL, angleOwnStats, recommendAngle, takenAngles } from '@/lib/lab/radar/angles';
import { activeTrackedCount, coverageShare } from '@/lib/lab/radar/coverage';
import { NOVELTY_LABEL } from '@/lib/lab/radar/novelty';
import { DAY, HOUR, ageLabel, localParts } from '@/lib/lab/radar/util';

export const MORNING_BRIEF_MAX_ITEMS = 5;
export const BRIEF_AT_MIN = 7 * 60 + 30;
export const EMPTY_BRIEF = 'Nothing new since yesterday.';

const PLATFORM_LABEL: Record<LabPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };
const PRIORITY: Record<LabMorningBriefKind, number> = { my_post_spike: 1, new_launch: 2, creator_breakout: 2, window_reopened: 2, window_closing: 3 };

const hook50 = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 50 ? `${t.slice(0, 49).trimEnd()}...` : t;
};
const r1 = (x: number) => x.toFixed(1);

export type Alert = LabMorningBriefItem;

/** Every alert the store holds now, with its trigger time (14.1). Not filtered by brief. */
export function collectAlerts(store: LabStore, now: Date): Alert[] {
  const out: Alert[] = [];
  const t = now.getTime();
  const sources = new Map(store.sources.all().map((s) => [s.id, s]));
  const active = activeTrackedCount(store, now);
  const own = angleOwnStats(store, now);

  for (const p of store.posts.all()) {
    if (!p.postedAt) continue;
    const ageH = (t - Date.parse(p.postedAt)) / HOUR;
    const m = store.measures.get(p.id);
    if (!m || m.breakout === null) continue;
    const hook = hook50(store.dissections.get(p.id)?.hookText || p.caption);
    const at = m.computedAt > p.postedAt ? m.computedAt : new Date(Date.parse(p.postedAt) + 6 * HOUR).toISOString();
    if (p.isOwned && ageH >= 6 && ageH <= 24 && m.breakout >= 2) {
      out.push({ kind: 'my_post_spike', dedupeKey: `my_post_spike:${p.id}`, priority: 1, at, line: `Your ${PLATFORM_LABEL[p.platform]} post "${hook}" is at ${r1(m.breakout)}x your normal at ${Math.floor(ageH)}h.`, href: `/lab?post=${p.id}`, eventId: null, postId: p.id });
    } else if (!p.isOwned && sources.get(p.sourceId)?.kind === 'tracked' && ageH < 48 && m.breakout >= 5 && m.baselineN >= 5) {
      const creator = sources.get(p.sourceId)?.displayName || sources.get(p.sourceId)?.handle || 'A tracked creator';
      out.push({ kind: 'creator_breakout', dedupeKey: `creator_breakout:${p.id}`, priority: PRIORITY.creator_breakout, at, line: `${creator} hit ${r1(m.breakout)}x their normal on "${hook}" (${PLATFORM_LABEL[p.platform]}, ${Math.floor(ageH)}h).`, href: `/lab?post=${p.id}`, eventId: null, postId: p.id });
    }
  }

  for (const e of store.events.all({ status: ['confirmed'] })) {
    const cov = store.eventCoverage.forEvent(e.id);
    if (e.confirmedAt) {
      const share = coverageShare(cov, active);
      const angle = recommendAngle({ taken: takenAngles(cov), windowState: e.windowState, own }).angle;
      const big = e.novelty === 'new_category' || e.novelty === 'new_flagship';
      out.push({
        kind: 'new_launch', dedupeKey: `new_launch:${e.id}`, priority: big ? 1 : 2, at: e.confirmedAt,
        line: `${e.name} launched ${ageLabel(e.t0, now)} ago (${e.novelty ? NOVELTY_LABEL[e.novelty] : 'Not tagged yet'}). ${share.creators} of ${share.active} creators in. Untaken angle: ${ANGLE_LABEL[angle]}.`,
        href: `/lab/radar?event=${e.id}`, eventId: e.id, postId: null,
      });
    }
    if (e.waveN > 1 && e.class === 'adopted' && e.waveStartedAt) {
      out.push({ kind: 'window_reopened', dedupeKey: `window_reopened:${e.id}:${e.waveN}`, priority: 2, at: e.waveStartedAt, line: `${e.name} is back for wave ${e.waveN}. Window open again.`, href: `/lab/radar?event=${e.id}`, eventId: e.id, postId: null });
    }
    const closing = [...e.windowLog].reverse().find((l) => l.from === 'open' && l.to === 'closing');
    if (closing && !cov.some((c) => c.isOwned && c.confirmed !== false)) {
      out.push({ kind: 'window_closing', dedupeKey: `window_closing:${e.id}:${e.waveN}`, priority: 3, at: closing.at, line: `${e.name} window is closing: ${closing.reason}. You haven't covered it.`, href: `/lab/radar?event=${e.id}`, eventId: e.id, postId: null });
    }
  }
  return out;
}

const eventOk = (e: LabEvent | null, kind: LabMorningBriefKind) => !e || (e.status !== 'dismissed' && (e.windowState !== 'closed' || kind === 'window_reopened'));

/** 14.2 steps 1 to 4 (pure over the store; `previous` = the last brief composed before today). */
export function selectBriefItems(store: LabStore, now: Date, today: string): Alert[] {
  const prev = store.morningBrief.since(new Date(now.getTime() - 8 * DAY).toISOString().slice(0, 10)).filter((b) => b.day !== today);
  const since = prev[0]?.composedAt ?? new Date(now.getTime() - DAY).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const recentKeys = new Set(prev.filter((b) => b.composedAt >= weekAgo).flatMap((b) => b.dedupeKeys));
  return collectAlerts(store, now)
    .filter((a) => a.at > since && a.at <= now.toISOString())
    .filter((a) => !recentKeys.has(a.dedupeKey))
    .filter((a) => eventOk(a.eventId ? store.events.get(a.eventId) : null, a.kind))
    .sort((a, b) => a.priority - b.priority || b.at.localeCompare(a.at))
    .slice(0, MORNING_BRIEF_MAX_ITEMS);
}

export function briefHeader(now: Date, tz: string, count: number): string {
  return `Morning brief, ${localParts(now, tz).dayLong}. ${count} ${count === 1 ? 'item' : 'items'}.`;
}

/** The brief as plain text (the Wizard file and the brain doc carry it). */
export function morningBriefText(header: string, items: readonly Alert[]): string {
  return items.length ? [header, ...items.map((i, n) => `${n + 1}. ${i.line}`)].join('\n') : `${header}\n${EMPTY_BRIEF}`;
}

/** Live in-app alerts: triggered after the latest brief (or in the last 24 h) and not in any brief yet. */
export function liveAlerts(store: LabStore, now: Date): Alert[] {
  const latest = store.morningBrief.latest();
  const dayAgo = new Date(now.getTime() - DAY).toISOString();
  const since = latest && latest.composedAt > dayAgo ? latest.composedAt : dayAgo;
  const briefed = new Set(store.morningBrief.since(new Date(now.getTime() - 8 * DAY).toISOString().slice(0, 10)).flatMap((b) => b.dedupeKeys));
  return collectAlerts(store, now).filter((a) => a.at > since && !briefed.has(a.dedupeKey) && eventOk(a.eventId ? store.events.get(a.eventId) : null, a.kind));
}

/**
 * 14.2 step 5: write today's row (re-composing replaces the items and keeps `sent_at`) and the
 * brain doc `lab/morning-brief-<day>.md` under labBrainRoot() (scratch in dry, 08.8).
 */
export function composeMorningBrief(store: LabStore, opts: { now: Date; tz: string; dry: boolean; brainRoot?: string | null }): LabMorningBrief {
  const { now, tz } = opts;
  const day = localParts(now, tz).day;
  const items = selectBriefItems(store, now, day);
  const header = briefHeader(now, tz, items.length);
  const prev = store.morningBrief.get(day);
  const brief: LabMorningBrief = {
    id: `lbr-${day}`,
    day,
    composedAt: now.toISOString(),
    items,
    dedupeKeys: items.map((i) => i.dedupeKey),
    text: morningBriefText(header, items),
    sentAt: prev?.sentAt ?? null,
    sentVia: prev?.sentVia ?? null,
    sendError: prev?.sendError ?? null,
    dry: opts.dry,
  };
  store.morningBrief.upsert(brief);
  if (opts.brainRoot !== null) {
    const fm = `---\ntitle: Morning brief ${day}\nkind: lab-morning-brief\nsource: content-lab\n${GENERATED_MARKER}\n---\n\n`;
    writeBrainDocs([{ path: `lab/morning-brief-${day}.md`, content: fm + brief.text + '\n' }], opts.brainRoot ?? labBrainRoot());
  }
  return brief;
}

/** The `brief` job's cadence: due at the first tick at or after 07:30 local, once per local day. */
export function briefDue(lastAt: string | null, now: Date, tz: string): boolean {
  const p = localParts(now, tz);
  if (p.hour * 60 + p.minute < BRIEF_AT_MIN) return false;
  return !lastAt || localParts(new Date(lastAt), tz).day !== p.day || localMinutesOf(new Date(lastAt), tz) < BRIEF_AT_MIN;
}
const localMinutesOf = (d: Date, tz: string) => {
  const p = localParts(d, tz);
  return p.hour * 60 + p.minute;
};
