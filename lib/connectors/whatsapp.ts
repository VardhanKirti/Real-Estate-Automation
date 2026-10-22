import fs from 'node:fs';
import { BRAND } from '@/lib/brand';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { CommsItem } from '@/lib/comms';
import { runtimeEnv } from '@/lib/creds';
import { TTL, keyTag, swr } from '@/lib/swr';

// WhatsApp ships two separate macOS apps, each with its own group container:
// the consumer app and WhatsApp Business (SMB). the operator switched to Business,
// so we look in both and read whichever database is actually live.
const WHATSAPP_CONTAINERS = [
  'group.net.whatsapp.WhatsApp.shared', // consumer
  'group.net.whatsapp.WhatsAppSMB.shared', // Business
];

/** Candidate ChatStorage.sqlite paths, one per known WhatsApp container. */
export function whatsappContainerPaths(): string[] {
  return WHATSAPP_CONTAINERS.map((container) =>
    path.join(os.homedir(), 'Library', 'Group Containers', container, 'ChatStorage.sqlite'),
  );
}

/**
 * Pick the WhatsApp database to read: of the candidate paths that exist, the
 * most recently modified one — i.e. the app you're actually using (consumer or
 * Business). Null when none are present. Injectable for tests.
 * (Only touches metadata, which macOS allows without Full Disk Access.)
 */
export function resolveChatDb(paths: string[] = whatsappContainerPaths()): string | null {
  const existing = paths.filter((p) => fs.existsSync(p));
  if (existing.length === 0) return null;
  return existing.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const CORE_DATA_EPOCH_MS = Date.parse('2001-01-01T00:00:00.000Z');

/**
 * WhatsApp's ZLASTMESSAGEDATE unit differs across app builds (seconds,
 * sub-second ticks…). Rather than hardcode a unit, calibrate: the largest
 * raw value in an actively-used database is "approximately now", so
 * scale = maxRaw / secondsSince2001(now), and every row maps through it.
 */
export function calibratedDate(raw: number, maxRaw: number, nowMs = Date.now()): Date {
  const elapsedSeconds = (nowMs - CORE_DATA_EPOCH_MS) / 1000;
  const scale = maxRaw > 0 ? maxRaw / elapsedSeconds : 1;
  const seconds = raw > 0 ? raw / scale : 0;
  return new Date(CORE_DATA_EPOCH_MS + seconds * 1000);
}

type ChatRow = {
  ZPARTNERNAME: string | null;
  ZCONTACTJID: string | null;
  ZLASTMESSAGEDATE: number | null;
  ZUNREADCOUNT: number | null;
  lastText: string | null;
  lastDate: number | null;
};

/**
 * WhatsApp caches every avatar it has rendered next to the chat database, as
 * `Media/Profile/<jid-number>-<hash>.jpg|.thumb` (640px and 96px, both JPEG).
 * That is the only place a profile picture can come from: Meta's Cloud API has
 * no endpoint for a contact's photo, so reading this cache is the whole
 * feature. Nothing is downloaded and nothing is written.
 */
export function profileDirFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'Media', 'Profile');
}

const JID_KEY_RE = /^[0-9]{5,25}$/;

/** The numeric key in "<digits>@lid" / "@g.us" / "@s.whatsapp.net", or null. */
export function jidKey(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const head = String(jid).split('@')[0];
  return JID_KEY_RE.test(head) ? head : null;
}

/** Index cached avatars by JID key, preferring the 640px .jpg over the .thumb. */
export function indexAvatars(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return map; // no cache yet, or no permission — every chat falls back to initials
  }
  for (const name of names) {
    const key = name.split('-')[0];
    if (!JID_KEY_RE.test(key)) continue;
    const held = map.get(key);
    if (!held || (name.endsWith('.jpg') && !held.endsWith('.jpg'))) map.set(key, name);
  }
  return map;
}

let avatarCache: { at: number; dir: string; map: Map<string, string> } | null = null;
const AVATAR_TTL_MS = 300_000;

function avatarMap(): { dir: string; map: Map<string, string> } | null {
  const dbPath = resolveChatDb();
  if (!dbPath) return null;
  const dir = profileDirFor(dbPath);
  const now = Date.now();
  if (!avatarCache || avatarCache.dir !== dir || now - avatarCache.at > AVATAR_TTL_MS) {
    avatarCache = { at: now, dir, map: indexAvatars(dir) };
  }
  return { dir, map: avatarCache.map };
}

