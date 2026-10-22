/**
 * Frame contact sheet for dissect (07 7.14). Built, off until LAB_FRAMES=1. ffmpeg and ffprobe
 * run through `execFile` with argument arrays (no shell), 60 s per call; the video and the
 * per-frame JPEGs are deleted after tiling and only the sheet is kept at
 * `data/lab/frames/<postId>.jpg`. Instagram video URLs are fetched directly (a CDN GET logged
 * through the `downloads` line at $0); TikTok files come from the scrape actor's paid
 * `video-download` event, only with LAB_TIKTOK_DOWNLOADS=1 and a downloads cap above 0.
 * YouTube is never downloaded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { LabStore } from '@/lib/lab/store';
import { dataDir, dataPath } from '@/lib/paths';
import { readEnvLocal } from '@/lib/creds';
import { gatedCall, lineEnabled } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { labFetch, type FetchFn } from '@/lib/lab/net';
import { priceOf, loadPriceBook, resolveTier } from '@/lib/lab/setup/pricing';

export const FRAMES_PER_CYCLE = 20;
export const FRAMES_MAX_BYTES = 200 * 1024 * 1024;
export const FRAMES_MAX_DURATION_S = 600;
export const FFMPEG_TIMEOUT_MS = 60_000;
export const ROW1 = [0, 0.5, 1.0, 1.5, 2.0, 2.75] as const;
/** 09.1.2 published `video-download` event price on clockworks/tiktok-scraper (per video). */
export const TIKTOK_VIDEO_DOWNLOAD_USD = { FREE: 0.0013, BRONZE: 0.001 } as const;
export const FRAMES_OFF_COPY = 'frames are off';
export const NO_FFMPEG_COPY = 'Frames need ffmpeg on this host.';

type Env = Record<string, string | undefined>;
const liveEnv = (): Env => ({ ...process.env, ...readEnvLocal() });

export const framesOn = (env: Env = liveEnv()): boolean => env.LAB_FRAMES?.trim() === '1';

/** TikTok downloads run only with LAB_TIKTOK_DOWNLOADS=1 and a downloads cap above 0 (C22). */
export function tiktokDownloadsAllowed(opts: { env?: Env; store?: LabStore } = {}): boolean {
  const env = opts.env ?? liveEnv();
  return env.LAB_TIKTOK_DOWNLOADS?.trim() === '1' && lineEnabled('downloads', { env, store: opts.store });
}

/**
 * The per-video price for a TikTok download: LAB_TIKTOK_DOWNLOAD_PRICE_USD when set (optional
 * override), else 09's price book `video-download` event for the account tier, else the
 * published 09.1.2 figure (Free unless the tier is known).
 */
export function tiktokDownloadPrice(store: LabStore | null, env: Env = liveEnv(), now: Date = new Date()): { usd: number; source: 'override' | 'price_book' | 'published' } {
  const o = Number(env.LAB_TIKTOK_DOWNLOAD_PRICE_USD);
  if (env.LAB_TIKTOK_DOWNLOAD_PRICE_USD?.trim() && Number.isFinite(o) && o >= 0) return { usd: o, source: 'override' };
  if (store) {
    const tier = resolveTier(store).tier;
    const ev = loadPriceBook(store, 'clockworks/tiktok-scraper', now).events.find((e) => e.name === 'video-download');
    if (ev) return { usd: priceOf(ev, tier).usd, source: 'price_book' };
    return { usd: tier === 'FREE' ? TIKTOK_VIDEO_DOWNLOAD_USD.FREE : TIKTOK_VIDEO_DOWNLOAD_USD.BRONZE, source: 'published' };
  }
  return { usd: TIKTOK_VIDEO_DOWNLOAD_USD.FREE, source: 'published' };
}

/** 7.14.3 sample times: row 1 is the first 3 s (each clipped to D - 0.05); row 2 spreads 6 over the rest when D > 3.5. */
export function frameTimes(durationS: number): { row1: number[]; row2: number[] } {
  const clip = Math.max(0, durationS - 0.05);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const row1 = ROW1.map((t) => r(Math.min(t, clip)));
  const row2 = durationS > 3.5 ? Array.from({ length: 6 }, (_, k) => r(3 + ((k + 0.5) * (durationS - 3)) / 6)) : [];
  return { row1, row2 };
}

/** Stored relative path (`data/lab/frames/<id>.jpg`) for a post's sheet. */
export const sheetRelPath = (postId: string) => `data/lab/frames/${postId.replace(/[^A-Za-z0-9._-]/g, '_')}.jpg`;

