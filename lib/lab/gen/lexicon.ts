/**
 * Hook concreteness (07 7.6.1). The Brysbaert, Warriner and Kuperman (2014) lexicon is never
 * committed: its licence is unconfirmed and the repo is published, so it is fetched once at
 * setup into the data directory, pinned by SHA-256, and loaded from there. A missing or
 * altered file means "not installed" (the rule turns into an info line), never a guess.
 *
 * `concreteness` is pure and deterministic (the 7.6.1 algorithm, steps 1 to 6).
 * `fitConcretenessBand` adopts Brody's own band per format family only when n >= 30 and the
 * best tercile's interval clears the worst tercile's (7.6.1 "Brody's fitted band").
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LabStore } from '@/lib/lab/store';
import { dataPath } from '@/lib/paths';
import { labFetch, type FetchFn } from '@/lib/lab/net';
import { medianInterval } from '@/lib/lab/measures';

export const LEXICON_URL = 'https://huggingface.co/datasets/LookingtoLearn/Concreteness-Ratings/resolve/090870f1dcf214d48c78999f85ca358533d38e89/ratings.csv';
/** computed 2026-10-11, file of 39,954 lines incl. header, UTF-8 with BOM */
export const LEXICON_SHA256 = '709fd5ee13da7a6b81e113b6b342d11fad8337cb7453789c7c6fd0681c75daf5';
/** Relative to the data directory in force (`data/` on a real install, never published). */
export const LEXICON_PATH = 'data/lab/lexicon/concreteness.csv';
export const LEXICON_CITATION = 'Brysbaert, Warriner and Kuperman (2014), Behavior Research Methods 46, 904 to 911';
/** 7.6.1 niche prior: Upworthy headlines, concrete wins below 2.58, loses above 3.06. */
export const NICHE_PRIOR_BAND: readonly [number, number] = [2.58, 3.06];
export const BAND_MIN_N = 30;

export type Lexicon = { words: Map<string, number>; bigrams: Map<string, number> };

/** Absolute path of the installed lexicon (LEXICON_PATH inside the current data dir). */
export function lexiconFile(): string {
  return dataPath(...LEXICON_PATH.split('/').slice(1));
}

/** RFC 4180 lite: quoted fields with doubled quotes, commas inside quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Step 1: strip the BOM, key = Word lower-cased, value = Conc.M; Bigram = 1 rows go to `bigrams`. */
export function parseLexicon(text: string): Lexicon {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0] ?? '').map((h) => h.trim());
  const wi = header.indexOf('Word');
  const bi = header.indexOf('Bigram');
  const ci = header.indexOf('Conc.M');
  const words = new Map<string, number>();
  const bigrams = new Map<string, number>();
  if (wi < 0 || ci < 0) return { words, bigrams };
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const w = (f[wi] ?? '').trim().toLowerCase();
    const v = Number(f[ci]);
    if (!w || !Number.isFinite(v)) continue;
    if (bi >= 0 && (f[bi] ?? '').trim() === '1') bigrams.set(w, v);
    else words.set(w, v);
  }
  return { words, bigrams };
}

export const sha256Hex = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

let cache: { file: string; mtime: number; sha: string; lex: Lexicon } | null = null;

/** null when the file is missing or its hash differs from the pinned one. */
export function loadLexicon(file: string = lexiconFile(), opts: { sha256?: string } = {}): Lexicon | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const want = opts.sha256 ?? LEXICON_SHA256;
  if (cache && cache.file === file && cache.mtime === stat.mtimeMs && cache.sha === want) return cache.lex;
  const buf = fs.readFileSync(file);
  if (sha256Hex(buf) !== want) return null;
  const lex = parseLexicon(buf.toString('utf8'));
  cache = { file, mtime: stat.mtimeMs, sha: want, lex };
  return lex;
}

export function lexiconInstalled(file: string = lexiconFile()): boolean {
  return loadLexicon(file) !== null;
}

/**
 * Download, verify the hash, write atomically (temp file then rename). A mismatch writes
 * nothing at the target and removes the temp file. Dry: labFetch refuses the host, so the
 * answer is an honest error and nothing is written.
 */