/** Absolute path to a chat's cached avatar, or null when none is cached. */
export function avatarPathFor(jid: string): string | null {
  const key = jidKey(jid);
  const held = key ? avatarMap() : null;
  if (!key || !held) return null;
  const name = held.map.get(key);
  return name ? path.join(held.dir, name) : null;
}

// The DB read runs in a short-lived child `node -e` process, NOT inline. Reading
// WhatsApp's live DB blocks hard when macOS withholds Full Disk Access (even a
// raw byte read hangs) — and better-sqlite3 is synchronous, so an inline read
// would freeze the whole server's event loop. A child process can be SIGKILLed
// on timeout, so a blocked/locked/permission-walled read degrades to an honest
// status instead of hanging /comms and the pulse row. better-sqlite3 resolves
// from the project's node_modules (child inherits cwd).
const READ_CODE = `
const Database = require('better-sqlite3');
const dbPath = process.argv[1], mode = process.argv[2], limit = parseInt(process.argv[3] || '15', 10);
try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 2000');
  let out;
  if (mode === 'status') {
    const chats = db.prepare('SELECT COUNT(*) AS n FROM ZWACHATSESSION').get().n;
    const unread = db.prepare('SELECT COALESCE(SUM(ZUNREADCOUNT),0) AS n FROM ZWACHATSESSION WHERE ZUNREADCOUNT>0').get().n;
    const chatsUnread = db.prepare('SELECT COUNT(*) AS n FROM ZWACHATSESSION WHERE ZUNREADCOUNT>0').get().n;
    out = { ok: true, chats, unread, chatsUnread };
  } else if (mode === 'stats') {
    // Trailing 7 days vs the 7 before it. ZMESSAGEDATE is Core Data seconds
    // (epoch 2001-01-01) — the same unit recentChats reads for lastDate.
    const nowMs = parseInt(process.argv[4] || '0', 10) || Date.now();
    const nowS = (nowMs - Date.parse('2001-01-01T00:00:00.000Z')) / 1000;
    const week = 7 * 86400;
    const row = db.prepare('SELECT COALESCE(SUM(CASE WHEN ZMESSAGEDATE >= ? THEN 1 ELSE 0 END),0) AS thisWeek, COALESCE(SUM(CASE WHEN ZMESSAGEDATE >= ? AND ZMESSAGEDATE < ? THEN 1 ELSE 0 END),0) AS lastWeek FROM ZWAMESSAGE WHERE ZMESSAGEDATE >= ?').get(nowS - week, nowS - 2 * week, nowS - week, nowS - 2 * week);
    out = { ok: true, thisWeek: row.thisWeek, lastWeek: row.lastWeek };
  } else if (mode === 'thread') {
    // One chat's real history, newest last, with any media the app has on disk.
    // ZMEDIALOCALPATH is relative to the container's Message/ directory.
    const jid = process.argv[5] || '';
    const rows = db.prepare('SELECT m.ZISFROMME AS fromMe, m.ZTEXT AS text, m.ZMESSAGEDATE AS date, m.ZMESSAGETYPE AS type, m.ZPUSHNAME AS pushName, mi.ZMEDIALOCALPATH AS media, mi.ZMOVIEDURATION AS duration, mi.ZFILESIZE AS size, mi.ZTITLE AS title FROM ZWAMESSAGE m LEFT JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK JOIN ZWACHATSESSION s ON m.ZCHATSESSION = s.Z_PK WHERE s.ZCONTACTJID = ? ORDER BY m.ZMESSAGEDATE DESC LIMIT ?').all(jid, limit);
    out = { ok: true, rows: rows.reverse() };
  } else {
    const maxRaw = db.prepare('SELECT COALESCE(MAX(ZLASTMESSAGEDATE),0) AS m FROM ZWACHATSESSION').get().m;
    const rows = db.prepare('SELECT s.ZPARTNERNAME, s.ZCONTACTJID, s.ZLASTMESSAGEDATE, s.ZUNREADCOUNT, (SELECT m.ZTEXT FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK AND m.ZTEXT IS NOT NULL ORDER BY m.ZMESSAGEDATE DESC LIMIT 1) AS lastText, (SELECT MAX(m.ZMESSAGEDATE) FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK) AS lastDate FROM ZWACHATSESSION s WHERE s.ZPARTNERNAME IS NOT NULL AND (s.ZARCHIVED IS NULL OR s.ZARCHIVED = 0) ORDER BY s.ZLASTMESSAGEDATE DESC LIMIT ?').all(limit);
    out = { ok: true, rows, maxRaw };
  }
  db.close();
  process.stdout.write(JSON.stringify(out));
} catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); }
`;