/** Absolute path of a stored sheet path, inside the data directory in force. */
export function resolveSheet(rel: string): string {
  const parts = rel.replace(/^data\//, '').split('/');
  return path.join(dataDir(), ...parts);
}

export function sheetExists(store: LabStore, postId: string): string | null {
  const rel = store.dissections.get(postId)?.sheetPath ?? sheetRelPath(postId);
  const abs = resolveSheet(rel);
  return fs.existsSync(abs) ? abs : null;
}

export type ExecLike = (file: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecLike = async (file, args, opts) => {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) })));
  });
};

export async function ffmpegAvailable(exec: ExecLike = defaultExec): Promise<boolean> {
  try {
    await exec('ffmpeg', ['-version'], { timeout: 10_000 });
    await exec('ffprobe', ['-version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe, extract, tile (7.14.3). Deletes the input video and every per-frame JPEG afterwards
 * (only the sheet stays). Throws on an ffmpeg failure, a file over 200 MB, or one over 600 s.
 */
export async function buildContactSheet(input: { videoPath: string; outPath: string; exec?: ExecLike; keepVideo?: boolean }): Promise<{ sheetPath: string; frames: number; durationS: number }> {
  const exec = input.exec ?? defaultExec;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-frames-'));
  try {
    const size = fs.statSync(input.videoPath).size;
    if (size > FRAMES_MAX_BYTES) throw new Error('skipped: too large');
    const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input.videoPath], { timeout: FFMPEG_TIMEOUT_MS });
    const d = Number(probe.stdout.trim());
    if (!Number.isFinite(d) || d <= 0) throw new Error('could not read the video duration');
    if (d > FRAMES_MAX_DURATION_S) throw new Error('skipped: too large');
    const { row1, row2 } = frameTimes(d);
    const times = [...row1, ...row2];
    const frame = (i: number) => path.join(tmp, `f${String(i + 1).padStart(2, '0')}.jpg`);
    for (let i = 0; i < times.length; i++) {
      try {
        await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-ss', String(times[i]), '-i', input.videoPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', frame(i)], { timeout: FFMPEG_TIMEOUT_MS });
        if (!fs.existsSync(frame(i))) throw new Error('no frame');
      } catch (e) {
        // a seek past the last decodable frame (a clip's final 0.05 s at a low frame rate) yields
        // nothing: repeat the previous frame so the tile stays in order; a failing first frame is fatal
        if (i === 0) throw e;
        fs.copyFileSync(frame(i - 1), frame(i));
      }
    }
    const rows = row2.length ? 2 : 1;
    fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-start_number', '1', '-i', path.join(tmp, 'f%02d.jpg'), '-filter_complex', `scale=320:568:force_original_aspect_ratio=decrease,pad=320:568:(ow-iw)/2:(oh-ih)/2,tile=6x${rows}:padding=4:margin=4`, '-frames:v', '1', '-q:v', '4', input.outPath], { timeout: FFMPEG_TIMEOUT_MS });
    return { sheetPath: input.outPath, frames: times.length, durationS: d };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!input.keepVideo) fs.rmSync(input.videoPath, { force: true });
  }
}

