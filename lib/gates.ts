/**
 * The two operator switches of the FounderOS merge (SPEC O7, AC-13), shared by
 * every route that can spend money, send something, or run on a schedule.
 *
 *   GLADOS_WRITES=1  outbound launches (Superset workspaces, Trakyo link and
 *                    content creation). Off by default: every such route
 *                    answers 403 until the operator turns it on.
 *   GLADOS_CRON=1    the cron runner (POST /api/cron/tick and /api/cron/run,
 *                    the 60 s loop in lib/cron-loop.ts). Off by default; on
 *                    only on the always-on private instance.
 *
 * On top of the switch, every write that spends or sends needs an explicit
 * `confirm: true` in its body (409 without it), so a stray POST never acts.
 * Both switches resolve through lib/creds.ts, so a value saved to .env.local
 * takes effect without a restart. Filming mode always reads both as off.
 */
import { NextResponse } from 'next/server';
import { resolveCred } from '@/lib/creds';
import { filmingMode } from '@/lib/paths';

export type GateName = 'GLADOS_WRITES' | 'GLADOS_CRON';

function switchOn(name: GateName): boolean {
  if (filmingMode()) return false;
  return resolveCred(name, [])?.trim() === '1';
}

/** Outbound launches allowed on this instance. */
export function writesEnabled(): boolean {
  return switchOn('GLADOS_WRITES');
}

/** The cron runner may fire jobs on this instance. */
export function cronEnabled(): boolean {
  return switchOn('GLADOS_CRON');
}

/** True only for an explicit boolean `confirm: true` (not "true", not 1). */
export function isConfirmed(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as { confirm?: unknown }).confirm === true);
}

export type GateRefusal = { status: 403 | 409; error: string; gate?: GateName; needsConfirm?: true };

/**
 * Decide whether a gated write may proceed. Null = go. The order matters: the
 * switch is checked first, so with writes off the answer is always 403 and
 * never reveals anything about the body.
 */
export function gateDecision(gate: GateName | null, body: unknown, enabled: (g: GateName) => boolean = switchOn): GateRefusal | null {
  if (gate && !enabled(gate)) {
    return {
      status: 403,
      gate,
      error:
        gate === 'GLADOS_WRITES'
          ? 'Outbound writes are off on this instance. Set GLADOS_WRITES=1 to allow launches.'
          : 'The cron runner is off on this instance. Set GLADOS_CRON=1 on the always-on host to allow it.',
    };
  }
  if (!isConfirmed(body)) {
    return { status: 409, needsConfirm: true, error: 'This action spends money or sends something. Resend with "confirm": true.' };
  }
  return null;
}

/** gateDecision as a ready response, or null to proceed. */
export function gateResponse(gate: GateName | null, body: unknown): NextResponse | null {
  const refusal = gateDecision(gate, body);
  return refusal ? NextResponse.json(refusal, { status: refusal.status }) : null;
}

/** For the UI: which switches are on, so buttons can disable with the reason. */
export function gateState(): { writes: boolean; cron: boolean } {
  return { writes: writesEnabled(), cron: cronEnabled() };
}
