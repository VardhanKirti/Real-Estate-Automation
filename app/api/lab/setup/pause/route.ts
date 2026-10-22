import fs from 'node:fs';
import path from 'node:path';
import { resolveLab } from '@/lib/lab/context';
import { body, json } from '@/lib/lab/api';
import { automationDirs } from '@/lib/lab/schedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/lab/setup/pause { paused } (08.3.2): creates or deletes `PAUSED-lab` in the first
 * existing Automation folder. Never touches the global `PAUSED` file; while that file is present
 * the switch is disabled (409 with the reason).
 */
export async function POST(request: Request) {
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return json({ ok: false, error: 'read_only' }, 409);
  const b = (await body(request)) as { paused?: unknown } | null;
  if (typeof b?.paused !== 'boolean') return json({ ok: false, error: 'bad_request' }, 400);
  const dirs = automationDirs();
  const global = dirs.map((d) => path.join(d, 'PAUSED')).find((p) => fs.existsSync(p));
  if (global) return json({ ok: false, error: 'paused_globally', detail: `Paused for all automation by PAUSED in ${path.dirname(global)}.` }, 409);
  const dir = dirs.find((d) => fs.existsSync(d));
  if (!dir) return json({ ok: false, error: 'no_automation_dir', detail: 'No Automation folder on this machine. Set GLADOS_AUTOMATION_DIR.' }, 409);
  const file = path.join(dir, 'PAUSED-lab');
  if (b.paused) fs.writeFileSync(file, `Paused from Setup at ${new Date().toISOString()}\n`);
  else for (const d of dirs) fs.rmSync(path.join(d, 'PAUSED-lab'), { force: true });
  return json({ ok: true, paused: b.paused, file: b.paused ? file : null });
}
