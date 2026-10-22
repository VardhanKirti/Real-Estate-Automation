import { z } from 'zod';

/**
 * Creative Engine schemas — the document tree one campaign carries from a typed
 * concept to delivered assets (docs/projects/creative-engine/SPEC.md §6). Every
 * file under data/creative-engine/ parses through these on read, so a malformed
 * or hand-edited file degrades to "empty", never to a crash. Kept as a
 * sibling of lib/schemas.ts on purpose: nothing here has relations the org
 * model needs, and it is read whole per campaign like a Wizard project.
 */

export const DEPTHS = ['light', 'standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

/** Foreplay credit ceilings per depth — the number shown BEFORE a run. */
export const DEPTH_BUDGET: Record<Depth, { probes: number; duplicates: number; maxCalls: number }> = {
  light: { probes: 4, duplicates: 0, maxCalls: 6 },
  standard: { probes: 6, duplicates: 12, maxCalls: 19 },
  deep: { probes: 8, duplicates: 22, maxCalls: 31 },
};

export const ConceptSchema = z.object({
  text: z.string().min(3).max(300),
  product: z.string().max(120).default(''),
  audience: z.string().max(160).default(''),
  goal: z.enum(['awareness', 'leads', 'sales', 'installs', 'unset']).default('unset'),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ProbeSchema = z.object({
  query: z.string().min(2).max(80),
  why: z.string().max(160).default(''),
  results: z.number().int().min(0).default(0),
});
export type Probe = z.infer<typeof ProbeSchema>;

/** The WallAd shape (lib/foreplay/wall.ts) plus what research adds. Kept as
 *  a passthrough record so a Foreplay spec bump never breaks the store. */
export const PoolAdSchema = z
  .object({
    id: z.string(),
    brand: z.string(),
    brandId: z.string().nullable(),
    thumbnail: z.string().nullable(),
    video: z.string().nullable(),
    image: z.string().nullable(),
    format: z.string().nullable(),
    live: z.boolean(),
    daysRunning: z.number(),
    hook: z.string().nullable(),
    hookSource: z.enum(['spoken', 'text']).nullable(),
    transcript: z.array(z.object({ t: z.number(), s: z.string() })),
    drivers: z.record(z.string(), z.number()),
    ctaType: z.string().nullable(),
    linkUrl: z.string().nullable(),
    probes: z.array(z.string()).default([]),
    /** copies of this ad the brand runs — Foreplay adDuplicates; null = not checked */
    duplicates: z.number().int().nullable().default(null),
  })
  .passthrough();
export type PoolAd = z.infer<typeof PoolAdSchema>;

export const ResearchSchema = z.object({
  depth: z.enum(DEPTHS),
  expandedBy: z.enum(['claude', 'fallback', 'dry']),
  minDays: z.number().int().min(1).max(365),
  format: z.enum(['video', 'image', 'any']),
  probes: z.array(ProbeSchema),
  pool: z.array(PoolAdSchema),
  pooled: z.number().int(),
  apiCalls: z.number().int(),
  ranAt: z.string(),
});
export type Research = z.infer<typeof ResearchSchema>;

export const AngleSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(80),
  thesis: z.string().min(1).max(400),
  hookPattern: z.string().max(200).default(''),
  whyItWorks: z.string().max(400).default(''),
  proofAdIds: z.array(z.string()).min(1),
  drivers: z.array(z.string()).default([]),
  formats: z.array(z.enum(['video', 'image'])).default(['video']),
  confidence: z.enum(['strong', 'plausible']).default('plausible'),
  selected: z.boolean().default(false),
});
export type Angle = z.infer<typeof AngleSchema>;

export const FRAMEWORKS = [
  'hook-show-demo-result-verdict',
  'problem-agitate-solve',
  'testimonial-arc',
  'feature-walkthrough',
  'premium-reveal',
  'before-after',
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const TONES = [
  'excited-fan',
  'chill-recommender',
  'skeptic-converted',
  'best-friend',
  'morning-routine',
  'considered',
  'quiet-pride',
] as const;
export type Tone = (typeof TONES)[number];

export const INTROS = ['show', 'using', 'unboxing', 'in-hand', 'before-after'] as const;
export type Intro = (typeof INTROS)[number];

export const ScriptControlsSchema = z.object({
  targetSeconds: z.number().int().min(4).max(60).nullable().default(15), // null = briefing only, no cap
  tone: z.enum(TONES).default('best-friend'),
  intro: z.enum(INTROS).default('show'),
  cta: z.string().max(140).default(''),
  noStageDirections: z.literal(true).default(true),
});
export type ScriptControls = z.infer<typeof ScriptControlsSchema>;

export const BeatSchema = z.object({
  name: z.string().min(1).max(40),
  spoken: z.string().max(600),
  action: z.string().max(300).default(''),
  seconds: z.number().min(0).max(60),
});
export type Beat = z.infer<typeof BeatSchema>;

export const ScriptVersionSchema = z.object({
  n: z.number().int().min(1),
  hook: z.string(),
  beats: z.array(BeatSchema).min(1),
  cta: z.string(),
  fullScript: z.string(),
  wordCount: z.number().int(),
  targetSeconds: z.number().int().nullable(),
  fits: z.boolean(),
  notes: z.string().default(''),
  at: z.string(),
  by: z.enum(['claude', 'dry', 'edit']).default('claude'),
});
export type ScriptVersion = z.infer<typeof ScriptVersionSchema>;

export const ScriptSchema = z.object({
  id: z.string(),
  angleId: z.string(),
  framework: z.enum(FRAMEWORKS),
  controls: ScriptControlsSchema,
  versions: z.array(ScriptVersionSchema).default([]),
  approvedVersion: z.number().int().nullable().default(null),
  createdAt: z.string(),
});
export type Script = z.infer<typeof ScriptSchema>;

export const ProofBlockSchema = z.object({
  ads: z.array(
    z.object({
      id: z.string(),
      brand: z.string(),
      hook: z.string().nullable(),
      daysRunning: z.number(),
      live: z.boolean(),
      format: z.string().nullable(),
      duplicates: z.number().nullable(),
      linkUrl: z.string().nullable(),
    }),
  ),
  medianDays: z.number().nullable(),
  drivers: z.record(z.string(), z.number()),
  note: z.string(),
});
export type ProofBlock = z.infer<typeof ProofBlockSchema>;

export const BriefSchema = z.object({
  id: z.string(),
  scriptId: z.string(),
  angleId: z.string(),
  title: z.string(),
  markdown: z.string(),
  proof: ProofBlockSchema,
  status: z.enum(['draft', 'ready', 'sent']).default('ready'),
  at: z.string(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const GENERATION_KINDS = ['ugc', 'motion', 'image', 'workflow'] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const GenerationSchema = z.object({
  id: z.string(),
  kind: z.enum(GENERATION_KINDS),
  scriptId: z.string().nullable().default(null),
  request: z.record(z.string(), z.unknown()),
  runIds: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
  at: z.string(),
});
export type Generation = z.infer<typeof GenerationSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  generationId: z.string(),
  kind: z.enum(['video', 'image']),
  /** public path under /content-media/creative-engine/… (or the pre-rename /content-media/ad-engine/…), or null while only the source url is known */
  path: z.string().nullable(),
  thumbnailPath: z.string().nullable().default(null),
  sourceUrl: z.string().nullable(),
  model: z.string(),
  creditsCharged: z.number().nullable(),
  durationSec: z.number().nullable().default(null),
  at: z.string(),
  /** the workflow whose Deliver node collected this asset (S05b FR-64) */
  workflowId: z.string().nullable().optional(),
  /** a workflow final: it fed a Deliver node. Optional so every older writer and file stays valid. */
  final: z.boolean().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

/**
 * Where a campaign's research came from (S03 FR-1): `live` (real Foreplay
 * calls), `dry` (fixtures under CREATIVE_ENGINE_DRY) or `filming` (created in the
 * Filming demo world). Dry campaigns are never auto-opened as if they were
 * live (FR-2).
 */
export const CAMPAIGN_ORIGINS = ['live', 'dry', 'filming'] as const;
export type CampaignOrigin = (typeof CAMPAIGN_ORIGINS)[number];

/** A stored campaign with no `origin` whose research was fixtures reads as dry; no file rewrite needed. */
export function deriveOrigin(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = raw as { origin?: unknown; research?: { expandedBy?: unknown } | null };
  if (r.origin != null) return raw;
  return { ...r, origin: r.research?.expandedBy === 'dry' ? 'dry' : 'live' };
}

const CampaignObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  origin: z.enum(CAMPAIGN_ORIGINS).default('live'),
  concept: ConceptSchema,
  research: ResearchSchema.nullable().default(null),
  angles: z.array(AngleSchema).default([]),
  /** how many ads the operator wants from the selection (defaults to selected count) */
  adsWanted: z.number().int().min(0).default(0),
  scripts: z.array(ScriptSchema).default([]),
  briefs: z.array(BriefSchema).default([]),
  generations: z.array(GenerationSchema).default([]),
  assets: z.array(AssetSchema).default([]),
  arcads: z
    .object({ productId: z.string().nullable().default(null), folderId: z.string().nullable().default(null) })
    .default({ productId: null, folderId: null }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const CampaignSchema = z.preprocess(deriveOrigin, CampaignObjectSchema);
export type Campaign = z.infer<typeof CampaignObjectSchema>;

export const RUN_KINDS = ['research', 'angles', 'script', 'brief', 'ugc', 'motion', 'image', 'health', 'workflow'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** Per-kind wall clock after which a run with no terminal marker reads `stale`. */
export const RUN_TIMEOUT_MS: Record<RunKind, number> = {
  research: 3 * 60_000,
  angles: 2 * 60_000,
  script: 2 * 60_000,
  brief: 60_000,
  ugc: 25 * 60_000,
  motion: 25 * 60_000,
  image: 5 * 60_000,
  health: 60_000,
  workflow: 25 * 60_000,
};

/**
 * Per-kind wall clock a run usually takes (S07 F19). The rendering track puts
 * its tick here; past it the line turns orange, past RUN_TIMEOUT_MS it is stale.
 * Never above the timeout.
 */
export const RUN_TYPICAL_MS: Record<RunKind, number> = {
  research: 3 * 60_000,
  angles: 60_000,
  script: 60_000,
  brief: 20_000,
  ugc: 4 * 60_000,
  motion: 3 * 60_000,
  image: 60_000,
  health: 20_000,
  workflow: 5 * 60_000,
};

export const RunSchema = z.object({
  id: z.string(),
  campaignId: z.string().nullable(),
  kind: z.enum(RUN_KINDS),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  abandoned: z.boolean().default(false),
  /** the output this run promises; `resolveRun` checks it actually exists */
  outputRef: z.string().nullable().default(null),
  arcads: z
    .object({
      id: z.string(), // asset / video / script id returned by the create call
      type: z.string(), // create-response type: routes the poll
      model: z.string(),
      creditsCharged: z.number().nullable(),
      pollPath: z.enum(['assets', 'videos', 'scripts', 'talking-actors']),
      lastPolledAt: z.string().nullable().default(null),
      lastStatus: z.string().nullable().default(null),
      /** the create call's raw reply (capped), so the first real run documents the undocumented shape */
      lastRaw: z.string().nullable().default(null),
      /** Arcads credits remaining when this run was submitted (from GET /v1/credits), for the charge delta */
      creditsBefore: z.number().nullable().default(null),
      /** the expiring source link and thumbnail Arcads returned, kept so a failed download can be retried */
      sourceUrl: z.string().nullable().default(null),
      thumbnailUrl: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  foreplay: z.object({ apiCalls: z.number().int() }).nullable().default(null),
  dry: z.boolean().default(false),
});
export type Run = z.infer<typeof RunSchema>;

export const RUN_STATUSES = ['queued', 'running', 'delivered', 'failed', 'stale', 'abandoned'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CreditEntrySchema = z.object({
  at: z.string(),
  kind: z.enum(GENERATION_KINDS),
  model: z.string(),
  durationSec: z.number().nullable().default(null),
  creditsCharged: z.number(),
  runId: z.string(),
  dry: z.boolean().default(false),
  /** response = the create reply said so; delta = measured from GET /v1/credits before and after; dry = fixture */
  source: z.enum(['response', 'delta', 'dry']).default('response'),
});
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

export const HealthSchema = z.record(
  z.string(),
  z.object({ lastProbeAt: z.string(), ok: z.boolean(), error: z.string().nullable().default(null) }),
);
export type Health = z.infer<typeof HealthSchema>;

/** GET /v1/credits (CreditsBalanceDto), as stored after every read. */
export const CreditsSnapshotSchema = z.object({
  at: z.string(),
  creditsIncluded: z.number().nullable().default(null),
  creditsRemaining: z.number().nullable().default(null),
  additionalCreditsUsed: z.number().nullable().default(null),
  periodStart: z.string().nullable().default(null),
  periodEnd: z.string().nullable().default(null),
  plan: z.string().nullable().default(null),
});
export type CreditsSnapshot = z.infer<typeof CreditsSnapshotSchema>;

/** Engine settings the in-app setup writes (never secrets; those go to .env.local). */
export const EngineSettingsSchema = z.object({
  /** the Arcads product every generation is filed under, chosen in Connect Arcads */
  arcadsProductId: z.string().nullable().default(null),
  arcadsProductName: z.string().nullable().default(null),
  /** v2 = /v2/talking-actors (documented statuses); v1 = folder → script → generate chain */
  ugcPath: z.enum(['v2', 'v1']).default('v2'),
  /** per-session credit ceiling the cost gate refuses to pass without a second confirm */
  sessionCreditCap: z.number().int().min(0).default(200),
  /** when the current session's spend count started */
  sessionStartedAt: z.string().nullable().default(null),
});
export type EngineSettings = z.infer<typeof EngineSettingsSchema>;

/* ────────────────────────── Motion Console controls ────────────────────── */

/** The `model` enum of CreateVideoDto in the Arcads OpenAPI document (docs/projects/creative-engine/reference/). */
export const VIDEO_MODELS = ['seedance-2.0', 'seedance-2.0-mini', 'seedance-2.5', 'seedance', 'veo31', 'kling-3.0', 'kling-2.6', 'grok-video', 'minimax-h3', 'minimax-h3-max', 'happy-horse'] as const;
export type VideoModel = (typeof VIDEO_MODELS)[number];
export const IMAGE_MODELS = ['nano-banana-2', 'nano-banana', 'gpt-image-2', 'gpt-image', 'soul', 'grok_image', 'seedream', 'seedream_5_lite'] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const FRAMINGS = ['wide', 'medium', 'close-up', 'macro'] as const;
export const MOVEMENTS = ['static', 'handheld', 'slow push-in', 'pan', '360 orbit', 'top-down descend'] as const;
export const HEIGHTS = ['low', 'chest', 'eye level', 'slightly above', 'overhead'] as const;
export const LENSES = [24, 35, 50, 65, 85] as const;
export const INTENSITIES = ['slowly', 'gently', 'casually', 'quickly', 'deliberately'] as const;
export const STYLES = ['documentary', 'photorealistic', 'handheld phone', 'commercial'] as const;
export const LIGHTING = ['window daylight', 'overhead kitchen', 'golden hour', 'ring light', 'mixed practicals'] as const;
export const SETTINGS = ['bedroom desk', 'kitchen', 'car', 'bathroom mirror', 'living room', 'office', 'outdoors'] as const;
export const TEXT_REVEALS = ['fades in', 'snaps on', 'types on', 'slides in', 'builds word by word'] as const;

/** Text caps for the Motion console. The schema and every console input use these (S05a FR-2). */
export const CONSOLE_LIMITS = { subject: 300, action: 400, dialogue: 600, onScreenText: 80, presetName: 60 } as const;

export const ConsoleControlsSchema = z.object({
  model: z.enum(VIDEO_MODELS).default('seedance-2.0'),
  // bound
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9', 'auto']).default('9:16'),
  duration: z.number().int().min(1).max(30).default(8),
  resolution: z.enum(['480p', '720p', '1080p', '4K']).default('720p'),
  variations: z.number().int().min(1).max(10).default(1),
  audioEnabled: z.boolean().default(true),
  referenceImages: z.array(z.string()).max(30).default([]), // local upload paths; uploaded fresh per request
  referenceVideos: z.array(z.string()).max(10).default([]),
  referenceAudios: z.array(z.string()).max(10).default([]),
  /** CreateVideoDto.enhance: Claude rewrites the prompt before generation, +8 credits */
  enhance: z.boolean().default(false),
  bitrateMode: z.enum(['standard', 'high']).default('standard'),
  startFrame: z.string().nullable().default(null),
  endFrame: z.string().nullable().default(null),
  // composed (prose)
  subject: z.string().max(CONSOLE_LIMITS.subject).default(''),
  action: z.string().max(CONSOLE_LIMITS.action).default(''),
  dialogue: z.string().max(CONSOLE_LIMITS.dialogue).default(''),
  framing: z.enum(FRAMINGS).default('medium'),
  movement: z.enum(MOVEMENTS).default('handheld'),
  height: z.enum(HEIGHTS).default('eye level'),
  lensMm: z.number().int().default(35),
  intensity: z.number().int().min(1).max(5).default(3),
  style: z.enum(STYLES).default('documentary'),
  lighting: z.enum(LIGHTING).default('window daylight'),
  setting: z.enum(SETTINGS).default('living room'),
  imperfection: z.number().int().min(0).max(9).default(3),
  skinRealism: z.number().int().min(0).max(4).default(2),
  motionCues: z.number().int().min(3).max(6).default(3),
  intro: z.enum(INTROS).default('show'),
  tone: z.enum(TONES).default('best-friend'),
  onScreenText: z.string().max(CONSOLE_LIMITS.onScreenText).default(''),
  textReveal: z.enum(TEXT_REVEALS).default('fades in'),
  noCaptions: z.literal(true).default(true),
  /** prompt parts hidden by the scene tree's eye toggles; constraints cannot be hidden */
  omit: z.array(z.enum(['subject', 'action', 'camera', 'style'])).default([]),
  /** the Dialogue check is off: the text is kept but left out of the prompt and its lints (S05a FR-11) */
  omitDialogue: z.boolean().default(false),
});
export type ConsoleControls = z.infer<typeof ConsoleControlsSchema>;

export const PresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(CONSOLE_LIMITS.presetName),
  builtin: z.boolean().default(false),
  controls: ConsoleControlsSchema.partial(),
  at: z.string(),
});
export type Preset = z.infer<typeof PresetSchema>;


/* ─────────────────────────── Workflow builder ─────────────────────────── */

export const PORT_TYPES = ['text', 'image', 'video', 'audio'] as const;
export type PortType = (typeof PORT_TYPES)[number];

/** Every node kind maps to one public Arcads endpoint or one local operation (lib/creative-engine/workflow.ts). */
export const NODE_TYPES = [
  'text', 'script', 'media', 'asset',
  'llm', 'enhance',
  'video', 'image', 'talkingActor', 'veo31', 'videoEdit', 'broll', 'scene', 'music', 'audioDriven', 'omnihuman', 'preset',
  'deliver',
  // not addable: a stored node whose type no longer exists loads as this placeholder (S05b edge case 11)
  'missing',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  title: z.string().max(60).default(''),
  x: z.number().default(0),
  y: z.number().default(0),
  /** per-type settings, validated by the registry at run time */
  settings: z.record(z.string(), z.unknown()).default({}),
  /** the run this node submitted (Arcads nodes) */
  runId: z.string().nullable().default(null),
  /** resolved outputs */
  outputAssetId: z.string().nullable().default(null),
  outputText: z.string().nullable().default(null),
  /** local-node failure text; Arcads failures live on the run */
  error: z.string().nullable().default(null),
  resolvedAt: z.string().nullable().default(null),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromPort: z.string(),
  to: z.string(),
  toPort: z.string(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string().min(1).max(80),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  /** set by Run; cleared by Reset. A node with resolvedAt before this is stale */
  runStartedAt: z.string().nullable().default(null),
  /** node ids the current run covers (Run failed only, Run from here); null = every node (S05b FR-60) */
  /** when the design (layout, settings, name) last changed; the conflict check compares this, so engine writes during a run never look like another tab (S05b FR-28) */
  layoutAt: z.string().optional(),
  runScope: z.array(z.string()).nullable().optional(),
  /** what each Deliver resolve collected (S05b FR-64) */
  deliveries: z.array(z.object({ runAt: z.string(), assetIds: z.array(z.string()) })).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

/* ── Health snapshot (GET /api/creative-engine/arcads/health), shared by lib and UI ── */

export type HealthMap = Record<string, { lastProbeAt: string; ok: boolean; error: string | null }>;

export type HealthSnapshot = {
  ok: true;
  /** Every paid call returns a fixture in this process. */
  dry: boolean;
  /** CREATIVE_ENGINE_DRY=1 (or legacy AD_ENGINE_DRY=1) itself (a test session), as opposed to the Filming force. */
  dryEnv: boolean;
  /** The env name that set dryEnv, for the status card copy. */
  dryEnvName?: string;
  /** Filming mode: the store is the demo world. */
  filming: boolean;
  foreplay: { configured: boolean; remaining: number | null; total: number | null; lastSyncAt: string | null; setupHref: string };
  arcads: {
    configured: boolean;
    health: HealthMap;
    creditsThisMonth: number;
    sessionSpent: number;
    sessionCap: number;
    sessionSince: string | null;
    ledgerEntries: number;
    balance: CreditsSnapshot | null;
    productId: string | null;
    productName: string | null;
    ugcPath: 'v2' | 'v1';
    setupHref: string;
  };
  claude: { present: boolean; version: string | null };
};