const READ_TIMEOUT_MS = 5000;
// The week-over-week counts scan ZWAMESSAGE rather than the chat list, so they
// get their own budget — still hard-capped, still SIGKILLed, never unbounded.
const STATS_TIMEOUT_MS = 12_000;

type StatusRead = { ok: true; chats: number; unread: number; chatsUnread: number };
type RecentRead = { ok: true; rows: ChatRow[]; maxRaw: number };
type StatsRead = { ok: true; thisWeek: number; lastWeek: number };
type ThreadRow = {
  fromMe: number | null;
  text: string | null;
  date: number | null;
  type: number | null;
  pushName: string | null;
  media: string | null;
  duration: number | null;
  size: number | null;
  title: string | null;
};
type ThreadRead = { ok: true; rows: ThreadRow[] };
type ReadFail = { ok: false; error: string; timedOut?: boolean };

/** Read the WhatsApp DB in a child process, hard-capped by timeout. A hung read
    (no Full Disk Access) is SIGKILLed and reported, never awaited forever. */
function boundedRead(dbPath: string, mode: 'status'): Promise<StatusRead | ReadFail>;
function boundedRead(dbPath: string, mode: 'recent', limit: number): Promise<RecentRead | ReadFail>;
function boundedRead(dbPath: string, mode: 'stats', limit: number, nowMs: number): Promise<StatsRead | ReadFail>;
function boundedRead(dbPath: string, mode: 'thread', limit: number, nowMs: number, jid: string): Promise<ThreadRead | ReadFail>;
function boundedRead(
  dbPath: string,
  mode: 'status' | 'recent' | 'stats' | 'thread',
  limit = 15,
  nowMs = Date.now(),
  jid = '',
): Promise<StatusRead | RecentRead | StatsRead | ThreadRead | ReadFail> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['-e', READ_CODE, dbPath, mode, String(limit), String(nowMs), jid],
      {
        timeout: mode === 'stats' ? STATS_TIMEOUT_MS : READ_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals }) | null;
        if (e && (e.killed || e.signal === 'SIGKILL')) {
          return resolve({ ok: false, error: 'read timed out', timedOut: true });
        }
        if (e && !stdout) return resolve({ ok: false, error: e.message });
        try {
          resolve(JSON.parse(stdout) as StatusRead | RecentRead | StatsRead | ThreadRead | ReadFail);
        } catch {
          resolve({ ok: false, error: 'unparseable read output' });
        }
      },
    );
  });
}

const FDA_HINT =
  `grant Full Disk Access to the app running ${BRAND.name} in System Settings > Privacy & Security > Full Disk Access, then restart the dev server`;

let statusCache: { at: number; status: ConnectorStatus } | null = null;
const STATUS_TTL_MS = 60_000;

export async function whatsappStatus(): Promise<ConnectorStatus> {
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.status;

  const base = { id: 'whatsapp', name: 'WhatsApp', kind: 'social' as const };
  const dbPath = resolveChatDb();
  let status: ConnectorStatus;

  if (!dbPath) {
    status = {
      ...base,
      configHref: '/integrations/whatsapp',
      state: 'not_configured',
      detail: 'ChatStorage.sqlite not found. Is the WhatsApp (or WhatsApp Business) desktop app installed and signed in?',
    };
  } else {
    const read = await boundedRead(dbPath, 'status');
    if (read.ok) {
      const minutesAgo = Math.max(0, Math.round((now - fs.statSync(dbPath).mtime.getTime()) / 60_000));
      const canSend = sendConfigured();
      status = {
        ...base,
        // Reading works, so the connector is live — but the headline says what
        // is missing, because "connected" on its own reads as "I can reply".
        state: 'connected',
        detail: canSend
          ? `${read.chats} chats · ${read.unread} unread · reading locally, sending via Business API`
          : `${read.chats} chats · ${read.unread} unread · reading only — sending not set up`,
        meta: { chats: read.chats, unread: read.unread, source: dbPath.includes('SMB') ? 'business' : 'consumer' },
        configHref: '/integrations/whatsapp',
        capabilities: [
          {
            id: 'read',
            label: 'Reading',
            state: 'connected',
            detail: `The desktop app on this Mac, read-only. ${read.chats} chats, ${read.unread} unread, last activity ${minutesAgo}m ago.`,
          },
          {
            id: 'send',
            label: 'Sending',
            state: canSend ? 'connected' : 'not_configured',
            detail: canSend
              ? 'A WhatsApp Business number is connected. Replies go out through the Cloud API.'
              : `The local store cannot send. Connect a WhatsApp Business number to reply from ${BRAND.name}.`,
            setupHref: '/integrations/whatsapp',
          },
        ],
      };
    } else if (read.timedOut) {
      status = {
        ...base,
        state: 'error',
        detail: `ChatStorage.sqlite found but the read timed out. Likely permissions: ${FDA_HINT}.`,
      };
    } else {
      status = { ...base, state: 'error', detail: `ChatStorage.sqlite exists but read failed: ${read.error}` };
    }
  }

  statusCache = { at: now, status };
  return status;
}

