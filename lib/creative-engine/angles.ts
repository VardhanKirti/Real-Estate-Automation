import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ANTI_INVENTION_RULE, claudeJson } from '@/lib/creative-engine/claude';
import { isDry } from '@/lib/creative-engine/dry';
import { AngleSchema, type Angle, type Campaign, type PoolAd } from '@/lib/creative-engine/schemas';

/**
 * Angles — grounded on the research pool the way /api/adscout/ask is
 * grounded: the model sees only real ads and must cite them by id. Any
 * angle citing an unknown id is dropped, not "fixed". Proof stats are
 * computed here, never asked of the model.
 */

const AngleReplySchema = z.object({
  angles: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        thesis: z.string().min(1).max(400),
        hookPattern: z.string().max(200).default(''),
        whyItWorks: z.string().max(400).default(''),
        proofAdIds: z.array(z.string()).min(1).max(6),
        drivers: z.array(z.string()).max(5).default([]),
        formats: z.array(z.enum(['video', 'image'])).default(['video']),
        confidence: z.enum(['strong', 'plausible']).default('plausible'),
      }),
    )
    .min(2)
    .max(8),
});

export function serializePool(pool: PoolAd[], limit = 30): string {
  return pool
    .slice(0, limit)
    .map((a) => {
      const top = Object.entries(a.drivers).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
      return `- id=${a.id} · ${a.brand} · ${a.format ?? 'ad'} · ${a.daysRunning}d${a.live ? ' live' : ' off'}${a.duplicates != null ? ` · ${a.duplicates} copies` : ''} · hook: "${a.hook ?? '(none)'}" · drivers: ${top || 'n/a'}`;
    })
    .join('\n');
}

export function proofStats(pool: PoolAd[], ids: string[]): { medianDays: number | null; drivers: Record<string, number>; duplicates: number | null } {
  const ads = ids.map((id) => pool.find((a) => a.id === id)).filter((a): a is PoolAd => !!a);
  if (ads.length === 0) return { medianDays: null, drivers: {}, duplicates: null };
  const days = ads.map((a) => a.daysRunning).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const medianDays = days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
  const sums = new Map<string, { t: number; n: number }>();
  for (const a of ads) for (const [k, v] of Object.entries(a.drivers)) {
    const cur = sums.get(k) ?? { t: 0, n: 0 };
    cur.t += v;
    cur.n += 1;
    sums.set(k, cur);
  }
  const drivers = Object.fromEntries([...sums.entries()].map(([k, { t, n }]) => [k, Math.round((t / n) * 10) / 10]));
  const dupKnown = ads.filter((a) => a.duplicates != null);
  const duplicates = dupKnown.length ? dupKnown.reduce((s, a) => s + (a.duplicates ?? 0), 0) : null;
  return { medianDays, drivers, duplicates };
}

function dryAngles(pool: PoolAd[]): Angle[] {
  const ids = pool.map((a) => a.id);
  return [
    { title: 'A lamp with a bedtime', thesis: 'The longest-running ads sell the evening the buyer gets back, not the product.', hookPattern: '"My X has a bedtime"', whyItWorks: 'Relief plus curiosity; the outcome is time, not a feature.', proofAdIds: ids.slice(0, 2), drivers: ['relief', 'curiosity'], formats: ['video'], confidence: 'strong' },
    { title: 'Eyes back in a week', thesis: 'A felt change with a time on it beats any spec.', hookPattern: '"My eyes stopped hurting in N days"', whyItWorks: 'A body result with a number; the proof ad has run 29 days live.', proofAdIds: ids.slice(3, 4), drivers: ['relief'], formats: ['video'], confidence: 'plausible' },
    { title: 'The calm desk', thesis: 'Status framing: the desk people screenshot.', hookPattern: '"The calmest X on the internet"', whyItWorks: 'Status is the top driver on the image ad still live at 33 days.', proofAdIds: ids.slice(2, 3), drivers: ['status'], formats: ['image', 'video'], confidence: 'plausible' },
  ].map((a) => AngleSchema.parse({ ...a, id: `ang-${randomUUID().slice(0, 6)}`, selected: false }));
}

export async function generateAngles(campaign: Campaign): Promise<{ angles: Angle[]; dropped: number; by: 'claude' | 'dry' }> {
  const pool = campaign.research?.pool ?? [];
  if (pool.length === 0) throw new Error('run research first: no proof ads to ground angles on');
  if (isDry()) return { angles: dryAngles(pool), dropped: 0, by: 'dry' };

  const c = campaign.concept;
  const prompt = [
    'You are an ad strategist proposing creative ANGLES for a new campaign, grounded ONLY in the proven ads listed below (all still running after the threshold, ranked by longevity).',
    `Concept: "${c.text}"${c.product ? ` · Product: ${c.product}` : ''}${c.audience ? ` · Audience: ${c.audience}` : ''}${c.goal !== 'unset' ? ` · Goal: ${c.goal}` : ''}`,
    '',
    'PROVEN ADS:',
    serializePool(pool),
    '',
    ANTI_INVENTION_RULE,
    'Propose 4-8 distinct angles. Each angle must cite 1-6 proofAdIds from the list that demonstrate the pattern. confidence is "strong" only when 2+ proof ads with 30+ days support it.',
    'Reply with STRICT JSON only: {"angles":[{"title":"","thesis":"","hookPattern":"","whyItWorks":"","proofAdIds":[""],"drivers":[""],"formats":["video"],"confidence":"strong"|"plausible"}]}. No markdown.',
  ].join('\n');

  const res = await claudeJson(prompt, AngleReplySchema, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(res.unavailable ? 'Claude engine not present on this host' : `angle generation failed: ${res.error}`);

  const known = new Set(pool.map((a) => a.id));
  let dropped = 0;
  const angles: Angle[] = [];
  for (const a of res.data.angles) {
    const ids = a.proofAdIds.filter((id) => known.has(id));
    if (ids.length === 0) {
      dropped += 1;
      continue;
    }
    angles.push(AngleSchema.parse({ ...a, proofAdIds: ids, id: `ang-${randomUUID().slice(0, 6)}`, selected: false }));
  }
  if (angles.length === 0) throw new Error('every proposed angle cited unknown ads; nothing kept');
  return { angles, dropped, by: 'claude' };
}
