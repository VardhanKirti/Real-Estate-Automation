/**
 * The Lab key and settings registry (08.2.1). LAB_KEYS is the ONLY registry for Lab keys: no
 * Lab key goes into lib/keys.ts KEY_SLOTS. Values are read only through lib/creds.ts and written
 * only through upsertEnvLocal / removeEnvLocal; a raw value never leaves the server.
 *
 * S0 wrote the types and transcribed the 08.2.1 tables as data. Lane S owns this file (row
 * building, the paste endpoint allowlist and the health wiring live with it).
 */
import type { LabSpendLine } from '@/lib/schemas';
import type { LabHealthId } from '@/lib/lab/setup/health';

export type LabKeyId = 'apify' | 'openai' | 'youtube' | 'instagram' | 'producthunt' | 'github' | 'xwatch' | 'claude_cli';

export type LabKeyField = {
  /** the .env.local name */
  env: string;
  /** copy shown on the row */
  label: string;
  /** masked in every response */
  secret: boolean;
  /** oauth fields are never pasted */
  writtenBy: 'operator' | 'oauth';
};

export type LabKeySpec = {
  id: LabKeyId;
  title: string;
  /** only 'apify' is true */
  required: boolean;
  /** empty for xwatch (lab_sources rows) and claude_cli (a binary) */
  fields: LabKeyField[];
  /** plain sentences, shown under the row */
  unlocks: string[];
  /** empty = free */
  costLines: LabSpendLine[];
  /** checks that decide Connected vs Error */
  health: LabHealthId[];
  /** vendor page that issues the key */
  docsHref: string;
};

/** 08.2.2 */
export type LabKeyState = 'not_configured' | 'needs_connect' | 'checking' | 'connected' | 'expiring' | 'error' | 'dry';

export type LabKeyRow = {
  id: LabKeyId;
  title: string;
  required: boolean;
  state: LabKeyState;
  fields: { env: string; label: string; present: boolean; masked: string; writtenBy: 'operator' | 'oauth' }[];
  unlocks: string[];
  detail: string | null;
  checkedAt: string | null;
  action: { kind: 'paste' | 'connect' | 'reconnect' | 'disconnect' | 'manage_sources' | 'none'; label: string };
};

export type LabSettingId = 'lexicon' | 'frames' | 'tiktok_download_price' | 'embed_provider' | 'judge' | 'judge_model' | 'grounding_control';
export type LabSettingSpec = {
  id: LabSettingId;
  title: string;
  control: 'action' | 'toggle' | 'number' | 'select' | 'text';
  /** null for 'lexicon' (a file, not an env value) */
  env: string | null;
  health: LabHealthId[];
};

const op = (env: string, label: string, secret = true): LabKeyField => ({ env, label, secret, writtenBy: 'operator' });
const oa = (env: string, label: string, secret = true): LabKeyField => ({ env, label, secret, writtenBy: 'oauth' });

