import { CRED_FILES, resolveCred } from '@/lib/creds';

/**
 * Typed Arcads client, written against the OpenAPI document at
 * docs/projects/creative-engine/reference/arcads-openapi-2026-10-01.json
 * (public at https://external-api.arcads.ai/docs-json). Auth is HTTP
 * Basic. Two product lines behind it:
 *   UGC   /v2/talking-actors/generate → [{id,status}] → /v2/talking-actors/{id}
 *         → status processing|completed|failed → /{id}/watch (302 to the file)
 *         (the older chain /v1/folders → /v1/scripts → /{id}/generate →
 *         /{id}/videos is kept behind a setting)
 *   Video /v2/videos/generate (CreateVideoDto) → poll /v1/assets/{id}
 *         (AssetResponseDto.status created|pending|generated|failed|uploaded)
 *         → POST /v1/assets/{id}/download for a signed link
 *   Also  /v1/file-upload/get-presigned-url (+ PUT), /v1/credits,
 *         /v1/products, /v1/situations, /v1/voices.
 * Rules kept: every call has a timeout; uploads are single-use; no retries
 * on a 4xx create (a rejected create is not refunded). What the document
 * does NOT say: the body of the 201 from /v2/videos/generate. `normaliseCreate`
 * accepts the shapes we can imagine and keeps the raw text on the run.
 */

export const ARCADS_BASE = process.env.ARCADS_BASE_URL ?? 'https://external-api.arcads.ai';

export type ArcadsErrorKind = 'auth' | 'credits' | 'rate' | 'content' | 'notfound' | 'bad-request' | 'server' | 'timeout' | 'network' | 'unknown';

export class ArcadsError extends Error {
  kind: ArcadsErrorKind;
  retryAfterSec: number | null;
  constructor(
    message: string,
    public status: number,
    public body: string,
    opts: { kind?: ArcadsErrorKind; retryAfterSec?: number | null } = {},
  ) {
    super(message);
    this.kind = opts.kind ?? kindForStatus(status);
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }
}

export function kindForStatus(status: number): ArcadsErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'credits';
  if (status === 429) return 'rate';
  if (status === 422) return 'content';
  if (status === 404) return 'notfound';
  if (status === 400) return 'bad-request';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/** One sentence the operator can act on, per error class. */
export function explainArcadsError(err: unknown): { kind: ArcadsErrorKind; message: string; httpStatus: number } {
  if (err instanceof ArcadsError) {
    const detail = err.body ? ` (${err.body.replace(/\s+/g, ' ').slice(0, 140)})` : '';
    switch (err.kind) {
      case 'auth': return { kind: 'auth', message: `Arcads rejected the key (${err.status}). Reconnect in Connect Arcads.`, httpStatus: 401 };
      case 'credits': return { kind: 'credits', message: 'Arcads says the workspace is out of credits (402). Top up, then retry.', httpStatus: 402 };
      case 'rate': return { kind: 'rate', message: `Arcads is rate limiting (429)${err.retryAfterSec ? `; retry after ${err.retryAfterSec}s` : ''}. Nothing was charged.`, httpStatus: 429 };
      case 'content': return { kind: 'content', message: `Arcads refused the request (422)${detail}. A content-check rejection is not refunded.`, httpStatus: 422 };
      case 'notfound': return { kind: 'notfound', message: `Arcads has no such record (404)${detail}.`, httpStatus: 404 };
      case 'bad-request': return { kind: 'bad-request', message: `Arcads rejected the body (400)${detail}. The field rules in validate.ts need updating.`, httpStatus: 400 };
      case 'timeout': return { kind: 'timeout', message: `Arcads did not answer in time (${err.message}). Nothing is known about the charge; the run keeps polling.`, httpStatus: 504 };
      case 'server': return { kind: 'server', message: `Arcads failed on its side (${err.status})${detail}.`, httpStatus: 502 };
      default: return { kind: err.kind, message: `${err.message}${detail}`, httpStatus: 502 };
    }
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return { kind: 'timeout', message: 'Arcads did not answer in time. The run keeps polling.', httpStatus: 504 };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err), httpStatus: 502 };
}

export function resolveArcadsAuth(): string | undefined {
  const raw = resolveCred('ARCADS_BASIC_AUTH', [CRED_FILES.arcads, CRED_FILES.arcadsReference]);
  if (!raw) return undefined;
  return raw.startsWith('Basic ') ? raw : `Basic ${raw}`;
}

