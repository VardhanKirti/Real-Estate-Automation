/**
 * Idea creation outside sync and Generate (07 7.4): `makeFromEvent` (Make this, from a Radar
 * event) and `createIdea` (the Studio New idea form). Both go through POST /api/lab/ideas and
 * both refuse unless 2 or more distinct breakouts ground the idea (01 D11, 7.4.1). Neither
 * writes anything or calls a model when it refuses.
 */
import { VsCandidateSchema, type LabEvent, type LabGrounding, type LabIdea, type LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { gatedCall } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { enrichIdea, hookRecs, ideaContext, type RawIdea } from '@/lib/lab/ideas';
import { fmtRatio } from '@/lib/lab/measures';
import { ANGLE_LABEL, ANGLE_ORDER, angleMap, angleOwnStats, recommendAngle, takenAngles as takenAnglesR, type AngleId } from '@/lib/lab/radar/angles';
import { contrastBlock, groundingCount, groundingRefusal } from '@/lib/lab/gen/grounding';
import { takenAngles } from '@/lib/lab/gen/events';
import { ANTI_INVENTION_V2 } from '@/lib/lab/gen/diversity';
import type { z } from 'zod';

export const EVENT_IDEA_PROMPT_VERSION = 'event-idea-v1';
export const EVENT_IDEA_TIMEOUT_MS = 120_000;

export const COPY = {
  notTracked: 'This launch is no longer tracked.',
  windowClosed: 'This window has closed.',
  shortTitle: 'Write at least 8 characters.',
  invented: "The model's idea cited posts that are not in the Lab. Nothing was saved.",
} as const;

export type IdeaCreateResult =
  | { ok: true; ideaId: string; href: string; existing: boolean; idea: LabIdea }
  | { ok: false; status: 400 | 404 | 422 | 502 | 503; error: string };

export type EventIdeaAsk = (prompt: string) => Promise<ClaudeJson<z.input<typeof VsCandidateSchema>>>;

const ideaHref = (id: string) => `/lab/studio?idea=${encodeURIComponent(id)}`;
const isAngleId = (a: unknown): a is AngleId => typeof a === 'string' && (ANGLE_ORDER as readonly string[]).includes(a);

/** Steps 1 and 2 of 7.4.2: a confirmed event with an open or closing window. */
export function checkEvent(store: LabStore, eventId: string): { ok: true; event: LabEvent } | { ok: false; status: 422; error: string } {
  const event = store.events.get(eventId);
  if (!event || event.status !== 'confirmed') return { ok: false, status: 422, error: COPY.notTracked };
  if (event.windowState !== 'open' && event.windowState !== 'closing') return { ok: false, status: 422, error: COPY.windowClosed };
  return { ok: true, event };
}

function mostCommon<T>(xs: readonly T[]): T | null {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) {
    best = k;
    n = v;
  }
  return best;
}

/** Evidence rows for the stored idea: up to 3 grounding posts, list 1 (coverage) first. */
function evidenceRows(store: LabStore, postIds: readonly string[]): { postId: string; why: string }[] {
  return postIds.slice(0, 3).map((id) => {
    const m = store.measures.get(id);
    return { postId: id, why: m?.breakout != null ? `${fmtRatio(m.breakout)} its creator's normal` : 'broke out for its creator' };
  });
}

