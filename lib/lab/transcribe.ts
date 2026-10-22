import type { LabControl, LabPost, LabSpendLine, LabTranscript } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { CapError, gatedCall } from '@/lib/lab/spend';
import { wordCount, wpmOf } from '@/lib/lab/measures';
import { dryTranscriptText } from '@/lib/lab/dry-items';
import { WHISPER_MODEL, whisperCost, type SttClient } from '@/lib/connectors/openai-stt';

/**
 * v2 (04 5.2): eligibility is case-control. Every owned post; tracked posts only when they are a
 * case or a drawn control (lab_controls). The v1 top-quartile rule is gone: it sampled on the
 * outcome. Cases transcribe on the `stt` line, controls on `stt.controls`. A per-minute price the
 * operator entered in Setup (`lab_priors` stt_price) replaces the 0.006 constant.
 *
 * Transcription (SPEC §4.4), v1 text: only posts that can teach something are transcribed: every
 * owned post, and tracked posts with breakout ≥ 2x or in the top quartile of their
 * creator's views (§4.4, caps cost per §7).
 *
 *   YouTube        subtitles from the actor item, stored free at ingest (lib/lab/sync.ts);
 *                  a video the actor returned none for is `none` (no paid fallback).
 *   short-form     TikTok, Reels, X and LinkedIn video with a media URL → Whisper
 *                  (lib/connectors/openai-stt.ts) through the gate (provider `stt`, its own
 *                  monthly cap). No OpenAI key: `none`, provider `none`, the post is
 *                  analysed caption-only and its hook and beats stay out of pattern mining.
 *   no audio       images, carousels, text posts: `none`, provider `caption-only`.
 *
 * Status `none` with provider `none` is retried once a key exists; `done` and `failed`
 * are final. TikTok media URLs are only downloadable files when the actor ran with
 * shouldDownloadVideos (an extra paid event, off by default: LAB_TIKTOK_DOWNLOADS=1).
 */

export const TRANSCRIBE_PER_CYCLE = 30;

const AUDIO_TYPES = new Set(['video', 'reel', 'short']);

/** Which posts deserve a transcript (04 5.2): every owned post, every case and drawn control. Pure. */
export function transcriptionEligible(posts: readonly LabPost[], roles: ReadonlyMap<string, Pick<LabControl, 'role'>>): Set<string> {
  const out = new Set<string>();
  for (const p of posts) if (p.isOwned || roles.has(p.id)) out.add(p.id);
  return out;
}

/** Whisper cost for a duration: the operator's per-minute price (lab_priors stt_price, LC-6) when set, else the published constant. */
export function sttCost(store: LabStore, durationS: number): number {
  const v = store.priors.get('stt_price')?.value;
  const perMin = typeof v === 'number' ? v : typeof (v as { usdPerMinute?: unknown } | null)?.usdPerMinute === 'number' ? (v as { usdPerMinute: number }).usdPerMinute : null;
  if (perMin === null || !(perMin >= 0)) return whisperCost(durationS);
  return Math.round((Math.max(0, durationS) / 60) * perMin * 10_000) / 10_000;
}

export type TranscriptRoute = 'subtitles' | 'stt' | 'caption-only';

/** How a post would be transcribed. Pure. */
export function routeFor(p: Pick<LabPost, 'platform' | 'contentType' | 'mediaUrl'>): TranscriptRoute {
  if (!AUDIO_TYPES.has(p.contentType)) return 'caption-only';
  if (p.platform === 'youtube') return 'subtitles';
  return p.mediaUrl && /^https:\/\//i.test(p.mediaUrl) ? 'stt' : 'caption-only';
}

/** Should this post be (re)visited? Done and failed are final; `none` from a missing key is retried once a key exists. */
export function needsTranscript(t: LabTranscript | null, sttReady: boolean): boolean {
  if (!t) return true;
  if (t.status === 'done' || t.status === 'failed') return false;
  return t.status === 'none' && t.provider === 'none' && sttReady;
}

export type TranscribeDeps = { store: LabStore; stt: SttClient | null; dry: boolean; now?: Date; override?: boolean; scheduled?: boolean; limit?: number };
export type TranscribeResult = { considered: number; done: number; none: number; failed: number; blocked: string | null };