/** Owned posts, then tracked breakouts or duds used in grounding, with no sheet yet; at most 20. YouTube is never downloaded. */
export function selectForFrames(store: LabStore, limit = FRAMES_PER_CYCLE): string[] {
  const used = new Set(store.ideas.all().flatMap((i) => [...(i.grounding?.exemplars ?? []), ...(i.grounding?.duds ?? [])].map((r) => r.postId)));
  const ok = (p: { platform: string; durationS: number | null }) => (p.platform === 'instagram' || p.platform === 'tiktok') && (p.durationS === null || p.durationS <= FRAMES_MAX_DURATION_S);
  const posts = store.posts.all().filter((p) => ok(p) && !sheetExists(store, p.id));
  const newest = (a: { postedAt: string | null }, b: { postedAt: string | null }) => (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
  const owned = posts.filter((p) => p.isOwned).sort(newest);
  const tracked = posts.filter((p) => !p.isOwned && (store.measures.get(p.id)?.isBreakout || used.has(p.id))).sort(newest);
  return [...owned, ...tracked].slice(0, limit).map((p) => p.id);
}

/**
 * Build one post's sheet (POST /api/lab/frames {action:'build'}). Instagram: a direct GET of the
 * item's video URL, logged on the `downloads` line at $0. TikTok: only a file the scrape already
 * downloaded (`videoPath`). Records sheet_path on the dissection when there is one.
 */
export async function buildFramesFor(store: LabStore, postId: string, opts: { override?: boolean; now?: Date; exec?: ExecLike; fetch?: FetchFn; videoPath?: string | null } = {}): Promise<{ sheetPath: string }> {
  if (!framesOn()) throw new Error(FRAMES_OFF_COPY);
  const post = store.posts.get(postId);
  if (!post) throw new Error('no such post');
  if (post.platform === 'youtube') throw new Error('YouTube videos are never downloaded.');
  const rel = sheetRelPath(postId);
  const out = resolveSheet(rel);
  let video = opts.videoPath ?? null;
  if (!video) {
    if (post.platform !== 'instagram' || !post.mediaUrl) throw new Error(post.platform === 'tiktok' ? 'No downloaded TikTok file for this post. Downloads need LAB_TIKTOK_DOWNLOADS=1 and a downloads cap.' : 'No video URL for this post.');
    const tmp = path.join(os.tmpdir(), `lab-video-${createHash('sha1').update(postId).digest('hex').slice(0, 10)}.mp4`);
    const f = opts.fetch ?? labFetch;
    const fetchVideo = async () => {
      const res = await f(post.mediaUrl!);
      if (!res.ok) throw new Error(`video fetch answered ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > FRAMES_MAX_BYTES) throw new Error('skipped: too large');
      fs.writeFileSync(tmp, buf);
    };
    if (lineEnabled('downloads', { store })) {
      await gatedCall(store, { provider: 'downloads', line: 'downloads', kind: 'frames', actor: 'instagram-cdn', input: { postId }, override: opts.override, now: opts.now, reserve: false }, {
        dry: () => ({ result: null }),
        live: async () => {
          await fetchVideo();
          return { result: null, units: 1, actualUsd: 0, actualSource: 'published_price', items: 1 };
        },
      });
    } else if (!isDry()) {
      // An Instagram CDN GET costs nothing, so a downloads line that is off (cap 0) does not stop it;
      // it is still logged as a frames run with no spend row (08's gate would refuse an off line).
      const at = (opts.now ?? new Date()).toISOString();
      const id = `lrun-${createHash('sha1').update(`${postId}:${at}`).digest('hex').slice(0, 12)}`;
      store.runs.insert({ id, kind: 'frames', apifyRunId: null, datasetId: null, actor: 'instagram-cdn', input: { postId }, status: 'running', items: null, costUsd: 0, dry: false, startedAt: at, finishedAt: null, error: null, line: 'downloads', job: null, scheduled: false, batchId: null, progress: null });
      try {
        await fetchVideo();
        store.runs.update(id, { status: 'succeeded', items: 1, finishedAt: new Date().toISOString() });
      } catch (e) {
        store.runs.update(id, { status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() });
        throw e;
      }
    }
    if (!fs.existsSync(tmp)) throw new Error('Dry run: no video was fetched.');
    video = tmp;
  }
  await buildContactSheet({ videoPath: video, outPath: out, exec: opts.exec });
  const d = store.dissections.get(postId);
  if (d) store.dissections.upsert({ ...d, sheetPath: rel });
  return { sheetPath: rel };
}

/* ── an in-memory contact sheet for the sample and FounderOS fixture worlds (no image file) ── */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * A deterministic grey contact sheet PNG (6 x 2 tiles, 9:16, padding 4) for a fixture post:
 * a placeholder shape that says what the real sheet looks like, never a real frame.
 */
export function fixtureSheetPng(postId: string): Buffer {
  const tw = 54;
  const th = 96;
  const pad = 4;
  const w = 6 * tw + 7 * pad;
  const h = 2 * th + 3 * pad;
  const seed = createHash('sha256').update(postId).digest();
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const col = Math.floor((x - pad) / (tw + pad));
      const row = Math.floor((y - pad) / (th + pad));
      const inX = x >= pad && (x - pad) % (tw + pad) < tw && col < 6;
      const inY = y >= pad && (y - pad) % (th + pad) < th && row < 2;
      let v = 28;
      if (inX && inY) {
        const k = row * 6 + col;
        const base = 70 + (seed[k] % 60);
        const ly = (y - pad) % (th + pad);
        v = ly > th * 0.72 && ly < th * 0.8 ? base + 60 : base;
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = v;
      raw[o + 1] = v;
      raw[o + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Where the sheets live (for the route and tests). */
export const framesDir = () => dataPath('lab', 'frames');
