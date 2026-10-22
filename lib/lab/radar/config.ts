/**
 * Launch Radar constants (05 sections 3, 5.4, 19). Every endpoint below was verified on
 * 2026-10-11 (05 3.1); the Apify actors are read from their Store listings, never called here.
 */
import type { LabRadarFamily, LabRadarSource, LabSpendLine } from '@/lib/schemas';
import { BRAND } from '@/lib/brand';

export { LAB_RADAR_SOURCES as RADAR_SOURCES } from '@/lib/schemas';

/** Sent on every request. Wikimedia answers 429 without a contact URL (05 3). */
export const RADAR_UA = `${BRAND.name}-ContentLab/1.0 (+https://exosoft.io)`;

/** 05 3.1: the family each ping source counts toward (wikipedia is a class meter, not a family). */
export const SOURCE_FAMILY: Record<Exclude<LabRadarSource, 'wikipedia'>, LabRadarFamily> = {
  hn: 'hn',
  hf_models: 'hf',
  hf_spaces: 'hf',
  github: 'github',
  vendor: 'vendor',
  x: 'x',
  producthunt: 'producthunt',
  tiktok_cc: 'tiktok',
};

/** 05 3.1: sources whose qualifying pings may create a candidate (hf_spaces attaches only; x creates through vendor handles only). */
export const CREATES_CANDIDATES: Record<Exclude<LabRadarSource, 'wikipedia'>, boolean> = {
  hn: true, hf_models: true, hf_spaces: false, github: true, vendor: true, x: true, producthunt: true, tiktok_cc: true,
};

export const SOURCE_LABEL: Record<LabRadarSource, string> = {
  hn: 'Hacker News',
  hf_models: 'Hugging Face models',
  hf_spaces: 'Hugging Face spaces',
  github: 'GitHub',
  vendor: 'Vendor posts',
  x: 'X watch list',
  producthunt: 'Product Hunt',
  tiktok_cc: 'TikTok Creative Center',
  wikipedia: 'Wikipedia',
};

export type VendorFeed = { vendor: string; url: string; kind: 'rss' | 'link_diff'; lexiconFilter: boolean; slugRe?: RegExp; base?: string };

/** 05 3.5, row for row. */
export const VENDOR_FEEDS: readonly VendorFeed[] = [
  { vendor: 'openai', url: 'https://openai.com/news/rss.xml', kind: 'rss', lexiconFilter: false },
  { vendor: 'google', url: 'https://blog.google/technology/ai/rss/', kind: 'rss', lexiconFilter: false },
  { vendor: 'google', url: 'https://blog.google/products/gemini/rss/', kind: 'rss', lexiconFilter: false },
  { vendor: 'deepmind', url: 'https://deepmind.google/blog/rss.xml', kind: 'rss', lexiconFilter: false },
  { vendor: 'mistral', url: 'https://mistral.ai/news/rss', kind: 'rss', lexiconFilter: false },
  { vendor: 'meta', url: 'https://about.fb.com/news/feed/', kind: 'rss', lexiconFilter: true },
  { vendor: 'meta', url: 'https://ai.meta.com/blog/', kind: 'link_diff', lexiconFilter: false, slugRe: /href="https:\/\/ai\.meta\.com\/blog\/([a-z0-9][a-z0-9-]*)\/?"/g, base: 'https://ai.meta.com/blog/' },
  { vendor: 'anthropic', url: 'https://www.anthropic.com/news', kind: 'link_diff', lexiconFilter: false, slugRe: /href="\/news\/([a-z0-9][a-z0-9-]*)"/g, base: 'https://www.anthropic.com/news/' },
  { vendor: 'huggingface', url: 'https://huggingface.co/blog/feed.xml', kind: 'rss', lexiconFilter: false },
  { vendor: 'qwen', url: 'https://qwenlm.github.io/blog/index.xml', kind: 'rss', lexiconFilter: false },
  { vendor: 'github', url: 'https://github.blog/changelog/feed/', kind: 'rss', lexiconFilter: true },
];

