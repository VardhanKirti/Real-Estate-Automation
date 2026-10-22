import { randomUUID } from 'node:crypto';
import { proofStats } from '@/lib/creative-engine/angles';
import { FRAMEWORK_BANK } from '@/lib/creative-engine/frameworks';
import { TONE_BANK } from '@/lib/creative-engine/compose';
import type { Angle, Brief, Campaign, PoolAd, ProofBlock, Script, ScriptVersion } from '@/lib/creative-engine/schemas';

/**
 * Briefs — the deliverable when only proven ideas and scripts are wanted.
 * Deterministic: no model call. The proof block states in print that
 * longevity-while-live is the only spend proxy and that no engagement or
 * spend figures exist for these ads.
 */

export const PROOF_NOTE = 'Longevity while live is the only spend proxy available for these ads. No engagement, spend, CTR or revenue figures exist for them, and none are implied.';

export function buildProof(pool: PoolAd[], angle: Angle): ProofBlock {
  const ads = angle.proofAdIds.map((id) => pool.find((a) => a.id === id)).filter((a): a is PoolAd => !!a);
  const stats = proofStats(pool, angle.proofAdIds);
  return {
    ads: ads.map((a) => ({ id: a.id, brand: a.brand, hook: a.hook, daysRunning: a.daysRunning, live: a.live, format: a.format, duplicates: a.duplicates, linkUrl: a.linkUrl })),
    medianDays: stats.medianDays,
    drivers: stats.drivers,
    note: PROOF_NOTE,
  };
}

function proofTable(p: ProofBlock): string {
  const rows = p.ads.map((a) => `| ${a.brand} | ${a.hook ? a.hook.replace(/\|/g, '/') : '—'} | ${a.daysRunning} | ${a.live ? 'live' : 'off'} | ${a.format ?? '—'} | ${a.duplicates ?? '—'} |`);
  return ['| Brand | Hook | Days running | Status | Format | Copies |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

function driverBars(d: Record<string, number>): string {
  const top = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length === 0) return '_no driver data_';
  return top.map(([k, v]) => `- ${k}: ${'█'.repeat(Math.max(1, Math.round(v)))} ${v}`).join('\n');
}

export function buildBrief(campaign: Campaign, script: Script, version: ScriptVersion, angle: Angle): Brief {
  const pool = campaign.research?.pool ?? [];
  const proof = buildProof(pool, angle);
  const fw = FRAMEWORK_BANK[script.framework];
  const tone = TONE_BANK[script.controls.tone];
  const title = `${angle.title} — ${campaign.concept.text.slice(0, 50)}`;
  const md = [
    `# ${title}`,
    '',
    `**Angle.** ${angle.thesis}`,
    angle.whyItWorks ? `**Why it works.** ${angle.whyItWorks}` : '',
    angle.hookPattern ? `**Hook pattern.** ${angle.hookPattern}` : '',
    '',
    '## Proof',
    proofTable(proof),
    '',
    proof.medianDays !== null ? `Median longevity of the proof set: **${proof.medianDays} days** while live.` : 'No longevity data on the proof set.',
    '',
    '**Driver fingerprint (mean of the proof ads):**',
    driverBars(proof.drivers),
    '',
    `> ${PROOF_NOTE}`,
    '',
    `## Script (${fw.label}${version.targetSeconds ? `, ${version.targetSeconds}s` : ', no length cap'})`,
    ...version.beats.map((b) => `**${b.name}** (${b.seconds}s)\n${b.spoken}${b.action ? `\n_On screen: ${b.action}_` : ''}\n`),
    `**CTA.** ${version.cta}`,
    '',
    `${version.wordCount} spoken words${version.targetSeconds ? ` for ${version.targetSeconds}s` : ''} · ${version.fits ? 'fits' : 'OVER budget'} · tone: ${tone.label}`,
    '',
    '## Deliverable',
    `- Formats proven for this angle: ${angle.formats.join(', ')}`,
    `- Aspect: 9:16 first; 1:1 for feed if the angle proved on image`,
    `- Duration: ${version.targetSeconds ? `${version.targetSeconds}s` : 'open'}`,
    `- Production: ${angle.formats.includes('video') ? 'UGC actor (Arcads) or Motion Console; scripted beats above are actor-ready' : 'static or Motion Console image'}`,
    '',
    '## Provenance',
    `- Concept: "${campaign.concept.text}"`,
    campaign.research ? `- Research: ${campaign.research.depth} depth, ${campaign.research.probes.length} probes (${campaign.research.probes.map((p) => `"${p.query}"`).join(', ')}), ${campaign.research.apiCalls} Foreplay calls, ${campaign.research.expandedBy}` : '- Research: none',
    `- Script version ${version.n} by ${version.by} at ${version.at}`,
    `- Generated ${new Date().toISOString()}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { id: `brf-${randomUUID().slice(0, 6)}`, scriptId: script.id, angleId: angle.id, title, markdown: md, proof, status: 'ready', at: new Date().toISOString() };
}
