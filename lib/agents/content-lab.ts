import { z } from 'zod';
import type { Agent } from '@/lib/schemas';
import type { LlmToolSpec } from '@/lib/connectors/llm';
import type { AgentRunResult, RuntimeAgent } from '@/lib/agents/runtime';
import type { LabStore } from '@/lib/lab/store';
import { apifyConfigured } from '@/lib/connectors/apify';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { isDry } from '@/lib/lab/dry';
import { buildLabView, buildSpecimen } from '@/lib/lab/view/legacy';
import { runLabIntel } from '@/lib/lab/intel';
import { generateScript } from '@/lib/lab/scripts';
import { FORMAT_LABEL } from '@/lib/lab/distill';
import { fmtRatio } from '@/lib/lab/measures';

/**
 * The Content Lab agent (SPEC §8), modelled on Ad Scout: its run is the intelligence
 * cycle (lib/lab/intel.ts; each run writes an agent_runs row through the runtime), its
 * chat tools are read-only views of the Lab, and its one write tool, draftScript, only
 * ever creates a DRAFT script (through the spend gate).
 *
 * Naming: shared code uses the neutral id `content-lab` and the neutral name
 * "Content Lab". The display name comes from roster data (the agents table): a row with
 * this id, or a roster persona whose tools list `content-lab` (the Filming roster binds
 * it to its Creative Director that way). No personal name is hard-coded here.
 */

export const LAB_AGENT_ID = 'content-lab';
export const LAB_AGENT_DEFAULT_NAME = 'Content Lab';

/** The display name from roster rows: the agent's own row, else a persona bound to it by tools, else the neutral default. */
export function labAgentName(roster: readonly Pick<Agent, 'id' | 'name' | 'tools'>[]): string {
  return roster.find((a) => a.id === LAB_AGENT_ID)?.name || roster.find((a) => a.tools.includes(LAB_AGENT_ID))?.name || LAB_AGENT_DEFAULT_NAME;
}

type World = () => Promise<{ store: LabStore; configured: boolean; setupHref: string }>;

const defaultWorld: World = async () => {
  const { resolveLab } = await import('@/lib/lab/context');
  const ctx = resolveLab();
  return { store: ctx.store, configured: ctx.flags.configured, setupHref: ctx.flags.setupHref };
};

const famLabel = (f: string) => (FORMAT_LABEL as Record<string, string>)[f] ?? f.replaceAll('_', ' ');

/* ── read-only tools (plain text answers, every number with its n) ─────── */

export async function breakoutsFor(world: World, format: string | null, windowDays: number): Promise<string> {
  const { store, configured, setupHref } = await world();
  const v = buildLabView(store, { configured, setupHref, tab: 'breakouts', filters: { format, windowDays: [7, 30, 90].includes(windowDays) ? windowDays : 30 } });
  const b = v.breakouts;
  if (!b || b.specimens.length === 0) return `No breakouts${format ? ` in ${famLabel(format)}` : ''} in the last ${b?.applied.windowDays ?? windowDays} days.`;
  return [`${b.total} breakouts${format ? ` in ${famLabel(format)}` : ''}, last ${b.applied.windowDays} days (top ${Math.min(10, b.specimens.length)}):`, ...b.specimens.slice(0, 10).map((s) => `- ${s.postId} · @${s.creator.handle} · ${s.ladder.label} (baseline n ${s.ladder.n}) · ${s.formatLabel} · "${s.hookText}"`)].join('\n');
}

export async function viralProfile(world: World, format: string | null): Promise<string> {
  const { store, configured, setupHref } = await world();
  const v = buildLabView(store, { configured, setupHref, tab: 'profile', profileFamily: format });
  const p = v.profile?.profiles.find((x) => x.family === (format ?? v.profile?.selected));
  if (!p) return `No Viral Profile${format ? ` for ${famLabel(format)}` : ''} yet. Families with one: ${v.profile?.profiles.map((x) => x.family).join(', ') || 'none'}.`;
  return [`${p.label}, version ${p.version}: ${p.postsN} posts, ${p.breakoutsN} breakouts${p.thin ? ' (thin data)' : ''}.`, ...p.sentences, ...(p.gaps.length ? [`Your gaps: ${p.gaps.map((g) => `${g.label} (niche ${fmtRatio(g.nicheLift)}, you ${Math.round(g.yourShare * 100)}% of ${g.yourN})`).join('; ')}.`] : [])].join('\n');
}

export async function openTrends(world: World): Promise<string> {
  const { store, configured, setupHref } = await world();
  const rows = buildLabView(store, { configured, setupHref, tab: 'trends' }).trends?.rows.filter((r) => r.timing === 'early' || r.timing === 'open') ?? [];
  if (rows.length === 0) return 'No early or open trends right now.';
  return rows
    .map((r) => {
      const ex = r.angles.filter((a) => a.exhausted).map((a) => a.angle);
      return `- ${r.label} (${r.clusterId}): ${r.timing}, momentum ${r.momentumText ?? 'n/a'}, ${r.creators} creators, ${r.breakouts} breakouts this week, ${r.coverage.covered ? 'you covered it' : 'not covered by you'}${ex.length ? `; exhausted angles: ${ex.join(', ')}` : ''}`;
    })
    .join('\n');
}

