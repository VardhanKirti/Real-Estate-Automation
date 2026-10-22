/**
 * The Wizard / Telegram hook (05 section 15), off by default. The only file this module ever
 * writes is `~/.config/wizard/events/lab-brief-<day>.json` (AC-05-31), atomically, once per day.
 * The switch is env `LAB_BRIEF_TELEGRAM` (08.9 is the only store).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LabMorningBrief } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { localParts } from '@/lib/lab/radar/util';

export const WIZARD_ALIVE_MAX_MS = 10 * 60_000;
export const WIZARD_GIVE_UP_MIN = 10 * 60;

export const wizardDir = (home: string = os.homedir()) => path.join(home, '.config', 'wizard');
export const briefFilePath = (day: string, home: string = os.homedir()) => path.join(wizardDir(home), 'events', `lab-brief-${day}.json`);

/** `~/.config/wizard/alive` exists and its mtime is under 10 minutes old. */
export function wizardAlive(home: string = os.homedir(), now: Date = new Date()): boolean {
  try {
    const st = fs.statSync(path.join(wizardDir(home), 'alive'));
    return now.getTime() - st.mtimeMs < WIZARD_ALIVE_MAX_MS;
  } catch {
    return false;
  }
}

/** `~/.config/wizard/` exists (the Setup switch is disabled without it). */
export function wizardInstalled(home: string = os.homedir()): boolean {
  try {
    return fs.statSync(wizardDir(home)).isDirectory();
  } catch {
    return false;
  }
}

export const telegramOn = (env: Record<string, string | undefined> = process.env): boolean => env.LAB_BRIEF_TELEGRAM === '1';

/** Setup's status line once a brief file was written (15). */
export function wizardReadStatus(day: string, home: string = os.homedir()): string | null {
  if (!fs.existsSync(briefFilePath(day, home))) return null;
  return fs.existsSync(`${briefFilePath(day, home)}.read`) ? null : 'Written for the Wizard. The Wizard does not read Lab briefs yet.';
}

export type SendResult = { sent: boolean; reason: string };

/**
 * 15 steps 1 to 4. Off, dry, Filming or sample: nothing written. Not alive: `send_error` set,
 * retried on later ticks until 10:00 local. Never written twice for one day.
 */
export function sendMorningBriefToWizard(
  store: LabStore | null,
  brief: LabMorningBrief,
  opts: { now: Date; home?: string; env?: Record<string, string | undefined>; dry: boolean; sample?: boolean; tz: string },
): SendResult {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  if (!telegramOn(env)) return { sent: false, reason: 'off' };
  if (opts.sample) return { sent: false, reason: 'sample' };
  if (opts.dry) return { sent: false, reason: 'dry' };
  if (brief.sentAt) return { sent: false, reason: 'already sent' };
  const p = localParts(opts.now, opts.tz);
  if (!wizardAlive(home, opts.now)) {
    const gaveUp = p.hour * 60 + p.minute >= WIZARD_GIVE_UP_MIN;
    store?.morningBrief.upsert({ ...brief, sendError: gaveUp ? 'Wizard not running. Gave up for today.' : 'Wizard not running' });
    return { sent: false, reason: gaveUp ? 'gave up' : 'Wizard not running' };
  }
  const file = briefFilePath(brief.day, home);
  if (fs.existsSync(file)) {
    store?.morningBrief.upsert({ ...brief, sentAt: brief.sentAt ?? opts.now.toISOString(), sentVia: 'wizard', sendError: null });
    return { sent: false, reason: 'already sent' };
  }
  const payload = {
    kind: 'lab_brief',
    day: brief.day,
    composedAt: brief.composedAt,
    text: brief.text,
    items: brief.items.map((i) => ({ kind: i.kind, line: i.line, href: i.href })),
    href: '/lab/radar',
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, file);
  store?.morningBrief.upsert({ ...brief, sentAt: opts.now.toISOString(), sentVia: 'wizard', sendError: null });
  return { sent: true, reason: 'written' };
}
