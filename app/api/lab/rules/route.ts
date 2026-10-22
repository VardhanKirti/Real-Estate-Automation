import { z } from 'zod';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { RULEPACK_VERSION, RULE_META, ruleAgreement } from '@/lib/lab/gen/rules';
import { LEXICON_CITATION, LEXICON_SHA256, NICHE_PRIOR_BAND, bandKey, fetchLexicon, lexiconInstalled } from '@/lib/lab/gen/lexicon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/rules -> { ok, version, lexicon: { installed, sha256, citation }, rules } for the Playbook Rules list (07 7.6.6). */
export async function GET(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const bands = ctx.store.priors.byPrefix(bandKey('')).map((p) => ({ n: p.n, value: p.value as { lo: number; hi: number } }));
  return json({
    ok: true,
    sample: ctx.flags.sample,
    version: RULEPACK_VERSION,
    lexicon: { installed: lexiconInstalled(), sha256: LEXICON_SHA256, citation: LEXICON_CITATION },
    rules: RULE_META.map((r) => ({ ...r, ...ruleAgreement(r.id, bands, NICHE_PRIOR_BAND) })),
  });
}

const PostSchema = z.object({ action: z.literal('fetch_lexicon') });

/** POST {action:'fetch_lexicon'} -> { ok } or { ok:false, error } (a hash mismatch writes nothing). */
export async function POST(request: Request) {
  const parsed = PostSchema.safeParse(await body(request));
  if (!parsed.success) return json({ ok: false, error: "pass action 'fetch_lexicon'" }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  const r = await fetchLexicon();
  return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error }, 502);
}