export async function ideaQueue(world: World): Promise<string> {
  const { store, configured, setupHref } = await world();
  const open = buildLabView(store, { configured, setupHref, tab: 'ideas' }).ideas?.open ?? [];
  if (open.length === 0) return 'The idea queue is empty.';
  return open.map((i) => `- ${i.id}: ${i.title} · ${i.familyLabel} · fit ${i.fitText} · ${i.timing ?? 'no timing'} · ${i.evidence.length} evidence posts${i.thin ? ' (thin)' : ''}${i.scriptId ? ` · script ${i.scriptId}` : ''}`).join('\n');
}

export async function specimen(world: World, postId: string): Promise<string> {
  const { store } = await world();
  const s = buildSpecimen(store, postId);
  if (!s) return `No post ${postId} in the Lab.`;
  return [
    `${s.postId} · @${s.creator.handle} on ${s.platform} · ${s.formatLabel} · ${s.ladder.label} (baseline n ${s.ladder.n})`,
    `Hook: "${s.hookText}"`,
    s.dissection ? `Hook form ${s.dissection.hookFormLabel}, trigger ${s.dissection.triggerLabel}, structure ${s.dissection.structureLabel}.` : 'Not dissected yet.',
    s.strand ? `Shape: ${s.strand.template}.` : '',
    s.metrics.views !== null ? `Views ${s.metrics.views}, ${s.metrics.depthText ?? 'depth n/a'}.` : '',
    s.why.length ? `Why it worked: ${s.why.map((w) => `${w.featureLabel} ${w.valueLabel} (${w.liftText}, n ${w.n})`).join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function draftScript(world: World, ideaId: string): Promise<string> {
  const { store } = await world();
  if (!store.ideas.get(ideaId)) return `No idea ${ideaId}. Ask for the idea queue first.`;
  const r = await generateScript(store, ideaId);
  const failing = r.version.gate.checks.filter((c) => !c.ok);
  return `Draft ${r.scriptId} written (version 1, ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}). ${r.version.gate.passed ? 'It passed the gate.' : `Gate failures: ${failing.map((c) => `${c.label} (${c.detail})`).join('; ')}.`} Open /lab?script=${r.scriptId}`;
}

export function contentLabAgent(world: World = defaultWorld): RuntimeAgent {
  return {
    id: LAB_AGENT_ID,
    name: LAB_AGENT_DEFAULT_NAME,
    description: 'Content intelligence: what breaks out in your formats, which topics are open, grounded ideas and scripts in your voice.',
    departmentId: 'dept-marketing-growth',
    configured: () => apifyConfigured() || isDry(),
    async run(): Promise<AgentRunResult> {
      const { store, configured } = await world();
      if (!configured && !isDry()) return { ok: false, summary: `Content Lab needs Apify: connect it at ${setupHrefFor('apify')}` };
      if (store.isEmpty()) return { ok: false, summary: 'Content Lab has no accounts yet: add yours at /lab?tab=sources' };
      const r = await runLabIntel(store, { scheduled: true });
      return { ok: r.ok, summary: `${r.dry ? 'Dry run. ' : ''}${r.summary}`.slice(0, 900), data: r };
    },
    chatTools(): LlmToolSpec[] {
      return [
        { name: 'breakoutsFor', description: 'Posts that beat their own creator\'s normal (3x or more), strongest first, for a format family (e.g. tutorial_walkthrough) over 7, 30 or 90 days. Read-only.', parameters: z.object({ format: z.string().optional().describe('format family id, omit for all'), windowDays: z.number().optional().describe('7, 30 or 90') }), execute: async (a) => breakoutsFor(world, typeof a.format === 'string' ? a.format : null, typeof a.windowDays === 'number' ? a.windowDays : 30) },
        { name: 'viralProfile', description: 'The Viral Profile for a format family: what breakouts do differently, each statement with lift, n and interval, plus your gaps. Read-only.', parameters: z.object({ format: z.string().optional() }), execute: async (a) => viralProfile(world, typeof a.format === 'string' ? a.format : null) },
        { name: 'openTrends', description: 'Topic clusters whose window is early or open, with momentum, creators, your coverage and exhausted angles. Read-only.', parameters: z.object({}), execute: async () => openTrends(world) },
        { name: 'ideaQueue', description: 'The open idea queue with fit, timing and evidence counts. Read-only.', parameters: z.object({}), execute: async () => ideaQueue(world) },
        { name: 'specimen', description: 'One post dissected: hook, shape, ladder value and why it worked. Read-only.', parameters: z.object({ postId: z.string() }), execute: async (a) => specimen(world, String(a.postId ?? '')) },
        { name: 'draftScript', description: 'Write a DRAFT script for an idea id (never publishes; passes the validation gate before it is shown as ready).', parameters: z.object({ ideaId: z.string() }), execute: async (a) => draftScript(world, String(a.ideaId ?? '')) },
      ];
    },
  };
}