const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export async function transcribeCycle(deps: TranscribeDeps): Promise<TranscribeResult> {
  const { store } = deps;
  const now = deps.now ?? new Date();
  const sttReady = deps.dry || deps.stt !== null;
  const posts = store.posts.all();
  const roles = new Map(store.controls.all().map((c) => [c.postId, c]));
  const eligible = transcriptionEligible(posts, roles);
  const todo = posts
    .filter((p) => eligible.has(p.id) && needsTranscript(store.transcripts.get(p.id), sttReady))
    .sort((a, b) => Number(b.isOwned) - Number(a.isOwned) || String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')))
    .slice(0, deps.limit ?? TRANSCRIBE_PER_CYCLE);
  const res: TranscribeResult = { considered: todo.length, done: 0, none: 0, failed: 0, blocked: null };
  const audio: LabPost[] = [];
  for (const p of todo) {
    const route = routeFor(p);
    if (route === 'stt' && (deps.dry || deps.stt)) {
      audio.push(p);
      continue;
    }
    // no file to send, or no key: honest none (a missing key is retried once one exists)
    const provider = route === 'subtitles' ? 'youtube-subtitles' : route === 'stt' ? 'none' : 'caption-only';
    store.transcripts.upsert({ postId: p.id, text: '', wordCount: 0, wpm: null, provider, costUsd: 0, status: 'none' });
    if (route === 'caption-only') markRole(p.id, 'caption_only');
    res.none++;
  }
  if (audio.length === 0) return res;

  const write = (p: LabPost, text: string, durationS: number | null, costUsd: number, provider: string) => {
    const wc = wordCount(text);
    store.transcripts.upsert({ postId: p.id, text, wordCount: wc, wpm: round1(wpmOf(wc, p.durationS ?? durationS)), provider, costUsd, status: wc > 0 ? 'done' : 'none' });
    markRole(p.id, wc > 0 ? 'transcribed' : 'caption_only');
    if (wc > 0) res.done++;
    else res.none++;
  };
  const fail = (p: LabPost) => {
    store.transcripts.upsert({ postId: p.id, text: '', wordCount: 0, wpm: null, provider: WHISPER_MODEL, costUsd: 0, status: 'failed' });
    markRole(p.id, 'failed');
    res.failed++;
  };

  // owned posts and cases on `stt`; drawn controls on `stt.controls` (04 4.4, 5.2)
  const groups: { line: LabSpendLine; posts: LabPost[] }[] = [
    { line: 'stt', posts: audio.filter((p) => roles.get(p.id)?.role !== 'control') },
    { line: 'stt.controls', posts: audio.filter((p) => roles.get(p.id)?.role === 'control') },
  ];
  for (const g of groups) if (g.posts.length) await runBatch(g.line, g.posts);
  return res;

  // one gated run per line per cycle (the run log stays readable); the cap is checked before the batch
  async function runBatch(line: LabSpendLine, audio: LabPost[]): Promise<void> {
  try {
    await gatedCall<null>(store, { provider: 'stt', line, kind: 'transcribe', actor: WHISPER_MODEL, input: { postIds: audio.map((p) => p.id) }, override: deps.override, scheduled: deps.scheduled, now }, {
      dry: () => {
        for (const p of audio) write(p, dryTranscriptText(p.externalId, p.caption, p.durationS ?? 45), p.durationS, 0, `${WHISPER_MODEL} (dry)`);
        return { result: null, units: audio.reduce((a, p) => a + (p.durationS ?? 0), 0), items: audio.length };
      },
      live: async () => {
        let secs = 0;
        let cost = 0;
        let ok = 0;
        let firstError: string | null = null;
        for (const p of audio) {
          try {
            const media = await deps.stt!.fetchMedia(p.mediaUrl!);
            const r = await deps.stt!.transcribe({ ...media, name: `${p.externalId}.mp4` });
            const d = r.durationS ?? p.durationS ?? 0;
            const c = sttCost(store, d);
            secs += d;
            cost += c;
            ok++;
            write(p, r.text, r.durationS, c, WHISPER_MODEL);
          } catch (err) {
            firstError ??= err instanceof Error ? err.message : String(err);
            fail(p);
          }
        }
        // every file failed: the run failed (nothing was transcribed, so nothing was billed)
        if (ok === 0) throw new Error(`no transcript: ${firstError ?? 'unknown error'}`);
        const usd = Math.round(cost * 10_000) / 10_000;
        return { result: null, units: Math.round(secs), actualUsd: usd, estUsd: usd, items: ok };
      },
    });
  } catch (err) {
    if (err instanceof CapError) res.blocked = err.message;
  }
  }

  function markRole(postId: string, status: LabControl['status']) {
    const c = roles.get(postId);
    if (c && c.status !== 'dissected') store.controls.setStatus(postId, status);
  }
}
