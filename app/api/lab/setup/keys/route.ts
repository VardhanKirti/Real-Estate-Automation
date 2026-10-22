import { removeEnvLocal, upsertEnvLocal } from '@/lib/creds';
import { resolveLab } from '@/lib/lab/context';
import { body, json } from '@/lib/lab/api';
import { isDry } from '@/lib/lab/dry';
import { LAB_SETTINGS, invalidValue, keySpecForEnv, writableEnvs } from '@/lib/lab/setup/keys';
import { keyRow } from '@/lib/lab/setup/key-rows';
import { healthResults, isNetworkCheck, runNetworkChecks } from '@/lib/lab/setup/health';
import { adoptPastedInstagramToken } from '@/lib/lab/setup/oauth-instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST   /api/lab/setup/keys { env, value } -> 200 { row }
 * DELETE /api/lab/setup/keys { env }        -> 200 { row }
 * (08.2.3) `env` must be an operator field of LAB_KEYS, a LAB_SETTINGS env, or a Setup-writable
 * name of 08.6.2; anything else is 400 unknown_key. Values are trimmed, single line, at most 4096
 * characters, and checked against their range (AC-08-26). Written only through upsertEnvLocal /
 * removeEnvLocal, so every other line of .env.local stays byte-identical. After a write the
 * matching health checks run once (free calls only; not in dry). The value is never echoed: the
 * row carries a masked copy. Sample is read-only (409).
 */
async function parse(request: Request): Promise<{ env: string; value?: string } | null> {
  const b = (await body(request)) as { env?: unknown; value?: unknown } | null;
  if (!b || typeof b.env !== 'string') return null;
  return { env: b.env, value: typeof b.value === 'string' ? b.value : undefined };
}

async function rowFor(env: string, ctx: ReturnType<typeof resolveLab>, checked: boolean) {
  const spec = keySpecForEnv(env);
  if (!spec) {
    const setting = LAB_SETTINGS.find((s) => s.env === env);
    return { row: null, setting: setting ? setting.id : null };
  }
  if (checked && !isDry()) {
    const ids = spec.health.filter(isNetworkCheck);
    if (ids.length) await runNetworkChecks(ctx.store, ids);
  }
  return { row: keyRow(spec, { health: healthResults(ctx.store), dry: isDry(), store: ctx.store }), setting: null };
}

export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const p = await parse(request);
  if (!p) return json({ ok: false, error: 'bad_request' }, 400);
  if (!writableEnvs().has(p.env)) return json({ ok: false, error: 'unknown_key' }, 400);
  const value = (p.value ?? '').trim();
  if (!value) return json({ ok: false, error: 'bad_value', detail: 'Empty: use DELETE to remove it.' }, 400);
  const bad = invalidValue(p.env, value);
  if (bad) return json({ ok: false, error: 'bad_value', detail: bad }, 400);
  upsertEnvLocal({ [p.env]: value });
  if (p.env === 'LAB_IG_ACCESS_TOKEN') await adoptPastedInstagramToken(value);
  const out = await rowFor(p.env, ctx, true);
  return json({ ok: true, env: p.env, ...out });
}

export async function DELETE(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const p = await parse(request);
  if (!p) return json({ ok: false, error: 'bad_request' }, 400);
  if (!writableEnvs().has(p.env)) return json({ ok: false, error: 'unknown_key' }, 400);
  removeEnvLocal([p.env]);
  const spec = keySpecForEnv(p.env);
  for (const id of spec?.health ?? []) if (isNetworkCheck(id)) ctx.store.priors.remove(`health:${id}`);
  if (p.env === 'APIFY_API_TOKEN') ctx.store.priors.remove('apify:plan');
  const out = await rowFor(p.env, ctx, false);
  return json({ ok: true, env: p.env, ...out });
}