/* ── DTOs, named as in the document ── */
export type EmbeddedActor = { id: string; name: string; gender?: string; age?: string; skinToneHex?: string; freeSpeech?: boolean; imageUrl?: string };
export type ArcadsSituation = {
  id: string;
  tags: string[];
  emotions?: string[];
  accessories?: string[];
  cameraAngle?: string | null;
  imageUrl: string;
  previewUrl: string;
  talkingActorEnabled?: boolean;
  /** present on the live object although the document omits it; preferred over a gender/age match */
  defaultVoiceId?: string | null;
  actor?: EmbeddedActor | null;
};
export type ArcadsVoice = { id: string; name: string; gender: string | null; age: string | null; accent: string; descriptive: string; audioUrl: string; language?: string | null };
export type ArcadsProduct = { id: string; name: string; description?: string; targetAudience?: string };
export type ArcadsFolder = { id: string; name: string; productId?: string };
export type AssetStatus = 'created' | 'pending' | 'generated' | 'failed' | 'uploaded';
export type AssetResponse = { id: string; productId?: string; type: string; url?: string; sdUrl?: string; thumbnailUrl?: string; status?: AssetStatus | string; data?: Record<string, unknown>; subStatus?: Record<string, unknown> | string | null; projects?: string[] };
export type VideoResponse = { id: string; scriptId?: string; situationId?: string; voiceId?: string; videoStatus?: Record<string, unknown> | string | null; videoUrl?: string; thumbnailUrl?: string; data?: Record<string, unknown> };
export type CreditsBalance = { plan?: { name?: string } | string | null; creditsIncluded: number; creditsRemaining: number; mcpCreditsSpentThisPeriod?: unknown; additionalCreditsUsed: number; currentPeriodStart?: string | null; currentPeriodEnd?: string | null };
export type TalkingActorResult = { id: string; model: string; status: 'processing' | 'completed' | 'failed'; error?: string };
export type CreateResponse = { id: string; status: string; type: string; creditsCharged: number | null; raw: string };

type FetchLike = typeof fetch;

export class ArcadsClient {
  callCount = 0;
  constructor(
    private auth: string,
    private fetchImpl: FetchLike = fetch,
    private base = ARCADS_BASE,
  ) {}

