/**
 * The /social header status pill (SPEC H15, S03 F1): what the Zernio
 * connector actually reports and how old the newest follower snapshot is.
 * Never a hard-coded "live". Pure, so both UI styles render the same data.
 */
import type { ConnectorState } from '@/lib/connectors/types';

export type StatusTone = 'ok' | 'warn' | 'err' | 'off';

export type SocialStatusPill = {
  text: string;
  tone: StatusTone;
  /** Hover text: the source and the date behind the pill. */
  title: string;
  /** Present when the fix is a setup step (not configured, check failed). */
  setupHref: string | null;
};

const DAY_MS = 86_400_000;
const STALE_DAYS = 2; // older than 48h reads stale

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function syncedText(days: number): string {
  if (days <= 0) return 'synced today';
  return `synced ${days}d ago`;
}

export function zernioStatusPill(input: {
  state: ConnectorState;
  detail: string;
  /** Newest follower snapshot date (YYYY-MM-DD), or null with none. */
  newestSnapshot: string | null;
  today: string;
  /** Filming mode: the page shows the filming dataset. */
  filming: boolean;
  setupHref: string;
}): SocialStatusPill {
  const { state, detail, newestSnapshot, today, filming, setupHref } = input;
  const sample = filming ? ' · sample data' : '';
  if (state === 'not_configured') {
    return { text: `Zernio not configured${sample}`, tone: 'off', title: detail, setupHref };
  }
  if (state === 'error') {
    return { text: `Zernio check failed${sample}`, tone: 'err', title: detail, setupHref };
  }
  if (!newestSnapshot) {
    return { text: `Zernio · no snapshots yet${sample}`, tone: 'warn', title: detail, setupHref: null };
  }
  const days = Math.max(0, daysBetween(newestSnapshot, today));
  return {
    text: `Zernio · ${syncedText(days)}${sample}`,
    tone: days < STALE_DAYS ? 'ok' : 'warn',
    title: `Newest follower snapshot ${newestSnapshot}${days >= STALE_DAYS ? ' (stale)' : ''}`,
    setupHref: null,
  };
}