/** 05 3.5 [LIVE-CHECK LC-05-3]. A detection rule only: polled only when added to the watch list. */
export const VENDOR_X_HANDLES = ['OpenAI', 'AnthropicAI', 'GoogleDeepMind', 'GeminiApp', 'xai', 'MistralAI', 'AIatMeta', 'Alibaba_Qwen', 'deepseek_ai', 'huggingface'] as const;

/** 05 3.3: quant and mirror reuploads are not launches. */
export const REUPLOADER_ORGS = ['unsloth', 'bartowski', 'lmstudio-community', 'mlx-community', 'TheBloke', 'QuantFactory', 'MaziyarPanahi', 'bullerwins', 'DevQuasar'] as const;

/** 05 5.4 */
export const AI_LEXICON = /\b(ai|a\.i\.|llm|gpt|chatgpt|openai|claude|anthropic|gemini|deepmind|llama|mistral|qwen|deepseek|grok|xai|sora|veo|midjourney|flux|stable diffusion|copilot|cursor|agent|agents|agentic|mcp|model context protocol|rag|embedding|transformer|diffusion|text-to-(video|image|speech)|tts|vibe coding|open[- ]weights?|fine-?tun\w*|inference|reasoning model|multimodal|aiart|ghibliai)\b/i;

/**
 * 05 3.5, split in two. The spec writes one regex with the `i` flag, which makes its last branch
 * (a capitalised name followed by a version) match any word before a number: "time by 96%" in the
 * spec's own non-launch example would count as a launch. The verb branch stays case-insensitive;
 * the name-plus-version branch is case-sensitive. Use `isLaunchText`.
 */
export const LAUNCH_RE = /^(introducing|announcing|meet|launching|say hello to|releasing|now available|available now|today we)|\b(launch(es|ed)?|released?|is here|now (available|in)|general availability|preview|rolling out)\b/i;
export const LAUNCH_NAME_VERSION_RE = /\b[A-Z][\w-]*[ -]v?\d+(\.\d+)*\b/;
export const isLaunchText = (s: string): boolean => LAUNCH_RE.test(s.trim()) || LAUNCH_NAME_VERSION_RE.test(s);

/** 05 3.4: topics polled hourly, one search each. */
export const GITHUB_TOPICS = ['llm', 'ai-agents', 'mcp', 'generative-ai'] as const;

export const X_ACTOR = 'apidojo/tweet-scraper';
export const TIKTOK_CC_ACTOR = 'rastriq/tiktok-trends-scraper';
export const PRODUCTHUNT_ACTOR = 's-r/producthunt-launches';

/** 05 19 */
export const RADAR_ACTORS = [X_ACTOR, TIKTOK_CC_ACTOR, PRODUCTHUNT_ACTOR] as const;

/** 05 19: defaults only; caps are read through lib/lab/spend.ts (LAB_APIFY_RADAR_*_CAP_USD). */
export const RADAR_CAP_LINES: Partial<Record<LabSpendLine, number>> = { 'apify.radar_x': 15, 'apify.radar_tiktok': 3, 'apify.radar_producthunt': 1 };

/** Which paid line each Apify source spends on. */
export const SOURCE_LINE: Partial<Record<LabRadarSource, LabSpendLine>> = { x: 'apify.radar_x', tiktok_cc: 'apify.radar_tiktok', producthunt: 'apify.radar_producthunt' };

/** 05 19: Store listing reads that size the default caps (not 09 price books; LAB_ACTORS needs the event names from GET /v2/acts). */
export const RADAR_LISTING_PRICES = {
  [TIKTOK_CC_ACTOR]: { perStartUsd: 0.025, perItemUsd: 0.001, unit: 'hashtag' },
  [PRODUCTHUNT_ACTOR]: { perStartUsd: 0.002, perItemUsd: 0.00075, unit: 'row' },
  [X_ACTOR]: { perStartUsd: 0, perItemUsd: 0.0004, unit: 'tweet' },
} as const;

/** lab_priors keys this section owns. */
export const RADAR_DISABLED_KEY = 'radar:disabled';
export const RADAR_LEAD_TIME_KEY = 'radar:lead_time';
