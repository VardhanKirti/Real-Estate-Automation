import { NextResponse } from 'next/server';
import { z } from 'zod';
import fs from 'node:fs';
import { dataDir, filmingMode, invalidateModeCache, modeFile, DATA_DIR_NAMES } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** True when this instance is pinned to a fixed data directory and the toggle
 *  must not work — the always-on host sets GLADOS_DATA_DIR for exactly this. */
function pinned(): boolean {
  return Boolean(process.env.GLADOS_DATA_DIR) || process.env.DEMO_MODE === '0' || process.env.DEMO_MODE === '1';
}

function state() {
  return {
    ok: true as const,
    filming: filmingMode(),
    pinned: pinned(),
    dataDir: dataDir(),
    dirs: DATA_DIR_NAMES,
  };
}

export async function GET() {
  return NextResponse.json(state());
}

const Body = z.object({ filming: z.boolean() });

/**
 * Flip filming mode. This only ever rewrites .glados-mode, which selects WHICH
 * data directory the stores resolve to — it never copies, seeds or deletes
 * anything. Turning it on cannot touch data/; turning it off cannot touch
 * demo-data/.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }

  if (pinned()) {
    return NextResponse.json(
      {
        ...state(),
        ok: false,
        error:
          'This instance is pinned by GLADOS_DATA_DIR or DEMO_MODE and ignores the toggle. Change the environment on the host instead.',
      },
      { status: 409 },
    );
  }

  fs.writeFileSync(modeFile(), body.filming ? 'filming\n' : 'real\n', 'utf8');
  invalidateModeCache();

  const next = state();
  if (body.filming) fs.mkdirSync(next.dataDir, { recursive: true });
  return NextResponse.json(next);
}