/** Rows one cached chat-list read holds; every caller slices its own limit from it. */
export const WHATSAPP_RECENT_ROWS = 200;
/** The SWR key for the chat list read (lib/swr.ts); one per database file. */
export const whatsappRecentKey = (dbPath: string) => `whatsapp:recent:${keyTag(dbPath)}`;

/**
 * The newest chats, for the comms feed (Home, Comms, /api/comms). The desktop
 * database is read in a child process (up to 5 s), so the read sits behind the
 * SWR cache (TTL.comms: 30 s fresh, then served stale while one refresh runs)
 * and lib/warm.ts runs it at boot. Only a real read is cached: no database
 * returns [] with no entry, and a failed or timed-out read throws inside the
 * cache (never stored) and degrades to [] here, so the feed never hangs and
 * never shows an invented empty list as if it were the live one.
 */
export async function recentChats(limit = 15, paths?: string[]): Promise<CommsItem[]> {
  const dbPath = resolveChatDb(paths);
  if (!dbPath) return [];
  try {
    const all = await swr(whatsappRecentKey(dbPath), TTL.comms, () => readRecentChats(dbPath, WHATSAPP_RECENT_ROWS));
    return all.slice(0, Math.max(0, Math.min(limit, WHATSAPP_RECENT_ROWS)));
  } catch {
    return []; // timed out / locked / no access: degrade quietly, never hang the feed
  }
}

async function readRecentChats(dbPath: string, limit: number): Promise<CommsItem[]> {
  const read = await boundedRead(dbPath, 'recent', limit);
  if (!read.ok) throw new Error(read.error);
  const { rows, maxRaw } = read;
  const avatars = avatarMap();
  return rows.map((row) => {
    const key = jidKey(row.ZCONTACTJID);
    const hasAvatar = !!(key && avatars?.map.has(key));
    return {
      source: 'whatsapp' as const,
      title: row.ZPARTNERNAME ?? 'Unknown chat',
      sender: row.ZPARTNERNAME ?? 'Unknown chat',
      preview: (row.lastText ?? '').slice(0, 140),
      ts:
        row.lastDate && row.lastDate > 0
          ? new Date(CORE_DATA_EPOCH_MS + row.lastDate * 1000).toISOString()
          : calibratedDate(row.ZLASTMESSAGEDATE ?? 0, maxRaw).toISOString(),
      unread: row.ZUNREADCOUNT ?? 0,
      jid: row.ZCONTACTJID ?? undefined,
      // Only ever set when an image is actually cached — a missing photo shows
      // initials, never a silhouette implying a picture exists.
      avatarUrl: hasAvatar ? `/api/whatsapp/avatar/${key}` : undefined,
    };
  });
}

/** Media lives beside the database, under Message/, at the relative path the
    row stores. Only what the app has actually downloaded exists on disk. */
export function mediaRootFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'Message');
}

export type MediaKind = 'image' | 'video' | 'gif' | 'voice' | 'document';

/**
 * What a media file is. The extension is the reliable signal — WhatsApp's
 * ZMESSAGETYPE distinguishes an animation (11) from a plain video (2) but both
 * are .mp4 on disk, so the type only breaks that one tie.
 */
export function mediaKind(relPath: string, type: number | null): MediaKind {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.opus' || ext === '.caf' || ext === '.m4a' || ext === '.ogg') return 'voice';
  if (ext === '.mp4' || ext === '.mov') return type === 11 ? 'gif' : 'video';
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') return 'image';
  return 'document';
}

export type ThreadMedia = {
  kind: MediaKind;
  url: string;
  name: string;
  /** Seconds, for voice notes and video. */
  duration?: number;
  bytes?: number;
};

/**
 * ZPUSHNAME is usually the sender's display name, but in group rows it often
 * holds an opaque encoded token instead ("CLOgsdUGIABIAZ"). Showing that as a
 * person's name is worse than showing nothing, so anything that does not read
 * like a name is dropped and the chat title stands in.
 */
