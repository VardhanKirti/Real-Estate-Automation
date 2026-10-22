/**
 * Hugging Face trending (05 3.3). Free, no key. Metric = trendingScore, rank = index + 1.
 * Reuploader orgs are dropped before storing (AC-05-11).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { REUPLOADER_ORGS } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { getJson, isRecord, isoOrNull, num, radarFetch, str } from '@/lib/lab/radar/util';
import { hfFamily } from '@/lib/lab/radar/names';

export { hfFamily } from '@/lib/lab/radar/names';

export const HF_MODELS_URL = 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=50';
export const HF_SPACES_URL = 'https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=30';

const REUP = new Set(REUPLOADER_ORGS.map((o) => o.toLowerCase()));
export const isReuploader = (id: string): boolean => REUP.has((id.split('/')[0] ?? '').toLowerCase());

function parse(json: unknown, source: 'hf_models' | 'hf_spaces'): RawPing[] {
  const list = Array.isArray(json) ? json : [];
  const out: RawPing[] = [];
  list.forEach((m, i) => {
    if (!isRecord(m)) return;
    const id = str(m.id) ?? str(m.modelId);
    if (!id || isReuploader(id)) return;
    const fam = hfFamily(id);
    out.push({
      ...emptyRaw(source, id),
      title: id,
      url: `https://huggingface.co/${source === 'hf_spaces' ? 'spaces/' : ''}${id}`,
      author: id.split('/')[0] ?? null,
      vendor: id.split('/')[0] ?? null,
      // source_time = first time we saw it (createdAt is repo creation, often days before release)
      sourceTime: null,
      metric: num(m.trendingScore),
      rank: i + 1,
      name: fam || null,
      extra: { createdAt: isoOrNull(m.createdAt), hfId: id },
    });
  });
  return out;
}

export const parseHfModels = (json: unknown): RawPing[] => parse(json, 'hf_models');
export const parseHfSpaces = (json: unknown): RawPing[] => parse(json, 'hf_spaces');

export async function fetchHfModels(opts: { fetch?: FetchLike } = {}): Promise<RawPing[]> {
  return parseHfModels(await getJson(opts.fetch ?? radarFetch, HF_MODELS_URL));
}
export async function fetchHfSpaces(opts: { fetch?: FetchLike } = {}): Promise<RawPing[]> {
  return parseHfSpaces(await getJson(opts.fetch ?? radarFetch, HF_SPACES_URL));
}
