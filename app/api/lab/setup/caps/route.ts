import { readEnvLocal, upsertEnvLocal } from '@/lib/creds';
import { LAB_SPEND_LINES, LAB_SPEND_PROVIDERS, type LabSpendLine, type LabSpendProvider } from '@/lib/schemas';
import { resolveLab } from '@/lib/lab/context';
import { body, json } from '@/lib/lab/api';
import { PROVIDER_FLAGS, capEnvFor, capFor, isGeneralLine, lineCapFor } from '@/lib/lab/spend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const usd = (x: number) => `$${x.toFixed(2)}`;

/**
 * POST /api/lab/setup/caps { target, usd } (08.3.2). `target` is a provider or a line with a cap
 * env; `usd` 0 to 1000, two decimals. Writes that env with upsertEnvLocal. A cap above 0 on
 * comments or downloads also needs its feature flag: the response says which flag is still off.
 * When an apify provider cap is below the sum of its line caps the response carries the 08.16
 * warning.
 */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const b = (await body(request)) as { target?: unknown; usd?: unknown } | null;
  const target = typeof b?.target === 'string' ? b.target : '';
  const isProvider = (LAB_SPEND_PROVIDERS as readonly string[]).includes(target);
  const isLine = (LAB_SPEND_LINES as readonly string[]).includes(target) && !isGeneralLine(target as LabSpendLine);
  const env = isProvider || isLine ? capEnvFor(target as LabSpendProvider | LabSpendLine) : null;
  if (!env) return json({ ok: false, error: 'unknown_target' }, 400);
  const value = typeof b?.usd === 'number' ? b.usd : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1000 || Math.round(value * 100) / 100 !== value) return json({ ok: false, error: 'bad_value', detail: 'Dollars from 0 to 1000, two decimals.' }, 400);
  upsertEnvLocal({ [env]: String(value) });
  const live = { ...process.env, ...readEnvLocal() };
  const provider = (isProvider ? target : target.split('.')[0]) as LabSpendProvider;
  const flag = PROVIDER_FLAGS[provider];
  const flagOff = value > 0 && flag && !flag.on(live[flag.env]) ? `${flag.env} is still off. Turn it on to spend on this line.` : null;
  let warning: string | null = null;
  if (provider === 'apify') {
    const sum = LAB_SPEND_LINES.filter((l) => l.startsWith('apify.')).reduce((a, l) => a + (lineCapFor(l, live) ?? 0), 0);
    const cap = capFor('apify', live);
    if (cap !== null && cap < sum) warning = `Line caps add to ${usd(sum)} but the Apify cap is ${usd(cap)}. Lines stop when the Apify cap is reached.`;
  }
  return json({ ok: true, env, usd: value, flagOff, warning });
}