export async function fetchLexicon(opts: { fetch?: FetchFn; file?: string; url?: string; sha256?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = opts.file ?? lexiconFile();
  const f: FetchFn = opts.fetch ?? labFetch;
  let buf: Buffer;
  try {
    const res = await f(opts.url ?? LEXICON_URL);
    if (!res.ok) return { ok: false, error: `The lexicon download answered ${res.status}.` };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (sha256Hex(buf) !== (opts.sha256 ?? LEXICON_SHA256)) return { ok: false, error: 'The downloaded file does not match the pinned version.' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* gone */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  cache = null;
  return { ok: true };
}

const NUMBER = /^[$]?[\d.,]+[%kKmM]?$/;
const STRIP = /^[.,!?:;"'()“”‘’]+|[.,!?:;"'()“”‘’]+$/g;

/** Step 2: split on whitespace, strip leading and trailing punctuation, keep $, % and digits. */
export function hookTokens(hook: string): { token: string; sentenceStart: boolean }[] {
  const out: { token: string; sentenceStart: boolean }[] = [];
  let start = true;
  for (const raw of hook.split(/\s+/)) {
    if (!raw) continue;
    const token = raw.replace(STRIP, '');
    if (token) out.push({ token, sentenceStart: start });
    start = /[.!?]["'”’)]*$/.test(raw);
  }
  return out;
}

/** Step 5: the token, then -ies to -y, strip -es, strip -s, strip -ed, -ed to -e, strip -ing, -ing to -e. First hit wins. */
export function lookupWord(word: string, words: ReadonlyMap<string, number>): number | null {
  const w = word.toLowerCase();
  const tries = [w];
  if (w.endsWith('ies')) tries.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) tries.push(w.slice(0, -2));
  if (w.endsWith('s')) tries.push(w.slice(0, -1));
  if (w.endsWith('ed')) tries.push(w.slice(0, -2), `${w.slice(0, -2)}e`);
  if (w.endsWith('ing')) tries.push(w.slice(0, -3), `${w.slice(0, -3)}e`);
  for (const t of tries) {
    const v = words.get(t);
    if (v !== undefined) return v;
  }
  return null;
}

/** True when step 4 scores the token 5.0 (a number or a named entity). */
export function isReferent(token: string, sentenceStart: boolean, lex: Lexicon, entities?: ReadonlySet<string>): boolean {
  if (NUMBER.test(token) && /\d/.test(token)) return true;
  const lower = token.toLowerCase();
  if (entities?.has(lower)) return true;
  return /^[A-Z]/.test(token) && !sentenceStart && token !== 'I' && !lex.words.has(lower);
}

export function concreteness(hook: string, lex: Lexicon, entities?: ReadonlySet<string>): { score: number | null; scored: number; tokens: number; perToken: { token: string; value: number | null }[] } {
  const toks = hookTokens(hook);
  const perToken: { token: string; value: number | null }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const { token, sentenceStart } = toks[i];
    const next = toks[i + 1];
    if (next) {
      const pair = `${token} ${next.token}`.toLowerCase();
      const v = lex.bigrams.get(pair);
      if (v !== undefined) {
        perToken.push({ token: `${token} ${next.token}`, value: v });
        i++;
        continue;
      }
    }
    if (isReferent(token, sentenceStart, lex, entities)) {
      perToken.push({ token, value: 5 });
      continue;
    }
    perToken.push({ token, value: lookupWord(token, lex.words) });
  }
  const vals = perToken.map((p) => p.value).filter((v): v is number => v !== null);
  const tokens = perToken.length;
  const scored = vals.length;
  const score = tokens === 0 || scored / tokens < 0.6 ? null : Math.round((vals.reduce((a, b) => a + b, 0) / scored) * 100) / 100;
  return { score, scored, tokens, perToken };
}

/** 7.6.1 entity list for the scorer: cluster labels, event names and aliases, lower-cased. */
export function labEntities(store: LabStore): Set<string> {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.trim().toLowerCase();
    if (!t) return;
    out.add(t);
    for (const w of t.split(/\s+/)) if (w.length > 2) out.add(w);
  };
  for (const c of store.clusters.all()) add(c.label);
  for (const e of store.events.all()) {
    add(e.name);
    for (const a of e.aliases) add(a);
  }
  return out;
}

export type ConcretenessBand = { lo: number; hi: number; source: 'prior' | 'yours'; n: number };

export type BandFit =
  | { adopted: true; band: ConcretenessBand; n: number; terciles: { lo: number; hi: number; median: number; interval: [number, number] | null }[] }
  | { adopted: false; n: number; reason: 'not_enough' | 'no_separation'; text: string; terciles: { lo: number; hi: number; median: number; interval: [number, number] | null }[] };

/**
 * Pure part of fitConcretenessBand: rows of (score, ratio). Under 30 the prior stays; otherwise
 * terciles by score, each tercile's median ratio and 90% interval, the best adopted only when
 * its interval's low end is above the worst tercile's interval high end.
 */
export function fitBand(rows: readonly { score: number; ratio: number }[]): BandFit {
  const n = rows.length;
  if (n < BAND_MIN_N) return { adopted: false, n, reason: 'not_enough', text: `Your data: not enough yet (n ${n} of ${BAND_MIN_N})`, terciles: [] };
  const sorted = [...rows].sort((a, b) => a.score - b.score || a.ratio - b.ratio);
  const cuts = [0, Math.round(n / 3), Math.round((2 * n) / 3), n];
  const terciles = [0, 1, 2].map((k) => {
    const part = sorted.slice(cuts[k], cuts[k + 1]);
    const ratios = part.map((r) => r.ratio).sort((a, b) => a - b);
    const mid = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
    return { lo: part[0].score, hi: part[part.length - 1].score, median: mid, interval: medianInterval(ratios, 0.9) };
  });
  const best = [...terciles].sort((a, b) => b.median - a.median)[0];
  const worst = [...terciles].sort((a, b) => a.median - b.median)[0];
  if (best.interval && worst.interval && best !== worst && best.interval[0] > worst.interval[1]) {
    return { adopted: true, band: { lo: best.lo, hi: best.hi, source: 'yours', n }, n, terciles };
  }
  return { adopted: false, n, reason: 'no_separation', text: `Your data does not separate yet (n ${n}).`, terciles };
}

/** lab_priors key for an adopted band. */
export const bandKey = (family: string) => `yours:concreteness:${family}`;

/**
 * Recompute Brody's band for one format family from owned posts with a hook, a score and an
 * age-matched ratio at 72h (section 04's measure; v1's breakout ratio until lane D lands),
 * and store it as a prior when adopted (removed otherwise).
 */
export function fitConcretenessBand(store: LabStore, family: string, opts: { lexicon?: Lexicon | null; now?: Date } = {}): BandFit {
  const lex = opts.lexicon === undefined ? loadLexicon() : opts.lexicon;
  const entities = labEntities(store);
  const rows: { score: number; ratio: number }[] = [];
  if (lex) {
    for (const p of store.posts.all()) {
      if (!p.isOwned) continue;
      const d = store.dissections.get(p.id);
      if (!d || d.format !== family || !d.hookText.trim()) continue;
      const m = store.measures.get(p.id);
      const ratio = ratioAt72(m);
      if (ratio === null) continue;
      const c = concreteness(d.hookText, lex, entities);
      if (c.score === null) continue;
      rows.push({ score: c.score, ratio });
    }
  }
  const fit = fitBand(rows);
  const at = (opts.now ?? new Date()).toISOString();
  if (fit.adopted) store.priors.set({ key: bandKey(family), value: { lo: fit.band.lo, hi: fit.band.hi }, n: fit.n, supersedesDefault: true, updatedAt: at });
  else store.priors.remove(bandKey(family));
  return fit;
}

/** The age-matched ratio at 72h when section 04 recorded it, else the v1 ratio once the post is 72h old. */
function ratioAt72(m: ReturnType<LabStore['measures']['get']>): number | null {
  if (!m) return null;
  const read = (m.ages as Record<string, { ratio?: number | null } | undefined>)['72'];
  if (read && typeof read.ratio === 'number') return read.ratio;
  return m.breakout ?? null;
}

/** The band in force for a family: an adopted prior, else the niche prior. */
export function bandFor(store: LabStore | null, family: string | null): ConcretenessBand {
  const p = store && family ? store.priors.get(bandKey(family)) : null;
  const v = p?.value as { lo?: number; hi?: number } | undefined;
  if (p && typeof v?.lo === 'number' && typeof v?.hi === 'number') return { lo: v.lo, hi: v.hi, source: 'yours', n: p.n };
  return { lo: NICHE_PRIOR_BAND[0], hi: NICHE_PRIOR_BAND[1], source: 'prior', n: 0 };
}
