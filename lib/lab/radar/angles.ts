/**
 * The angle vocabulary and recommendation (05 section 12, decision C6). Section 05 owns the
 * angle set, its spelling and the recommendation; every other section imports from here and
 * declares none of them. `LAUNCH_ANGLES` itself lives in lib/schemas.ts (LaunchAngleSchema
 * needs it there) and is re-exported unchanged.
 *
 * S0 wrote the constants and recommendAngle (a pure function fully specified in 05 12.4) so
 * lanes G and V can rely on one angle from day one. Lane R owns this file and the stubs below.
 */
import { z } from 'zod';
import { LAUNCH_ANGLES, LaunchAngleSchema, type LabEvent, type LabEventCoverage, type LabWindowState, type LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';

export { LAUNCH_ANGLES, LaunchAngleSchema } from '@/lib/schemas';
export type { LaunchAngle } from '@/lib/schemas';

export type AngleId = Exclude<LaunchAngle, 'other'>;

/** Display order only: LAUNCH_ANGLES without `other`. Never picks a default. */
export const ANGLE_ORDER: readonly AngleId[] = LAUNCH_ANGLES.filter((a): a is AngleId => a !== 'other');

export const ANGLE_LABEL: Record<LaunchAngle, string> = {
  first_look: 'First look',
  real_examples: 'Real examples',
  hours_spent: 'I spent N hours',
  comparison: 'Comparison',
  how_to: 'How-to',
  money: 'Money',
  drama: 'Drama',
  other: 'Other',
};

/** 05 12.3: priors from one launch, small n (shown as text, never a bar). */
export const ANGLE_PRIORS: Partial<Record<LaunchAngle, { lift: string; n: number }>> = {
  first_look: { lift: '3.5x to 12.6x', n: 4 },
  real_examples: { lift: '3.5x to 12.6x', n: 4 },
  hours_spent: { lift: '3.5x to 12.6x', n: 4 },
  comparison: { lift: '1.24x', n: 5 },
  money: { lift: '0.94x', n: 1 },
};

/** 05 12.3 */
export type AngleCell = {
  angle: LaunchAngle;
  label: string;
  /** 1+ high-confidence tracked covering post */
  taken: boolean;
  posts: number;
  creators: number;
  /** rated posts only; null under n 1, shown 'not enough yet' under n 5 */
  medianRatio: number | null;
  n: number;
  /** hours since t0 of the first post with this angle */
  firstUsedH: number | null;
  prior: { lift: string; n: number } | null;
  recommended: boolean;
};

/** 05 12.4 */
export const ANGLE_PRIOR_ORDER: readonly AngleId[] = ['real_examples', 'first_look', 'hours_spent', 'how_to', 'comparison', 'drama', 'money'];

export type AngleOwnStats = Partial<Record<LaunchAngle, { median: number; n: number }>>;

const RECOMMEND_COPY = (a: AngleId) => `Recommended: ${ANGLE_LABEL[a]}. No tracked creator has used it yet.`;
export const ALL_TAKEN_COPY = 'Every angle is taken. A depth play (a full course) is the late move that still broke out.';

/**
 * 05 12.4, rules in order (pure, no store access). Never returns `other` and never null.
 * 1. Base order: own medians when all 7 angles have n >= 5, else ANGLE_PRIOR_ORDER.
 * 2. closing or closed window: how_to first.
 * 3. First untaken angle.
 * 4. All taken: highest own median with n >= 5, else first_look.
 */
export function recommendAngle(input: { taken: ReadonlySet<LaunchAngle>; windowState: LabWindowState | null; own: AngleOwnStats }): { angle: AngleId; allTaken: boolean; copy: string } {
  const { taken, windowState, own } = input;
  const allHaveN = ANGLE_PRIOR_ORDER.every((a) => (own[a]?.n ?? 0) >= 5);
  let order: AngleId[] = [...ANGLE_PRIOR_ORDER];
  if (allHaveN) {
    order = order
      .map((a, i) => ({ a, i, m: own[a]!.median }))
      .sort((x, y) => y.m - x.m || x.i - y.i)
      .map((x) => x.a);
  }
  if (windowState === 'closing' || windowState === 'closed') order = ['how_to', ...order.filter((a) => a !== 'how_to')];
  const free = order.find((a) => !taken.has(a));
  if (free) return { angle: free, allTaken: false, copy: RECOMMEND_COPY(free) };
  const rated = ANGLE_PRIOR_ORDER.filter((a) => (own[a]?.n ?? 0) >= 5).sort((x, y) => own[y]!.median - own[x]!.median || ANGLE_PRIOR_ORDER.indexOf(x) - ANGLE_PRIOR_ORDER.indexOf(y));
  return { angle: rated[0] ?? 'first_look', allTaken: true, copy: ALL_TAKEN_COPY };
}

/** 05 12.2: evaluated in this order, first match wins. */
export const ANGLE_RULES: [LaunchAngle, RegExp][] = [
  ['hours_spent', /\bI (spent|tested|used|tried)\b.{0,25}\b\d+\s*(hours?|hrs|days|weeks)\b|\b\d+\s*hours (with|of|using|in)\b/i],
  ['comparison', /\bvs\.?\b|\bversus\b|\bbetter than\b|\bcompared?\b|\b(beats|destroys|kills)\b/i],
  ['money', /\b(make|made|making|earn\w*)\b.{0,20}(\$|money)|\bmoney\b|\bincome\b|\bside hustle\b|\$\d/i],
  ['drama', /\b(dead|dangerous|scary|warning|lawsuit|banned|leak(ed)?|fired|controvers\w*|safety|jobs?)\b/i],
  ['how_to', /\bhow to\b|\btutorial\b|\bstep[- ]by[- ]step\b|\bguide\b|\bcourse\b|\bbeginners?\b|\bset ?up\b|\binstall\b/i],
  // spec bug fixed: 12.2 has `things (it|you) can do`, which misses its own example "28 Insane Things Astra Can Do"
  ['real_examples', /\bexamples?\b|\buse cases?\b|\bthings (?:[\w.-]+ ){0,2}can do\b|\bways to use\b|\bI built\b|\bbuilt .{0,20}\bwith\b/i],
  ['first_look', /\bfirst (look|impressions?)\b|\bis (here|out)\b|\bjust (dropped|launched|released)\b|\bit'?s (here|out)\b|\bhands[- ]on\b|\bintroducing\b/i],
];

/** 05 12.2: first matching rule, or 'other' (then the LLM batch). */
export function angleByRule(text: string): LaunchAngle {
  for (const [angle, re] of ANGLE_RULES) if (re.test(text)) return angle;
  return 'other';
}

/** Counting coverage: high confidence or confirmed, never rejected (05 11.1). */
const countsRow = (c: Pick<LabEventCoverage, 'confidence' | 'confirmed'>) => c.confirmed !== false && (c.confidence === 'high' || c.confirmed === true);

const med = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Rated high-confidence tracked covering posts, all events, last 180 days; median of the L2 ratio per angle. */
export function angleOwnStats(store: LabStore, now: Date): AngleOwnStats {
  const since = now.getTime() - 180 * 86_400_000;
  const byAngle = new Map<LaunchAngle, Map<string, number>>();
  for (const c of store.eventCoverage.all()) {
    if (c.isOwned || !countsRow(c) || c.ratio === null || Date.parse(c.postedAt) < since) continue;
    if (!byAngle.has(c.angle)) byAngle.set(c.angle, new Map());
    byAngle.get(c.angle)!.set(c.postId, c.ratio);
  }
  const out: AngleOwnStats = {};
  for (const [a, m] of byAngle) out[a] = { median: med([...m.values()])!, n: m.size };
  return out;
}

/** The angles taken on an event (12.4 input): angles of counting tracked covering posts. */
export function takenAngles(coverage: readonly LabEventCoverage[]): Set<LaunchAngle> {
  return new Set(coverage.filter((c) => !c.isOwned && countsRow(c)).map((c) => c.angle));
}

/**
 * 05 12.3: one cell per angle except `other`. Contract change (CONTRACT.md 5 "signature
 * assumed"): pure over the event's coverage rows and the own stats, which callers pass.
 */
export function angleMap(event: Pick<LabEvent, 'windowState'>, coverage: readonly LabEventCoverage[], own: AngleOwnStats): AngleCell[] {
  const tracked = coverage.filter((c) => !c.isOwned && countsRow(c));
  const rec = recommendAngle({ taken: takenAngles(coverage), windowState: event.windowState, own });
  return ANGLE_ORDER.map((angle) => {
    const rows = tracked.filter((c) => c.angle === angle);
    const rated = rows.filter((c) => c.ratio !== null).map((c) => c.ratio!);
    const first = rows.map((c) => c.hoursSinceT0).sort((x, y) => x - y)[0];
    return {
      angle,
      label: ANGLE_LABEL[angle],
      taken: rows.length > 0,
      posts: rows.length,
      creators: new Set(rows.map((c) => c.sourceId)).size,
      medianRatio: med(rated),
      n: rated.length,
      firstUsedH: first === undefined ? null : first,
      prior: ANGLE_PRIORS[angle] ?? null,
      recommended: rec.angle === angle,
    };
  });
}

export const AngleReplySchema = z.object({ items: z.array(z.object({ postId: z.string(), angle: LaunchAngleSchema })) });
export type AngleAsk = (prompt: string) => Promise<{ ok: true; data: z.infer<typeof AngleReplySchema> } | { ok: false; unavailable?: boolean; error: string }>;

/**
 * 05 12.2: rule-assigned `other` rows go to one LLM batch of up to 20 posts per tick.
 * Dry or no CLI: they stay `other`. Manual angles are never touched.
 */
export async function assignAngles(store: LabStore, opts: { ask?: AngleAsk | null; dry: boolean; limit?: number }): Promise<{ asked: number; assigned: number }> {
  const todo = store.eventCoverage.all().filter((c) => c.angle === 'other' && c.angleSource === 'rule');
  const posts = [...new Set(todo.map((c) => c.postId))].slice(0, opts.limit ?? 20);
  if (!posts.length || opts.dry || !opts.ask) return { asked: 0, assigned: 0 };
  const lines = posts.map((id) => `postId ${id}: ${(store.posts.get(id)?.caption ?? '').slice(0, 200)} ${store.dissections.get(id)?.hookText ?? ''}`.trim());
  const prompt = [
    'Classify each post about an AI launch into one angle:',
    'first_look (first impressions), real_examples (use cases, things it can do), hours_spent (a time-investment test), comparison (vs a rival), how_to (tutorial, setup, course), money (earning with it), drama (jobs, safety, leaks, lawsuits, warnings), other.',
    'Reply with strict JSON only: {"items":[{"postId":"...","angle":"..."}]}',
    '',
    ...lines,
  ].join('\n');
  const reply = await opts.ask(prompt);
  let assigned = 0;
  if (reply.ok) {
    for (const it of reply.data.items) {
      for (const c of todo.filter((x) => x.postId === it.postId)) {
        store.eventCoverage.upsert({ ...c, angle: it.angle, angleSource: 'llm' });
        assigned++;
      }
    }
  }
  return { asked: posts.length, assigned };
}