/** Insert-time fields shared by both actions (7.4.2 step 7, 7.4.3 step 4). */
function baseIdea(store: LabStore, a: { title: string; angleText: string; family: string | null; evidence: { postId: string; why: string }[]; clusterId: string | null; tension: LabIdea['tension']; now: Date }): LabIdea {
  const ctx = ideaContext(store, { now: a.now });
  const family = a.family ?? mostCommon(a.evidence.map((e) => store.dissections.get(e.postId)?.format).filter((f): f is NonNullable<typeof f> => Boolean(f))) ?? ctx.families[0] ?? 'other';
  // enrichIdea needs every evidence post in its info map; coverage posts from outside the clusters are added here
  for (const e of a.evidence) {
    if (ctx.postInfo.has(e.postId)) continue;
    const p = store.posts.get(e.postId);
    const d = store.dissections.get(e.postId);
    const m = store.measures.get(e.postId);
    if (p) ctx.postInfo.set(e.postId, { postId: e.postId, handle: store.sources.get(p.sourceId)?.handle ?? '', platform: p.platform, format: d?.format ?? 'other', breakout: Math.round((m?.breakout ?? 0) * 10) / 10, isBreakout: m?.isBreakout ?? false, hookForm: d?.hookForm ?? 'other', hookText: d?.hookText ?? '', angle: '', pillar: d?.pillar ?? 'educational' });
  }
  const raw: RawIdea = { title: a.title, clusterId: a.clusterId ?? '', angle: a.angleText, tension: a.tension, formatFamily: family, evidence: a.evidence };
  const idea = enrichIdea(store, raw, ctx, { createdAt: a.now.toISOString() });
  return { ...idea, clusterId: a.clusterId, evidence: a.evidence };
}

/** The event block for the event-idea-v1 prompt: 05's angle map over the event's coverage. */
function eventBlock(store: LabStore, event: LabEvent, now: Date): string[] {
  const lines = [`EVENT: event=${event.id} · ${event.name}${event.vendor ? ` · by ${event.vendor}` : ''} · t0 ${event.t0 ?? 'n/a'} · window ${event.windowState ?? 'n/a'}`];
  for (const c of angleMap(event, store.eventCoverage.forEvent(event.id), angleOwnStats(store, now))) lines.push(`- angle ${c.angle} · ${c.taken ? 'taken' : 'untaken'} · ${c.posts} posts · ${c.medianRatio === null ? 'n/a' : fmtRatio(c.medianRatio)} median (n ${c.n})`);
  return lines;
}

