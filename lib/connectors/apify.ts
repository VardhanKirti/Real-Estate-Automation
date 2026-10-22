/**
 * Apify connector: Content Lab's ingestion layer (docs/projects/content-lab/SPEC.md §2,
 * §9). Status is key presence plus what the Lab's own store already knows (owned and
 * tracked accounts, the last run, this month's spend). It never calls Apify, so rendering
 * the Connections board can never start a run or spend a cent. A blank APIFY_API_TOKEN
 * counts as not configured (lib/creds.ts resolveCred).
 *
 * Four capabilities, each with its own honest state:
 *   own-account scrape · creator scrape · search (discovery) · transcription source.
 */
import { CRED_FILES, resolveCred } from '@/lib/creds';
import type { ConnectorCapability, ConnectorStatus } from '@/lib/connectors/types';
import { setupHrefFor } from '@/lib/integrations-catalog';

export const APIFY_KEY = 'APIFY_API_TOKEN';
export const OPENAI_KEY = 'OPENAI_API_KEY';

export function resolveApifyToken(): string | undefined {
  return resolveCred(APIFY_KEY, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

/** Speech-to-text for short-form (SPEC Q3 default: Whisper through an OpenAI key). */
export function resolveSttKey(): string | undefined {
  return resolveCred(OPENAI_KEY, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

export function apifyConfigured(): boolean {
  return Boolean(resolveApifyToken());
}

export type ApifyStoreFacts = {
  owned: number;
  tracked: number;
  lastRunAt: string | null;
  monthSpentUsd: number;
  capUsd: number | null;
  dry: boolean;
};

/** Pure: the status the board shows, from key presence and the store facts. */
export function describeApify(input: { token: boolean; stt: boolean; facts: ApifyStoreFacts | null }): ConnectorStatus {
  const base = { id: 'apify', name: 'Apify', kind: 'social', configHref: '/lab?tab=sources' } as const;
  if (!input.token) {
    // No capability list and no configHref: the tile then shows Connect, the paste-a-key flow for APIFY_API_TOKEN.
    return { id: base.id, name: base.name, kind: base.kind, state: 'not_configured', detail: 'Content Lab scraping (your posts, similar creators, discovery). Set APIFY_API_TOKEN.' };
  }
  const f = input.facts;
  const spend = f ? `$${f.monthSpentUsd.toFixed(2)}${f.capUsd !== null ? ` of $${f.capUsd.toFixed(0)}` : ''} this month` : 'no spend recorded';
  const last = f?.lastRunAt ? `last run ${f.lastRunAt.slice(0, 16).replace('T', ' ')}` : 'never run';
  const caps: ConnectorCapability[] = [
    {
      id: 'own-scrape',
      label: 'Your accounts',
      state: 'connected',
      detail: f && f.owned > 0 ? `${f.owned} account${f.owned === 1 ? '' : 's'} added` : 'Token set; add your accounts in Content Lab',
      setupHref: '/lab?tab=sources',
    },
    {
      id: 'creator-scrape',
      label: 'Similar creators',
      state: 'connected',
      detail: f && f.tracked > 0 ? `${f.tracked} creator${f.tracked === 1 ? '' : 's'} tracked` : 'Token set; no creators tracked yet',
      setupHref: '/lab?tab=sources',
    },
    // Search actor inputs are not verified against a live run yet (lib/lab/apify-client.ts SEARCH_ACTORS).
    { id: 'search', label: 'Discovery search', state: 'connected', detail: 'Keyword and hashtag search actors (inputs unverified until the first run)' },
    input.stt
      ? { id: 'transcription-source', label: 'Video files for transcripts', state: 'connected', detail: 'TikTok downloads and media URLs, transcribed through the OpenAI key' }
      : { id: 'transcription-source', label: 'Video files for transcripts', state: 'not_configured', detail: 'No speech-to-text key: short-form is analysed caption-only', setupHref: setupHrefFor('openai') },
  ];
  return {
    ...base,
    state: 'connected',
    detail: `${f?.dry ? 'Dry: fixtures, no charges · ' : ''}${spend} · ${last}`,
    meta: f ? { owned: f.owned, tracked: f.tracked, spent: f.monthSpentUsd } : undefined,
    capabilities: caps,
  };
}

export async function apifyStatus(): Promise<ConnectorStatus> {
  const token = apifyConfigured();
  const stt = Boolean(resolveSttKey());
  let facts: ApifyStoreFacts | null = null;
  if (token) {
    try {
      // lazy: the store and spend modules pull in the database; a status probe without a token never opens it
      const [{ getDb }, { monthSpend, capFor }, { isDry }] = await Promise.all([import('@/lib/data'), import('@/lib/lab/spend'), import('@/lib/lab/dry')]);
      const lab = getDb().lab;
      facts = {
        owned: lab.sources.all('owned').filter((s) => s.status === 'active').length,
        tracked: lab.sources.all('tracked').filter((s) => s.status === 'active').length,
        lastRunAt: lab.runs.recent(1)[0]?.startedAt ?? null,
        monthSpentUsd: monthSpend(lab, 'apify'),
        capUsd: capFor('apify'),
        dry: isDry(),
      };
    } catch {
      facts = null;
    }
  }
  return describeApify({ token, stt, facts });
}