/** 08.2.1, in row order. Row copy is exact. */
export const LAB_KEYS: readonly LabKeySpec[] = [
  {
    id: 'apify', title: 'Apify', required: true, fields: [op('APIFY_API_TOKEN', 'API token')],
    unlocks: ['Your posts and their numbers at age. Tracked creators and breakouts. Discovery. The X watch list, TikTok Creative Center and Product Hunt on Radar.'],
    costLines: ['apify.sync', 'apify.snapshots', 'apify.x', 'apify.verify', 'apify.radar_x', 'apify.radar_tiktok', 'apify.radar_producthunt', 'comments', 'downloads'],
    health: ['apify.auth'], docsHref: 'https://console.apify.com/settings/integrations',
  },
  {
    id: 'openai', title: 'OpenAI (speech to text)', required: false, fields: [op('OPENAI_API_KEY', 'API key')],
    unlocks: ['Transcripts for posts without captions. Without it, captions only.'],
    costLines: ['stt', 'stt.controls', 'embed'], health: ['openai.auth'], docsHref: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'youtube', title: 'YouTube Analytics', required: false,
    fields: [op('LAB_YT_CLIENT_ID', 'Client ID', false), op('LAB_YT_CLIENT_SECRET', 'Client secret'), oa('LAB_YT_REFRESH_TOKEN', 'Refresh token'), oa('LAB_YT_CHANNEL_ID', 'Channel', false), oa('LAB_YT_CONNECTED_AT', 'Connected at', false), op('LAB_YT_REDIRECT_URI', 'Redirect URI (optional)', false)],
    unlocks: ['Retention curves for your own YouTube videos, laid on the beat strand. Test & Compare results stay manual.'],
    costLines: [], health: ['youtube.token'], docsHref: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'instagram', title: 'Instagram insights', required: false,
    fields: [op('LAB_IG_APP_ID', 'App ID', false), op('LAB_IG_APP_SECRET', 'App secret'), oa('LAB_IG_ACCESS_TOKEN', 'Access token'), oa('LAB_IG_TOKEN_EXPIRES_AT', 'Expires at', false), oa('LAB_IG_USER_ID', 'User ID', false), op('LAB_IG_REDIRECT_URI', 'Redirect URI (optional)', false)],
    unlocks: ['Skip rate, average watch time, saves and shares for your own Reels. Reach for Trial Reels you log in Ledger.'],
    costLines: [], health: ['instagram.token'], docsHref: 'https://developers.facebook.com/apps/',
  },
  {
    id: 'producthunt', title: 'Product Hunt', required: false, fields: [op('PRODUCTHUNT_TOKEN', 'Developer token')],
    unlocks: ["Product Hunt launches as a Radar source, at low weight. Personal use only under Product Hunt's API terms."],
    costLines: [], health: ['producthunt.auth'], docsHref: 'https://www.producthunt.com/v2/oauth/applications',
  },
  {
    id: 'github', title: 'GitHub', required: false, fields: [op('GITHUB_TOKEN', 'Fine-grained token')],
    unlocks: ['Turns on the fake-star filter for GitHub launches on Radar and raises the search limit. Fine-grained token, no scopes.'],
    costLines: [], health: ['github.auth'], docsHref: 'https://github.com/settings/personal-access-tokens',
  },
  {
    id: 'xwatch', title: 'X watch list', required: false, fields: [],
    unlocks: ['First reactions and launch posts on Radar, read every 2 hours through Apify in one combined query.'],
    costLines: ['apify.radar_x'], health: ['radar.x'], docsHref: 'https://x.com',
  },
  {
    id: 'claude_cli', title: 'Local claude CLI', required: false, fields: [],
    unlocks: ["Dissection, ideas and scripts. No key; runs on this machine's Claude login."],
    costLines: ['llm'], health: ['claude.cli'], docsHref: 'https://docs.anthropic.com/en/docs/claude-code',
  },
];

/** 08.2.1 Lab settings rows. */
export const LAB_SETTINGS: readonly LabSettingSpec[] = [
  { id: 'lexicon', title: 'Concreteness lexicon', control: 'action', env: null, health: ['lexicon.file'] },
  { id: 'frames', title: 'Frame contact sheets', control: 'toggle', env: 'LAB_FRAMES', health: ['ffmpeg.bin'] },
  { id: 'tiktok_download_price', title: 'TikTok download price override (USD per video)', control: 'number', env: 'LAB_TIKTOK_DOWNLOAD_PRICE_USD', health: [] },
  { id: 'embed_provider', title: 'Embeddings for Ask the Lab', control: 'select', env: 'LAB_EMBED_PROVIDER', health: ['openai.auth'] },
  { id: 'judge', title: 'Pairwise hook judge', control: 'toggle', env: 'LAB_JUDGE', health: ['claude.cli'] },
  { id: 'judge_model', title: 'Judge model', control: 'text', env: 'LAB_JUDGE_MODEL', health: [] },
  { id: 'grounding_control', title: 'Control arm share', control: 'number', env: 'LAB_GROUNDING_CONTROL', health: [] },
];

/** Row copy of the Lab settings (08.2.1). The TikTok price line is built from the price book. */
export const LAB_SETTING_COPY: Record<LabSettingId, string> = {
  lexicon: 'Scores how concrete your hooks are. Downloaded once, never committed.',
  frames: 'Six frames per video for dissection. Needs ffmpeg and ffprobe on this machine.',
  tiktok_download_price: "Using Apify's published price, ${price} per video.",
  embed_provider: 'Local is free and runs here. OpenAI costs about $0.05 for a full backfill and needs a cap above $0 on Embeddings.',
  judge: 'Judge disabled in Setup.',
  judge_model: "Leave blank to use the claude CLI's default model.",
  grounding_control: 'Share of new script drafts written without evidence, to measure what grounding adds. 0 is off.',
};

/* ── the paste endpoint allowlist and value rules (08.2.3, 08.6.2, AC-08-26) ── */