  /** The fetch this client was built with, so downloads share the injected one in tests. */
  fetcher(): FetchLike {
    return this.fetchImpl;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; raw?: boolean } = {}): Promise<T> {
    this.callCount += 1;
    const method = init.method ?? 'GET';
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
        // Next 14 caches server-side GET fetches by default; a poll must never replay its first answer
        cache: 'no-store',
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError' || name === 'TimeoutError') throw new ArcadsError(`Arcads ${method} ${path}: no answer in ${init.timeoutMs ?? 20_000}ms`, 0, '', { kind: 'timeout' });
      throw new ArcadsError(`Arcads ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`, 0, '', { kind: 'network' });
    }
    const text = await res.text();
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      throw new ArcadsError(`Arcads ${method} ${path} → ${res.status}`, res.status, text.slice(0, 500), { retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null });
    }
    if (init.raw) return text as unknown as T;
    if (!text.trim()) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // a bare string reply (the watch endpoints) is still an answer
      return text as unknown as T;
    }
  }

  /* ── workspace ── */
  async credits(): Promise<CreditsBalance> {
    return this.request<CreditsBalance>('/v1/credits', { timeoutMs: 10_000 });
  }
  async products(): Promise<ArcadsProduct[]> {
    return unwrapList<ArcadsProduct>(await this.request<unknown>('/v1/products?pageSize=100', { timeoutMs: 10_000 }));
  }
  async createProduct(input: { name: string; description: string }): Promise<ArcadsProduct> {
    return this.request<ArcadsProduct>('/v1/products', { method: 'POST', body: input, timeoutMs: 30_000 });
  }
  async createFolder(productId: string, name: string): Promise<ArcadsFolder> {
    return this.request<ArcadsFolder>('/v1/folders', { method: 'POST', body: { productId, name }, timeoutMs: 30_000 });
  }

  /* ── catalog ── */
  async situations(): Promise<ArcadsSituation[]> {
    return unwrapList<ArcadsSituation>(await this.request<unknown>('/v1/situations?actorFreeSpeech=true&talkingActorEnabled=true&pageSize=200', { timeoutMs: 15_000 }));
  }
  async voices(): Promise<ArcadsVoice[]> {
    return unwrapList<ArcadsVoice>(await this.request<unknown>('/v1/voices?pageSize=200', { timeoutMs: 15_000 }));
  }

  /* ── UGC, v2 talking actors ── */
  async generateTalkingActors(input: { productId: string; script: string; actors: { situationId: string; voiceId?: string }[]; model?: 'arcads_1.0' | 'audio_driven' | 'omnihuman'; autoAddScriptEmotion?: boolean }): Promise<{ results: TalkingActorResult[]; raw: string }> {
    const raw = await this.request<string>('/v2/talking-actors/generate', { method: 'POST', body: { model: input.model ?? 'arcads_1.0', productId: input.productId, script: input.script, actors: input.actors, autoAddScriptEmotion: input.autoAddScriptEmotion ?? true }, timeoutMs: 30_000, raw: true });
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const list = unwrapList<TalkingActorResult>(parsed);
    const results = list.length ? list : parsed && typeof parsed === 'object' && 'id' in (parsed as object) ? [parsed as TalkingActorResult] : [];
    return { results, raw: raw.slice(0, 2000) };
  }
  async talkingActor(id: string): Promise<TalkingActorResult> {
    return this.request<TalkingActorResult>(`/v2/talking-actors/${id}`);
  }
  /** The watch endpoint answers 302 to the file; keep the Location rather than the bytes. */
  async talkingActorWatch(id: string): Promise<string | null> {
    this.callCount += 1;
    const res = await this.fetchImpl(`${this.base}/v2/talking-actors/${id}/watch`, { headers: { Authorization: this.auth }, redirect: 'manual', signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    const loc = res.headers.get('location');
    if (loc) return loc;
    if (res.ok && res.url && !res.url.endsWith('/watch')) return res.url;
    const text = await res.text().catch(() => '');
    if (res.ok && /^https?:\/\//.test(text.trim())) return text.trim();
    return null;
  }

  /* ── UGC, v1 chain (kept behind the ugcPath setting) ── */
  async createScript(input: { folderId: string; name: string; text: string; situationId: string; voiceId?: string }): Promise<{ id: string; version?: number }> {
    const video: Record<string, string> = { situationId: input.situationId };
    if (input.voiceId) video.voiceId = input.voiceId;
    return this.request<{ id: string }>('/v1/scripts', { method: 'POST', body: { folderId: input.folderId, name: input.name, text: input.text, videos: [video] }, timeoutMs: 30_000 });
  }
  async generateScript(scriptId: string): Promise<unknown> {
    return this.request<unknown>(`/v1/scripts/${scriptId}/generate`, { method: 'POST', timeoutMs: 30_000 });
  }
  async scriptVideos(scriptId: string): Promise<VideoResponse[]> {
    return unwrapList<VideoResponse>(await this.request<unknown>(`/v1/scripts/${scriptId}/videos`));
  }
  async watch(videoId: string): Promise<string | null> {
    const w = await this.request<unknown>(`/v1/videos/${videoId}/watch`);
    if (typeof w === 'string') return w;
    if (w && typeof w === 'object') return ((w as Record<string, unknown>).url as string) ?? ((w as Record<string, unknown>).signedUrl as string) ?? null;
    return null;
  }

  /* ── uploads and v2 generation ── */
  async presign(fileType: string): Promise<{ presignedUrl: string; filePath: string; fileId?: string }> {
    return this.request('/v1/file-upload/get-presigned-url', { method: 'POST', body: { fileType }, timeoutMs: 15_000 });
  }
  /** Upload bytes to a fresh presigned URL. Single-use: call once per downstream request. */
  async upload(bytes: Uint8Array, fileType: string): Promise<string> {
    const { presignedUrl, filePath } = await this.presign(fileType);
    const res = await this.fetchImpl(presignedUrl, { method: 'PUT', headers: { 'Content-Type': fileType }, body: bytes as unknown as BodyInit, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new ArcadsError(`upload failed ${res.status}`, res.status, '');
    return filePath;
  }
  async generateVideo(body: Record<string, unknown>): Promise<CreateResponse> {
    const raw = await this.request<string>('/v2/videos/generate', { method: 'POST', body, timeoutMs: 30_000, raw: true });
    return normaliseCreate(raw, String(body.model ?? ''));
  }
  async generateImage(body: Record<string, unknown>): Promise<CreateResponse> {
    const raw = await this.request<string>('/v2/images/generate', { method: 'POST', body, timeoutMs: 30_000, raw: true });
    return normaliseCreate(raw, String(body.model ?? ''));
  }
  /* ── the rest of the generation vocabulary (every 201 is an asset record or a list of them) ── */
  async generateVeo31(body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/veo31/generate/video', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'veo31');
  }
  /** Gemini Omni Flash: generation, or editing when referenceVideos carries the source. */
  async generateOmniFlash(body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/omni-flash/generate/video', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'omni_flash');
  }
  async generateBRoll(body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/b-roll', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'b_roll');
  }
  async generateScene(body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/scene', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'scene');
  }
  async generateMusic(body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/music/generate', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'create_music');
  }
  async generateAudioDriven(body: { productId: string; text: string; videos: { situationId: string; voiceId?: string }[] }): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/audio-driven', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'audio_driven');
  }
  async generateOmnihuman(body: { productId: string; text: string; videos: { situationId: string; voiceId?: string }[] }): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>('/v1/omnihuman', { method: 'POST', body, timeoutMs: 30_000, raw: true }), 'omnihuman');
  }
  async presetTypes(): Promise<{ type: string; name: string; description: string }[]> {
    return unwrapList(await this.request<unknown>('/v1/presets', { timeoutMs: 15_000 }));
  }
  async presetTemplates(presetType: string): Promise<ArcadsSituation[]> {
    return unwrapList<ArcadsSituation>(await this.request<unknown>(`/v1/presets/${presetType}/templates?pageSize=100`, { timeoutMs: 15_000 }));
  }
  async generatePreset(presetType: string, body: Record<string, unknown>): Promise<CreateResponse> {
    return normaliseCreate(await this.request<string>(`/v1/presets/${presetType}/generate`, { method: 'POST', body, timeoutMs: 30_000, raw: true }), presetType.replace(/-/g, '_'));
  }
  /** The brand's asset library: newest first, free-text over prompts and scripts. */
  async assetsLibrary(q: { productId: string; q?: string; kind?: 'video' | 'photo'; aspectRatio?: string; page?: number; pageSize?: number }): Promise<{ count: number; items: AssetResponse[] }> {
    const params = new URLSearchParams({ productId: q.productId, pageSize: String(q.pageSize ?? 24), page: String(q.page ?? 1) });
    if (q.q) params.set('q', q.q);
    if (q.kind) params.set('kind', q.kind);
    if (q.aspectRatio) params.set('aspectRatio', q.aspectRatio);
    const r = await this.request<{ count?: number; items?: AssetResponse[] }>(`/v1/assets?${params}`, { timeoutMs: 20_000 });
    return { count: r?.count ?? 0, items: unwrapList<AssetResponse>(r) };
  }
  async asset(id: string): Promise<AssetResponse> {
    return this.request<AssetResponse>(`/v1/assets/${id}`);
  }
  async video(id: string): Promise<VideoResponse> {
    return this.request<VideoResponse>(`/v1/videos/${id}`);
  }
  /** POST /v1/assets/{id}/download → a signed link the file can be fetched from. */
  async downloadUrl(id: string): Promise<string | null> {
    const d = await this.request<unknown>(`/v1/assets/${id}/download`, { method: 'POST', timeoutMs: 15_000 });
    if (typeof d === 'string') return /^https?:\/\//.test(d.trim()) ? d.trim() : null;
    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      for (const k of ['url', 'downloadUrl', 'signedUrl', 'link']) if (typeof o[k] === 'string') return o[k] as string;
    }
    return null;
  }
}