export function displayName(raw: string | null | undefined): string | undefined {
  const name = (raw ?? '').trim();
  if (!name || name.length > 40) return undefined;
  if (!/[A-Za-z]/.test(name)) return undefined;
  // Opaque tokens are one long unseparated word that keeps switching case
  // ("CLOgsdUGIABIAZ"), or carries digits. A real long name has one capital
  // ("Christopher"); an all-caps group name has no lowercase to mix with.
  const oneWord = !/[\s._-]/.test(name);
  if (!oneWord || name.length < 10) return name;
  const capitals = (name.match(/[A-Z]/g) ?? []).length;
  const mixed = capitals >= 3 && /[a-z]/.test(name);
  if (mixed || /\d/.test(name)) return undefined;
  return name;
}

export type HistoryMessage = {
  from: 'them' | 'me';
  text: string;
  ts: string;
  author?: string;
  media?: ThreadMedia;
};

/**
 * One chat's real history. Until this existed the reader showed a single
 * synthetic message built from the feed preview, so every conversation looked
 * one line long. Returns oldest-first, media included where the file is
 * actually on disk.
 */
export async function threadHistory(jid: string, limit = 60): Promise<HistoryMessage[]> {
  const dbPath = resolveChatDb();
  if (!dbPath || !jidKey(jid)) return [];
  const read = await boundedRead(dbPath, 'thread', Math.max(1, Math.min(limit, 300)), Date.now(), jid);
  if (!read.ok) return [];
  const root = mediaRootFor(dbPath);
  const out: HistoryMessage[] = [];
  for (const row of read.rows) {
    const ts = row.date && row.date > 0 ? new Date(CORE_DATA_EPOCH_MS + row.date * 1000).toISOString() : null;
    if (!ts) continue;
    let media: ThreadMedia | undefined;
    if (row.media) {
      const rel = String(row.media).replace(/^\/+/, '');
      // Skip anything the app has not downloaded — an entry can outlive its file.
      if (!rel.includes('..') && fs.existsSync(path.join(root, rel))) {
        media = {
          kind: mediaKind(rel, row.type),
          url: `/api/whatsapp/media?f=${encodeURIComponent(rel)}`,
          name: row.title || path.basename(rel),
          duration: row.duration && row.duration > 0 ? row.duration : undefined,
          bytes: row.size && row.size > 0 ? row.size : undefined,
        };
      }
    }
    const text = (row.text ?? '').trim();
    if (!text && !media) continue; // system rows carry neither
    out.push({
      from: row.fromMe ? 'me' : 'them',
      text,
      ts,
      author: displayName(row.pushName),
      media,
    });
  }
  return out;
}

export type WeeklyMessages = { thisWeek: number; lastWeek: number };

let weeklyCache: { at: number; value: WeeklyMessages | null } | null = null;
const WEEKLY_TTL_MS = 300_000;

/**
 * Real message volume for the trailing 7 days and the 7 before it. This is the
 * only week-over-week comparison the system can make honestly — nothing else
 * is snapshotted over time — so it is the only widget that carries a delta.
 * Null when the database cannot be read; the widget then shows no comparison.
 */
export async function weeklyMessages(now: Date = new Date()): Promise<WeeklyMessages | null> {
  const at = Date.now();
  if (weeklyCache && at - weeklyCache.at < WEEKLY_TTL_MS) return weeklyCache.value;
  const dbPath = resolveChatDb();
  let value: WeeklyMessages | null = null;
  if (dbPath) {
    const read = await boundedRead(dbPath, 'stats', 0, now.getTime());
    if (read.ok) value = { thisWeek: read.thisWeek, lastWeek: read.lastWeek };
  }
  weeklyCache = { at, value };
  return value;
}

/** Unread across every chat, not just the ones the feed pulled. Null when unreadable. */
export async function unreadTotals(): Promise<{ unread: number; chats: number } | null> {
  const dbPath = resolveChatDb();
  if (!dbPath) return null;
  const read = await boundedRead(dbPath, 'status');
  return read.ok ? { unread: read.unread, chats: read.chatsUnread } : null;
}

/**
 * Whether a WhatsApp Business number is connected for sending. Kept here (a
 * plain env check, no network) so the read connector can report an honest
 * split state without importing the send module's transport.
 */
export function sendConfigured(): boolean {
  const env = runtimeEnv();
  return !!(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
}