/** 08.6.2 names writable through POST /api/lab/setup/keys besides the key fields and settings. */
export const SETUP_ENV_FLAGS = ['LAB_COMMENTS', 'LAB_TIKTOK_DOWNLOADS', 'LAB_BRIEF_TELEGRAM', 'LAB_X_POLL_MIN', 'LAB_RUN_MAX_USD'] as const;
/** Every cap env (the naming rule over providers and lines that have one). */
export const CAP_ENVS = [
  'LAB_APIFY_CAP_USD', 'LAB_APIFY_SYNC_CAP_USD', 'LAB_APIFY_SNAPSHOTS_CAP_USD', 'LAB_APIFY_X_CAP_USD', 'LAB_APIFY_VERIFY_CAP_USD',
  'LAB_APIFY_RADAR_X_CAP_USD', 'LAB_APIFY_RADAR_TIKTOK_CAP_USD', 'LAB_APIFY_RADAR_PRODUCTHUNT_CAP_USD',
  'LAB_STT_CAP_USD', 'LAB_STT_CONTROLS_CAP_USD', 'LAB_COMMENTS_CAP_USD', 'LAB_DOWNLOADS_CAP_USD', 'LAB_EMBED_CAP_USD',
] as const;
/** Never writable here: written once by 07's commentSalt(), never shown. */
export const NEVER_WRITABLE = ['LAB_COMMENT_SALT'] as const;

/** Every env name POST /api/lab/setup/keys may write. Anything else is 400 unknown_key. */
export function writableEnvs(): Set<string> {
  const out = new Set<string>();
  for (const k of LAB_KEYS) for (const f of k.fields) if (f.writtenBy === 'operator') out.add(f.env);
  for (const s of LAB_SETTINGS) if (s.env) out.add(s.env);
  for (const e of SETUP_ENV_FLAGS) out.add(e);
  for (const e of CAP_ENVS) out.add(e);
  // the Instagram paste path writes the oauth field directly (08.2.5)
  out.add('LAB_IG_ACCESS_TOKEN');
  for (const e of NEVER_WRITABLE) out.delete(e);
  return out;
}

const decimals = (v: string) => (v.includes('.') ? v.split('.')[1].length : 0);
const numberIn = (v: string, min: number, max: number, dp: number) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= min && Number(v) <= max && decimals(v) <= dp;

/** Value rules per env (08.2.1 settings ranges, 08.6.2). Null = valid, else the reason. */
export function invalidValue(env: string, value: string): string | null {
  if (!value) return 'empty';
  if (value.length > 4096) return 'too_long';
  if (/[\r\n\0]/.test(value)) return 'newline';
  switch (env) {
    case 'LAB_FRAMES':
    case 'LAB_COMMENTS':
    case 'LAB_TIKTOK_DOWNLOADS':
    case 'LAB_BRIEF_TELEGRAM':
      return value === '1' ? null : 'Use 1 to turn it on; DELETE turns it off.';
    case 'LAB_JUDGE':
      return value === '0' ? null : 'Use 0 to turn the judge off; DELETE turns it back on.';
    case 'LAB_TIKTOK_DOWNLOAD_PRICE_USD':
      return numberIn(value, 0.0001, 1, 4) ? null : 'A price from 0.0001 to 1, at most 4 decimals.';
    case 'LAB_EMBED_PROVIDER':
      return value === 'local' || value === 'openai' ? null : 'local or openai.';
    case 'LAB_JUDGE_MODEL':
      return /^[A-Za-z0-9._-]{1,64}$/.test(value) ? null : '1 to 64 letters, digits, dots, dashes or underscores.';
    case 'LAB_GROUNDING_CONTROL':
      return numberIn(value, 0, 0.5, 2) ? null : 'A share from 0 to 0.5, at most 2 decimals.';
    case 'LAB_X_POLL_MIN':
      return /^\d+$/.test(value) && Number(value) >= 60 && Number(value) <= 720 ? null : 'Minutes from 60 to 720.';
    case 'LAB_RUN_MAX_USD':
      return numberIn(value, 0.01, 1000, 2) ? null : 'Dollars from 0.01 to 1000, two decimals.';
    default:
      if ((CAP_ENVS as readonly string[]).includes(env)) return numberIn(value, 0, 1000, 2) ? null : 'Dollars from 0 to 1000, two decimals.';
      return /\s/.test(value) && env !== 'LAB_YT_REDIRECT_URI' && env !== 'LAB_IG_REDIRECT_URI' ? 'Keys have no spaces.' : null;
  }
}

/** The key spec that owns an env name (to rebuild its row after a write). */
export const keySpecForEnv = (env: string): LabKeySpec | null => LAB_KEYS.find((k) => k.fields.some((f) => f.env === env)) ?? null;