export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['items', 'entries', 'created', 'data', 'results']) if (Array.isArray(o[k])) return o[k] as T[];
  }
  return [];
}

/**
 * The 201 of /v2/videos/generate has no schema in the document. Accept an
 * object with an id, an array of them (the talking-actors shape), or an
 * envelope, and keep the raw text so the first real run tells us.
 */
export function normaliseCreate(raw: string, model: string): CreateResponse {
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const list = unwrapList<Record<string, unknown>>(parsed);
  let o: Record<string, unknown> | null = list[0] ?? (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null);
  if (o && !('id' in o)) {
    for (const k of ['asset', 'video', 'result', 'data']) if (o[k] && typeof o[k] === 'object' && 'id' in (o[k] as object)) { o = o[k] as Record<string, unknown>; break; }
  }
  if (!o || typeof o.id !== 'string') throw new ArcadsError(`Arcads create reply had no id: ${raw.slice(0, 160)}`, 201, raw.slice(0, 500), { kind: 'unknown' });
  const data = (o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const credits = typeof o.creditsCharged === 'number' ? o.creditsCharged : typeof data.creditsCharged === 'number' ? (data.creditsCharged as number) : null;
  return { id: o.id, status: String(o.status ?? 'created'), type: String(o.type ?? model), creditsCharged: credits, raw: raw.slice(0, 2000) };
}

/** Every v2 generation is an asset; the v1 videos route is only for the UGC chain. */
export function pollPathFor(_type: string): 'assets' | 'videos' {
  return 'assets';
}

export type PollResult = { status: 'pending' | 'generated' | 'failed'; url: string | null; thumbnailUrl: string | null; error: string | null; raw: string };

/** AssetResponseDto.status → ours. Synonyms kept for the v1 video object. */
export function normStatus(s: string | undefined | null): PollResult['status'] {
  const v = (s ?? '').toLowerCase();
  if (['generated', 'uploaded', 'completed', 'done', 'complete', 'success', 'ready'].includes(v)) return 'generated';
  if (['failed', 'error', 'rejected', 'cancelled', 'canceled'].includes(v)) return 'failed';
  return 'pending';
}

function errorFrom(o: Record<string, unknown> | undefined): string | null {
  if (!o) return null;
  const e = o.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') return (e as Record<string, unknown>).message as string;
  if (typeof o.errorMessage === 'string') return o.errorMessage;
  return null;
}

/** The v1 VideoDto carries `videoStatus` as an object the document leaves opaque; read every plausible key. */
export function readVideoStatus(v: VideoResponse): string {
  const vs = v.videoStatus;
  if (typeof vs === 'string') return vs;
  if (vs && typeof vs === 'object') {
    for (const k of ['status', 'state', 'value', 'name']) if (typeof vs[k] === 'string') return vs[k] as string;
  }
  if (typeof v.videoUrl === 'string' && /^https?:\/\//.test(v.videoUrl)) return 'generated';
  return '';
}

/** Poll one v2 job on /v1/assets, falling back to /v1/videos on 404. */
export async function pollV2(client: ArcadsClient, id: string, pollPath: 'assets' | 'videos' = 'assets'): Promise<PollResult> {
  const tryAsset = async (): Promise<PollResult> => {
    const a = await client.asset(id);
    const err = errorFrom(a.data) ?? errorFrom(a as unknown as Record<string, unknown>);
    return { status: normStatus(a.status), url: a.url ?? a.sdUrl ?? (a.data?.url as string | undefined) ?? null, thumbnailUrl: a.thumbnailUrl ?? null, error: err, raw: String(a.status ?? '') };
  };
  const tryVideo = async (): Promise<PollResult> => {
    const v = await client.video(id);
    const s = readVideoStatus(v);
    return { status: normStatus(s), url: v.videoUrl || null, thumbnailUrl: v.thumbnailUrl ?? null, error: errorFrom(v.data), raw: s };
  };
  const first = pollPath === 'assets' ? tryAsset : tryVideo;
  const second = pollPath === 'assets' ? tryVideo : tryAsset;
  try {
    return await first();
  } catch (e) {
    if (e instanceof ArcadsError && e.status === 404) return second();
    throw e;
  }
}

/** Poll one talking-actor job: documented statuses, then the watch link. */
export async function pollTalkingActor(client: ArcadsClient, id: string): Promise<PollResult> {
  const r = await client.talkingActor(id);
  if (r.status === 'failed') return { status: 'failed', url: null, thumbnailUrl: null, error: r.error ?? 'generation failed', raw: r.status };
  if (r.status === 'completed') {
    const url = await client.talkingActorWatch(id).catch(() => null);
    return { status: 'generated', url, thumbnailUrl: null, error: url ? null : 'completed but the watch link was empty', raw: r.status };
  }
  return { status: 'pending', url: null, thumbnailUrl: null, error: null, raw: r.status };
}

/** Poll one v1 UGC script. */
export async function pollUgc(client: ArcadsClient, scriptId: string): Promise<PollResult & { videoId: string | null }> {
  const videos = await client.scriptVideos(scriptId);
  if (videos.length === 0) return { status: 'pending', url: null, thumbnailUrl: null, error: null, raw: 'no videos yet', videoId: null };
  const v = videos[0];
  const s = readVideoStatus(v);
  const status = normStatus(s);
  const videoId = typeof v.id === 'string' ? v.id : null;
  if (status === 'generated' && videoId) {
    let url: string | null = v.videoUrl || null;
    const w = await client.watch(videoId).catch(() => null);
    if (w) url = w;
    return { status, url, thumbnailUrl: v.thumbnailUrl ?? null, error: null, raw: s, videoId };
  }
  if (status === 'failed') return { status, url: null, thumbnailUrl: null, error: errorFrom(v.data) ?? 'generation failed', raw: s, videoId };
  return { status: 'pending', url: null, thumbnailUrl: null, error: null, raw: s, videoId };
}

export function createArcadsClient(fetchImpl?: FetchLike): ArcadsClient | null {
  const auth = resolveArcadsAuth();
  if (!auth) return null;
  return new ArcadsClient(auth, fetchImpl);
}
