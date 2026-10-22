/**
 * The /usage payload (pages/usage.md §2), built once for both the API route
 * (`GET /api/usage`, polled every 10 s) and the page's first server render,
 * so the two can never disagree. Local and free: transcripts on this disk
 * (through the reader's 60 s cache, never a fresh parse on the request, U-4),
 * pushed rows in SQLite, and a 0.8 s loopback ping to Ollama.
 *
 * Off on demo and filming instances: then it reads nothing (U-1, AC-12) and
 * answers "not available". `?range=7|30`. `?sample=1` previews a badged
 * fixture only on a blank, non-filming install.
 */
import { getDb } from '@/lib/data';
import { filmingMode } from '@/lib/paths';
import { foMode, sampleUsageLanes, sampleUsageReadings } from '@/lib/fo-sample';
import { pushTokenConfigured } from '@/lib/push-auth';
import type { UsagePlan } from '@/lib/schemas';
import { USAGE_OFF_MESSAGE, usageAvailability, type UsageAvailability } from '@/lib/usage-guard';
import { dayKey, ollamaState, readLocalUsage, summarizeLanes, summarizeUsage, type BurnLane, type LaneReading, type OllamaState, type UsageSummary } from '@/lib/usage';

export const USAGE_FOOTNOTE = 'Burn = input + output + cache writes. Cache reads are not counted.';
export const USAGE_PUSH_PATH = '/api/usage/push';

export type LaneBurn = { lane: BurnLane; label: string; burn: number };

export type UsageOff = {
  available: false;
  reason: Extract<UsageAvailability, { available: false }>['reason'];
  message: string;
  sample: false;
};

export type UsageOn = UsageSummary & {
  available: true;
  mode: 'live' | 'sample';
  sample: boolean;
  /** false = no transcript folder on this machine and no push: Not configured */
  configured: boolean;
  machine: string;
  sources: { claude: boolean; codex: boolean };
  ollama: OllamaState;
  /** Burn per lane, this machine only; null when this machine has no local source. */
  lanes: LaneBurn[] | null;
  planLanes: Record<UsagePlan, LaneBurn[] | null>;
  push: { path: string; tokenSet: boolean };
  readAt: string;
  footnote: string;
};

export type UsagePayload = UsageOff | UsageOn;

export const parseRange = (v: string | null | undefined): 7 | 30 => (v === '30' ? 30 : 7);

function lanesFor(lanes: LaneReading[], hasLocal: boolean, range: 7 | 30, now: Date) {
  if (!hasLocal)
    return {
      lanes: null,
      planLanes: { claude: null, codex: null, ollama: null },
    };
  return {
    lanes: summarizeLanes({ lanes, range, now }),
    planLanes: {
      claude: summarizeLanes({ lanes, range, now, plan: 'claude' }),
      codex: summarizeLanes({ lanes, range, now, plan: 'codex' }),
      ollama: null,
    },
  };
}

export async function buildUsagePayload(input: { url: string; now?: Date }): Promise<UsagePayload> {
  const url = new URL(input.url, 'http://localhost');
  const range = parseRange(url.searchParams.get('range'));
  // Demo mode: the badged sample, and nothing on this disk is read.
  if (filmingMode()) {
    const now = input.now ?? new Date();
    return {
      available: true,
      mode: 'sample',
      sample: true,
      configured: true,
      ...summarizeUsage({ readings: sampleUsageReadings(now), localMachine: 'sample-laptop', official: { codex: null }, range, now }),
      machine: 'sample-laptop',
      sources: { claude: true, codex: true },
      ollama: { state: 'down', models: [], error: null },
      ...lanesFor(sampleUsageLanes(now), true, range, now),
      push: { path: USAGE_PUSH_PATH, tokenSet: false },
      readAt: now.toISOString(),
      footnote: USAGE_FOOTNOTE,
    };
  }
  const guard = usageAvailability();
  if (!guard.available)
    return {
      available: false,
      reason: guard.reason,
      message: USAGE_OFF_MESSAGE,
      sample: false,
    };

  const now = input.now ?? new Date();
  const pushed = getDb().usageReadings.since(dayKey(now.getTime() - 31 * 86_400_000));
  const push = {
    path: USAGE_PUSH_PATH,
    tokenSet: pushTokenConfigured('USAGE_PUSH_TOKEN'),
  };

  if (url.searchParams.get('sample') === '1') {
    const local = await readLocalUsage({ now });
    const blank = pushed.length === 0 && local.readings.length === 0;
    if (foMode(url, blank) === 'sample') {
      const summary = summarizeUsage({
        readings: sampleUsageReadings(now),
        localMachine: 'sample-laptop',
        official: { codex: null },
        range,
        now,
      });
      return {
        available: true,
        mode: 'sample',
        sample: true,
        configured: true,
        ...summary,
        machine: 'sample-laptop',
        sources: { claude: true, codex: true },
        ollama: { state: 'down', models: [], error: null },
        ...lanesFor(sampleUsageLanes(now), true, range, now),
        push,
        readAt: now.toISOString(),
        footnote: USAGE_FOOTNOTE,
      };
    }
  }

  const [local, ollama] = await Promise.all([readLocalUsage({ now }), ollamaState()]);
  const summary = summarizeUsage({
    readings: [...local.readings, ...pushed.filter((r) => r.machine !== local.machine)],
    localMachine: local.machine,
    official: { codex: local.official.codex },
    range,
    now,
  });
  const hasLocal = local.sources.claude || local.sources.codex;
  return {
    available: true,
    mode: 'live',
    sample: false,
    configured: hasLocal || pushed.length > 0,
    ...summary,
    machine: local.machine,
    sources: local.sources,
    ollama,
    ...lanesFor(local.lanes, hasLocal, range, now),
    push,
    readAt: local.readAt,
    footnote: USAGE_FOOTNOTE,
  };
}