export function eventIdeaPrompt(store: LabStore, event: LabEvent, angle: AngleId, grounding: LabGrounding, families: string[], feedback: string | null, now: Date = new Date()): string {
  const handle = (id: string) => store.sources.get(id)?.handle ?? id;
  return [
    'You propose ONE short-form video idea for a creator in the AI space about a launch that is happening now, grounded only in the material below.',
    `The creator's formats: ${families.join(', ') || 'unknown'}.`,
    '',
    ...eventBlock(store, event, now),
    '',
    `ANGLE: ${angle} (${ANGLE_LABEL[angle]}).`,
    '',
    contrastBlock(grounding, handle, { short: true }),
    '',
    ANTI_INVENTION_V2,
    ...(feedback ? [`Your previous reply was thrown away: ${feedback}`] : []),
    'No dashes of any kind. Plain words.',
    `Reply with STRICT JSON only: {"title":"","clusterId":null,"eventId":"${event.id}","seedId":null,"angle":"","angleClass":"${angle}","hookForm":"news_react","trigger":"curiosity","tension":null,"formatFamily":"","evidence":[{"postId":"","why":""}],"probability":0.5}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

export type MakeOpts = { now?: Date; ask?: EventIdeaAsk; override?: boolean; recommend?: typeof recommendAngle };

/** 7.4.2 `from_event`. */
export async function makeFromEvent(store: LabStore, req: { eventId: string; angle?: string | null }, opts: MakeOpts = {}): Promise<IdeaCreateResult> {
  const now = opts.now ?? new Date();
  const ev = checkEvent(store, req.eventId);
  if (!ev.ok) return ev;
  const event = ev.event;
  let angle: AngleId;
  if (req.angle) {
    if (!isAngleId(req.angle)) return { ok: false, status: 400, error: `angle must be one of ${ANGLE_ORDER.join(', ')}` };
    angle = req.angle;
  } else {
    const rec = (opts.recommend ?? recommendAngle)({ taken: takenAnglesR(store.eventCoverage.forEvent(event.id)), windowState: event.windowState, own: angleOwnStats(store, now) }) as ReturnType<typeof recommendAngle> | null;
    if (!rec) return { ok: false, status: 422, error: 'Every angle is taken. A depth play (a full course) is the late move that still broke out.' };
    angle = rec.angle;
  }
  const existing = store.ideas.all('open').find((i) => i.eventId === event.id && i.launchAngle === angle);
  if (existing) return { ok: true, ideaId: existing.id, href: ideaHref(existing.id), existing: true, idea: existing };
  const g = groundingCount(store, { angle, eventId: event.id, query: event.name, now });
  if (g.count < 2) return { ok: false, status: 422, error: groundingRefusal(g.count) };

  const families = [...new Set(store.profiles.latest().map((p) => p.formatFamily))];
  const allowed = new Set(g.postIds);
  const evidence = evidenceRows(store, g.postIds);
  const ask: EventIdeaAsk = opts.ask ?? ((p) => claudeJson(p, VsCandidateSchema, { timeoutMs: EVENT_IDEA_TIMEOUT_MS }));
  type Reply = { title: string; hookForm: LabIdea['hookForm']; trigger: LabIdea['hookTrigger']; tension: LabIdea['tension']; family: string | null; why: Map<string, string> };
  let reply: Reply;
  try {
    const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'ideas', actor: 'claude-cli', input: { promptVersion: EVENT_IDEA_PROMPT_VERSION, eventId: event.id, angle }, override: opts.override, now }, {
      dry: () => {
        const rec = hookRecs(store, families[0] ?? 'tutorial_walkthrough')[0];
        const taken = takenAngles(store, event.id);
        return {
          result: {
            title: `${event.name}: ${ANGLE_LABEL[angle]}`,
            hookForm: rec?.form ?? 'news_react',
            trigger: rec?.trigger ?? 'curiosity',
            tension: taken.size ? { falseBelief: `Everyone already covered ${event.name}`, reframe: `${ANGLE_LABEL[angle]} is the part that still breaks out` } : null,
            family: null,
            why: new Map<string, string>(),
          } as Reply,
        };
      },
      live: async () => {
        let feedback: string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await ask(eventIdeaPrompt(store, event, angle, g.grounding, families, feedback, now));
          if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `event idea failed: ${res.error}`);
          const parsed = VsCandidateSchema.safeParse(res.data);
          if (!parsed.success) {
            feedback = parsed.error.issues[0]?.message ?? 'invalid reply';
            continue;
          }
          const c = parsed.data;
          const bad = c.evidence.map((e) => e.postId).filter((id) => !allowed.has(id));
          if (c.eventId !== event.id || c.clusterId || (c.seedId ?? null) !== null || bad.length) {
            feedback = bad.length ? `it cited ${bad.join(', ')}, which are not listed` : 'it cited an id that is not listed';
            continue;
          }
          return { result: { title: c.title, hookForm: c.hookForm, trigger: c.trigger, tension: c.tension, family: c.formatFamily, why: new Map(c.evidence.map((e) => [e.postId, e.why])) } as Reply, units: attempt + 1, actualUsd: 0 };
        }
        throw new Error(COPY.invented);
      },
    });
    reply = out.result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === 'CapError') throw e;
    if (/not on this host/.test(msg)) return { ok: false, status: 503, error: 'The claude CLI is not on this host. Generate needs it.' };
    return { ok: false, status: 502, error: msg === COPY.invented ? COPY.invented : msg };
  }

  const ev3 = evidence.map((e) => ({ postId: e.postId, why: reply.why.get(e.postId)?.trim() || e.why }));
  const idea = baseIdea(store, { title: reply.title, angleText: ANGLE_LABEL[angle].toLowerCase(), family: reply.family && families.includes(reply.family) ? reply.family : null, evidence: ev3, clusterId: event.clusterId, tension: reply.tension, now });
  const stored: LabIdea = {
    ...idea,
    timing: event.windowState === 'closing' ? 'closing' : 'open',
    thin: g.grounding.exemplars.length < 3,
    status: 'open',
    source: 'event',
    eventId: event.id,
    launchAngle: angle,
    batchId: null,
    seedId: null,
    notes: null,
    hookForm: reply.hookForm ?? null,
    hookTrigger: reply.trigger ?? null,
    vsProbability: null,
    mmrRank: null,
    grounding: g.grounding,
    promptVersion: isDry() ? 'dry' : EVENT_IDEA_PROMPT_VERSION,
  };
  store.ideas.upsert(stored);
  return { ok: true, ideaId: stored.id, href: ideaHref(stored.id), existing: false, idea: stored };
}

/** 7.4.3 `create`: validation, the event checks when given, grounding, insert. No model call. */
export function createIdea(store: LabStore, req: { title?: unknown; angle?: unknown; eventId?: unknown; notes?: unknown }, opts: { now?: Date } = {}): IdeaCreateResult {
  const now = opts.now ?? new Date();
  const title = typeof req.title === 'string' ? req.title.replace(/\s+/g, ' ').trim() : '';
  if (title.length < 8) return { ok: false, status: 400, error: COPY.shortTitle };
  if (title.length > 120) return { ok: false, status: 400, error: 'title: at most 120 characters.' };
  if (req.notes !== undefined && req.notes !== null && (typeof req.notes !== 'string' || req.notes.length > 500)) return { ok: false, status: 400, error: 'notes: at most 500 characters.' };
  const notes = typeof req.notes === 'string' && req.notes.trim() ? req.notes.trim() : null;
  const angle = req.angle;
  if (!(isAngleId(angle) || angle === 'other')) return { ok: false, status: 400, error: `angle must be one of ${[...ANGLE_ORDER, 'other'].join(', ')}` };
  const launchAngle = angle as LaunchAngle;
  let eventId: string | null = null;
  if (req.eventId !== undefined && req.eventId !== null && req.eventId !== '') {
    if (typeof req.eventId !== 'string') return { ok: false, status: 400, error: 'eventId must be a string.' };
    const ev = checkEvent(store, req.eventId);
    if (!ev.ok) return ev;
    eventId = ev.event.id;
  }
  const g = groundingCount(store, { angle: launchAngle, eventId, query: `${title} ${notes ?? ''}`.trim(), now });
  if (g.count < 2) return { ok: false, status: 422, error: groundingRefusal(g.count) };
  const evidence = evidenceRows(store, g.postIds);
  const clusters = evidence.map((e) => store.topics.forPost(e.postId).find((t) => t.isPrimary)?.clusterId ?? null).filter((c): c is string => Boolean(c));
  const clusterId = mostCommon(clusters);
  const idea = baseIdea(store, { title, angleText: launchAngle === 'other' ? 'Other' : ANGLE_LABEL[launchAngle], family: null, evidence, clusterId, tension: null, now });
  const event = eventId ? store.events.get(eventId) : null;
  const stored: LabIdea = {
    ...idea,
    title,
    angle: launchAngle === 'other' ? 'Other' : ANGLE_LABEL[launchAngle],
    timing: event ? (event.windowState === 'closing' ? 'closing' : 'open') : idea.timing,
    thin: g.grounding.exemplars.length < 3,
    status: 'open',
    source: 'manual',
    eventId,
    launchAngle,
    batchId: null,
    seedId: null,
    notes,
    hookForm: null,
    hookTrigger: null,
    vsProbability: null,
    mmrRank: null,
    grounding: g.grounding,
    promptVersion: null,
  };
  store.ideas.upsert(stored);
  return { ok: true, ideaId: stored.id, href: ideaHref(stored.id), existing: false, idea: stored };
}
