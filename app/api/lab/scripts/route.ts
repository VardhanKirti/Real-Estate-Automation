import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError } from '@/lib/lab/spend';
import { generateScript, markPublished, regenerateSection, saveEdit } from '@/lib/lab/scripts';
import { createCampaign } from '@/lib/creative-engine/store';
import { EditorError, judgeScriptHooks, restoreVersion, scriptEngineConcept, scriptWizardPrefill, setDuration, setHook, setPlatform } from '@/lib/lab/gen/editor';
import { LAB_PLATFORMS } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PlatformSchema = z.enum([...LAB_PLATFORMS, 'multi']);

const ActSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), ideaId: z.string().min(1), durationS: z.number().positive().max(1800).optional(), override: z.boolean().optional() }),
  z.object({ action: z.literal('regenerate_section'), id: z.string().min(1), section: z.number().int().min(0), override: z.boolean().optional() }),
  z.object({ action: z.literal('save_edit'), id: z.string().min(1), body: z.unknown() }),
  z.object({ action: z.literal('mark_published'), id: z.string().min(1), postId: z.string().min(1) }),
  /* 07 7.8, 7.16 */
  z.object({ action: z.literal('set_hook'), id: z.string().min(1), hookChoice: z.number().int().min(0) }),
  z.object({ action: z.literal('set_duration'), id: z.string().min(1), durationS: z.number().min(10).max(1800) }),
  z.object({ action: z.literal('set_platform'), id: z.string().min(1), platform: PlatformSchema }),
  z.object({ action: z.literal('restore_version'), id: z.string().min(1), version: z.number().int().min(1) }),
  z.object({ action: z.literal('judge_hooks'), id: z.string().min(1), override: z.boolean().optional() }),
  z.object({ action: z.literal('send_engine'), id: z.string().min(1) }),
  z.object({ action: z.literal('ask_wizard'), id: z.string().min(1) }),
]);

const failure = (err: unknown) => {
  if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap }, 402);
  if (err instanceof EditorError) return json({ ok: false, error: err.message }, err.status);
  const message = err instanceof Error ? err.message : String(err);
  if (/^no such/.test(message)) return json({ ok: false, error: message }, 404);
  if (/malformed|no idea to plan/.test(message)) return json({ ok: false, error: message }, 400);
  return json({ ok: false, error: message }, /not on this host/.test(message) ? 503 : 502);
};

/**
 * POST /api/lab/scripts: script actions (v1 SPEC §4.12, 07 7.8).
 *   generate {ideaId, durationS?}        draft, gate (v1 checks and the rule pack), one regenerate on failure
 *   regenerate_section {id, section}     a new version with that section rewritten (CONTRAST and its rule failures fed in)
 *   save_edit {id, body}                 a new version from your edit, stored as a diff (a voice sample)
 *   mark_published {id, postId}          links one of your posts, marks the idea used, starts outcomes
 *   set_hook · set_duration · set_platform · restore_version   one new version each, never a model call
 *   judge_hooks {id}                     orders the 3 hooks pairwise, both orders (no new version)
 *   send_engine {id} · ask_wizard {id}   hand-offs; the Wizard prefill is never sent
 */
export async function POST(request: Request) {
  const parsed = ActSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: 'pass an action: generate, regenerate_section, save_edit, mark_published, set_hook, set_duration, set_platform, restore_version, judge_hooks, send_engine or ask_wizard' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const a = parsed.data;
  try {
    switch (a.action) {
      case 'generate': {
        if (!ctx.store.ideas.get(a.ideaId)) return json({ ok: false, error: 'no such idea' }, 404);
        const r = await generateScript(ctx.store, a.ideaId, { durationS: a.durationS, override: a.override });
        return json({ ok: true, dry: ctx.flags.dry, scriptId: r.scriptId, version: r.version.version, gatePassed: r.version.gate.passed, attempts: r.attempts, href: `/lab?script=${encodeURIComponent(r.scriptId)}` });
      }
      case 'regenerate_section': {
        const r = await regenerateSection(ctx.store, a.id, a.section, { override: a.override });
        return json({ ok: true, dry: ctx.flags.dry, scriptId: r.scriptId, version: r.version.version, gatePassed: r.version.gate.passed });
      }
      case 'save_edit': {
        const r = saveEdit(ctx.store, a.id, a.body);
        return json({ ok: true, scriptId: r.scriptId, version: r.version.version, changed: r.changed, gatePassed: r.version.gate.passed });
      }
      case 'mark_published': {
        const r = markPublished(ctx.store, a.id, a.postId);
        if (!r.ok) return json({ ok: false, error: r.error }, r.error === 'no such script' ? 404 : 400);
        return json({ ok: true, script: ctx.store.scripts.get(a.id), noPrediction: r.noPrediction });
      }
      case 'set_hook':
        return json({ ok: true, version: setHook(ctx.store, a.id, a.hookChoice).version });
      case 'set_duration':
        return json({ ok: true, version: setDuration(ctx.store, a.id, a.durationS).version });
      case 'set_platform':
        return json({ ok: true, version: setPlatform(ctx.store, a.id, a.platform).version });
      case 'restore_version':
        return json({ ok: true, version: restoreVersion(ctx.store, a.id, a.version).version });
      case 'judge_hooks': {
        const r = await judgeScriptHooks(ctx.store, a.id, { override: a.override });
        return json({ ok: true, verdicts: r.verdicts, order: r.order, record: r.record });
      }
      case 'send_engine': {
        const campaign = createCampaign(scriptEngineConcept(ctx.store, a.id));
        return json({ ok: true, campaignId: campaign.id, href: '/creative-engine' });
      }
      case 'ask_wizard':
        return json({ ok: true, prefill: scriptWizardPrefill(ctx.store, a.id) });
    }
  } catch (err) {
    return failure(err);
  }
}
