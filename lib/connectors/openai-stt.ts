/**
 * Speech-to-text for Content Lab short-form posts (SPEC §4.4, Q3 default: OpenAI
 * Whisper through an OpenAI key). The existing LLM connector (lib/connectors/llm.ts)
 * is a chat gateway with no audio endpoint, so this is a small dedicated client.
 *
 * Plain REST, injectable fetch, no SDK:
 *   POST https://api.openai.com/v1/audio/transcriptions   multipart: file, model=whisper-1,
 *        response_format=verbose_json  →  { text, duration (seconds), language, segments }
 * Upload limit 25 MB per file (OpenAI docs). The key is read through lib/creds.ts
 * (`resolveSttKey`), never from code; a blank key is "not configured".
 *
 * Cost: OpenAI does not return a charge per call. Whisper bills by audio duration at a
 * published per-minute rate, so the Lab records `duration` from the API's own reply ×
 * that rate. WHISPER_USD_PER_MINUTE is OpenAI's published whisper-1 price as last seen
 * by this lane ($0.006 / minute); it was NOT re-checked on 2026-10-10 (no key on this
 * machine). Check the pricing page before the first live call.
 *
 * Never called in dry or Filming mode: lib/lab/transcribe.ts only builds a client in
 * the live branch of the spend gate.
 */
import { resolveSttKey } from '@/lib/connectors/apify';
import type { FetchLike } from '@/lib/lab/apify-client';

export const OPENAI_STT_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const WHISPER_MODEL = 'whisper-1';
export const WHISPER_USD_PER_MINUTE = 0.006;
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export function sttConfigured(): boolean {
  return Boolean(resolveSttKey());
}

/** Dollars for `durationS` seconds of audio at the published rate, to 4 places. */
export function whisperCost(durationS: number): number {
  return Math.round((Math.max(0, durationS) / 60) * WHISPER_USD_PER_MINUTE * 10_000) / 10_000;
}

export class SttError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'SttError';
  }
}

/** fetch with a body that can be FormData and a response that can hand back bytes. */
export type SttFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; headers?: { get(name: string): string | null } }>;

export function createSttClient(opts: { key: string; fetch?: SttFetch; url?: string }) {
  const f: SttFetch = opts.fetch ?? (globalThis.fetch as unknown as SttFetch);
  return {
    /** Download a post's media file (the actor's media URL), refusing anything over the upload limit. */
    async fetchMedia(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      if (!/^https:\/\//i.test(url)) throw new SttError('media URL is not https', 400);
      const res = await f(url, { method: 'GET' });
      if (!res.ok) throw new SttError(`media download answered ${res.status}`, res.status);
      const declared = Number(res.headers?.get('content-length') ?? 0);
      if (declared > WHISPER_MAX_BYTES) throw new SttError(`media is ${Math.round(declared / 1e6)} MB, over the 25 MB upload limit`, 413);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > WHISPER_MAX_BYTES) throw new SttError('media is over the 25 MB upload limit', 413);
      if (bytes.byteLength === 0) throw new SttError('media download was empty', 502);
      return { bytes, contentType: res.headers?.get('content-type') ?? 'video/mp4' };
    },
    /** Transcribe one file. Returns the text and the audio duration Whisper measured. */
    async transcribe(file: { bytes: Uint8Array; contentType: string; name?: string }): Promise<{ text: string; durationS: number | null; language: string | null }> {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.name ?? 'media.mp4');
      form.append('model', WHISPER_MODEL);
      form.append('response_format', 'verbose_json');
      const res = await f(opts.url ?? OPENAI_STT_URL, { method: 'POST', headers: { Authorization: `Bearer ${opts.key}` }, body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = `OpenAI transcription answered ${res.status}`;
        try {
          const err = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
          if (err) message = `${message}: ${err}`;
        } catch {
          /* not JSON */
        }
        throw new SttError(message, res.status);
      }
      const d = (await res.json()) as { text?: unknown; duration?: unknown; language?: unknown };
      if (typeof d.text !== 'string') throw new SttError('OpenAI transcription returned no text', 502);
      return { text: d.text.trim(), durationS: typeof d.duration === 'number' && Number.isFinite(d.duration) ? d.duration : null, language: typeof d.language === 'string' ? d.language : null };
    },
  };
}

export type SttClient = ReturnType<typeof createSttClient>;

/** A client from the configured key, or null (not configured: the Lab goes caption-only). */
export function sttClientFromCreds(): SttClient | null {
  const key = resolveSttKey();
  return key ? createSttClient({ key }) : null;
}
