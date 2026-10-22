/**
 * Canonical events (05 sections 6.3 to 7): attach pings, create candidates, confirm with the
 * t0 rule, expire, merge, rename, add by hand, and the X attach rule (6.4).
 */
import { createHash } from 'node:crypto';
import type { LabEvent, LabEventPing, LabRadarFamily } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { CREATES_CANDIDATES } from '@/lib/lab/radar/config';
import { STOPWORDS, canonicalKey, containMatch, matchEvent, splitKey, type MatchCtx } from '@/lib/lab/radar/names';
import { DAY, HOUR } from '@/lib/lab/radar/util';

export const CONFIRM_PAIR_H = 72;
export const CANDIDATE_TTL_H = 72;
export const REOPEN_DAYS = 14;
export const X_ATTACH_AUTHORS = 3;
export const X_ATTACH_WINDOW_H = 6;

export const eventIdFor = (key: string, firstSeenAt: string): string => `lev-${createHash('sha1').update(`${key}|${firstSeenAt}`).digest('hex').slice(0, 12)}`;

/** The time a ping speaks for: its own time when known, else when we first saw it. */
export const pingTime = (p: Pick<LabEventPing, 'sourceTime' | 'firstSeenAt'>): string => p.sourceTime ?? p.firstSeenAt;

export function newEvent(name: string, firstSeenAt: string, now: Date, extra: Partial<LabEvent> = {}): LabEvent {
  const key = canonicalKey(name);
  const at = now.toISOString();
  return {
    id: eventIdFor(key, firstSeenAt),
    key,
    name,
    vendor: null,
    aliases: [],
    status: 'candidate',
    mergedInto: null,
    dismissReason: null,
    novelty: null,
    noveltySource: null,
    class: 'unknown',
    classBasis: null,
    classInfo: { peak: null, preMedian: null, baselineShare: null, day7Share: null, decidedAt: null, week5Share: null, classCorrect: null },
    wikiArticle: null,
    attention: [],
    t0: null,
    t0Rule: null,
    t0PingId: null,
    t0RevisedAt: null,
    confirmedAt: null,
    firstSeenAt,
    sourceCount: 0,
    sources: [],
    waveN: 1,
    waveStartedAt: null,
    windowState: null,
    windowOpensAt: null,
    windowClosingAt: null,
    windowClosesAt: null,
    windowChangedAt: null,
    windowReason: null,
    windowLog: [],
    clusterId: null,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

const addAlias = (e: LabEvent, key: string | null): LabEvent => (key && key !== e.key && !e.aliases.includes(key) ? { ...e, aliases: [...e.aliases, key] } : e);

export type AttachResult = { attached: number; created: number; reopened: number };

/**
 * 6.3: every unattached, named, non-baseline ping of the last 30 days is matched to an event,
 * or creates a candidate when it qualifies and its source creates candidates. A qualifying
 * ping that matches an expired event within 14 days reopens it. Dismissed events still take
 * pings by key (the lead-time ledger stays complete).
 */
export function attachOrCreate(store: LabStore, now: Date): AttachResult {
  const res: AttachResult = { attached: 0, created: 0, reopened: 0 };
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  store.transaction(() => {
    const events = store.events.all();
    const cache = new Map<string, LabEventPing[]>();
    const ctx: MatchCtx = {
      events,
      pingsOf: (id) => {
        if (!cache.has(id)) cache.set(id, store.eventPings.forEvent(id));
        return cache.get(id)!;
      },
    };
    const attach = (p: LabEventPing, e: LabEvent, rule: LabEventPing['matchRule']) => {
      store.eventPings.upsert({ ...p, eventId: e.id, matchRule: rule });
      cache.set(e.id, [...ctx.pingsOf(e.id), { ...p, eventId: e.id }]);
      res.attached++;
    };
    // human-written names first (vendor, X, HN, Product Hunt), repo slugs last, so a new event is
    // called "Sample Model 7" rather than "sample-model-7" when both arrive in one tick
    const NAME_RANK: Record<string, number> = { vendor: 0, x: 1, hn: 2, producthunt: 3, tiktok_cc: 4, github: 5, hf_models: 6, hf_spaces: 7 };
    const pending = store.eventPings.unattached(since).sort((a, b) => (NAME_RANK[a.source] ?? 9) - (NAME_RANK[b.source] ?? 9) || a.firstSeenAt.localeCompare(b.firstSeenAt));
    for (const p of pending) {
      if (p.isBaseline) continue;
      // tweets that are not vendor launches attach only through the 6.4 rule
      if (p.source === 'x' && !p.isLaunch) continue;
      if (!p.name) continue;
      const key = p.nameKey ?? canonicalKey(p.name);
      if (!key) continue;
      const m = matchEvent(p, pingTime(p), ctx);
      if (m) {
        const e = ctx.events.find((x) => x.id === m.eventId)!;
        const next = m.rule === 'key' ? e : addAlias(e, key);
        if (next !== e) {
          store.events.upsert({ ...next, updatedAt: now.toISOString() });
          Object.assign(e, next);
        }
        attach(p, e, m.rule);
        continue;
      }
      if (p.qualifies) {
        const expired = events.find((e) => e.status === 'expired' && now.getTime() - Date.parse(e.updatedAt) <= REOPEN_DAYS * DAY && (e.key === key || e.aliases.includes(key) || containMatch(key, e.key)));
        if (expired) {
          const reopened = { ...addAlias(expired, key), status: 'candidate' as const, firstSeenAt: expired.firstSeenAt, updatedAt: now.toISOString() };
          store.events.upsert(reopened);
          Object.assign(expired, reopened);
          attach(p, expired, 'key');
          res.reopened++;
          continue;
        }
      }
      const dismissed = events.find((e) => e.status === 'dismissed' && (e.key === key || e.aliases.includes(key)));
      if (dismissed) {
        attach(p, dismissed, 'key');
        continue;
      }
      if (!p.qualifies || !CREATES_CANDIDATES[p.source as keyof typeof CREATES_CANDIDATES]) continue;
      if (store.events.byKey(key)) continue;
      const e = newEvent(p.name, p.firstSeenAt, now, { vendor: p.vendor });
      store.events.upsert(e);
      events.push(e);
      attach(p, e, 'key');
      res.created++;
    }
  });
  return res;
}

/** Earliest qualifying time per family on one event. */
export function familyFirsts(pings: readonly LabEventPing[]): Map<LabRadarFamily, LabEventPing> {
  const out = new Map<LabRadarFamily, LabEventPing>();
  for (const p of pings) {
    if (!p.qualifies) continue;
    const cur = out.get(p.family);
    if (!cur || pingTime(p) < pingTime(cur)) out.set(p.family, p);
  }
  return out;
}

export type ConfirmDecision = { confirm: boolean; rule: 'vendor' | 'two_sources' | null; t0: string | null; t0PingId: string | null };

/** 7: T1 vendor, T2 two families within 72 h (pure over one event's pings). */
export function confirmRule(pings: readonly LabEventPing[]): ConfirmDecision {
  const firsts = familyFirsts(pings);
  const vendor = firsts.get('vendor');
  const earliest = [...firsts.values()].sort((a, b) => pingTime(a).localeCompare(pingTime(b)))[0] ?? null;
  if (vendor) return { confirm: true, rule: 'vendor', t0: pingTime(vendor), t0PingId: vendor.id };
  const times = [...firsts.values()].map((p) => Date.parse(pingTime(p))).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] <= CONFIRM_PAIR_H * HOUR) return { confirm: true, rule: 'two_sources', t0: pingTime(earliest!), t0PingId: earliest!.id };
  }
  return { confirm: false, rule: null, t0: null, t0PingId: null };
}

/**
 * 7: candidates move to confirmed; on every live event t0 may move earlier (never later),
 * `source_count` and `sources_json` follow the qualifying families.
 */
export function confirmEvents(store: LabStore, now: Date): { confirmed: number; revised: number } {
  let confirmed = 0;
  let revised = 0;
  const at = now.toISOString();
  store.transaction(() => {
    for (const e of store.events.all({ status: ['candidate', 'confirmed', 'dismissed'] })) {
      const pings = store.eventPings.forEvent(e.id);
      const firsts = familyFirsts(pings);
      const sources = [...firsts.keys()].sort();
      let next: LabEvent = { ...e, sourceCount: sources.length, sources };
      if (e.status === 'candidate') {
        const d = confirmRule(pings);
        if (d.confirm) {
          next = { ...next, status: 'confirmed', confirmedAt: at, t0: d.t0, t0Rule: d.rule, t0PingId: d.t0PingId };
          confirmed++;
        }
      } else if (e.t0 && e.t0Rule !== 'manual') {
        const earliest = [...firsts.values()].sort((a, b) => pingTime(a).localeCompare(pingTime(b)))[0];
        if (earliest && pingTime(earliest) < e.t0) {
          next = { ...next, t0: pingTime(earliest), t0PingId: earliest.id, t0RevisedAt: at };
          revised++;
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(e)) store.events.upsert({ ...next, updatedAt: at });
    }
  });
  return { confirmed, revised };
}

/** 7: a candidate with no confirmation 72 h after first seen becomes `expired`. */
export function expireCandidates(store: LabStore, now: Date): number {
  let n = 0;
  for (const e of store.events.all({ status: ['candidate'] })) {
    if (now.getTime() - Date.parse(e.firstSeenAt) >= CANDIDATE_TTL_H * HOUR) {
      store.events.setStatus(e.id, 'expired', { at: now.toISOString() });
      n++;
    }
  }
  return n;
}

/** 6.5: move every ping and coverage row from `id` to `into`; t0 = min of both. */
export function mergeEvents(store: LabStore, id: string, into: string, now: Date): LabEvent {
  const from = store.events.get(id);
  const to = store.events.get(into);
  if (!from || !to) throw new Error('No such event');
  if (from.id === to.id) throw new Error('An event cannot merge into itself');
  const at = now.toISOString();
  store.transaction(() => {
    for (const p of store.eventPings.forEvent(from.id)) store.eventPings.upsert({ ...p, eventId: to.id, matchRule: 'manual' });
    for (const c of store.eventCoverage.forEvent(from.id)) {
      store.eventCoverage.remove(from.id, c.postId);
      if (!store.eventCoverage.forPost(c.postId).some((x) => x.eventId === to.id)) store.eventCoverage.upsert({ ...c, eventId: to.id });
    }
    const aliases = [...new Set([...to.aliases, from.key, ...from.aliases])].filter((k) => k !== to.key);
    const t0s = [from.t0, to.t0].filter((x): x is string => Boolean(x)).sort();
    const t0 = t0s[0] ?? null;
    store.events.upsert({
      ...to,
      aliases,
      t0,
      t0RevisedAt: t0 && to.t0 && t0 < to.t0 ? at : to.t0RevisedAt,
      firstSeenAt: [from.firstSeenAt, to.firstSeenAt].sort()[0],
      updatedAt: at,
    });
    store.events.upsert({ ...from, status: 'merged', mergedInto: to.id, updatedAt: at });
  });
  return store.events.get(to.id)!;
}

/** T3: `POST {action:'add', name, t0?}` makes a confirmed event by hand. */
export function manualEvent(store: LabStore, name: string, t0: string | null, now: Date): LabEvent {
  const key = canonicalKey(name);
  if (!key) throw new Error('Name a launch');
  const existing = store.events.byKey(key);
  if (existing) return existing;
  const at = t0 ?? now.toISOString();
  const e = newEvent(name, at, now, { status: 'confirmed', t0: at, t0Rule: 'manual', confirmedAt: now.toISOString() });
  store.events.upsert(e);
  return e;
}

/** `POST {action:'rename', id, name}`: key recomputed, the old key kept as an alias. */
export function renameEvent(store: LabStore, id: string, name: string, now: Date): LabEvent {
  const e = store.events.get(id);
  if (!e) throw new Error('No such event');
  const key = canonicalKey(name);
  if (!key) throw new Error('Name a launch');
  const other = store.events.byKey(key);
  if (other && other.id !== e.id) throw new Error(`Another event is already called ${other.name}. Merge them instead.`);
  const aliases = [...new Set([...e.aliases, e.key])].filter((k) => k !== key);
  const next = { ...e, name, key, aliases, updatedAt: now.toISOString() };
  store.events.upsert(next);
  return next;
}

/* ── 6.4 the X attach rule ────────────────────────────────────────────── */

/** Lowercased token stream of free text in canonical-key form (stopwords dropped, no colon cut), so keys match as whole words. */
export function textTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=[a-z0-9])[_/-](?=[a-z0-9])/g, ' ')
    .replace(/\b([a-z]{3,})(\d)/g, '$1 $2')
    .replace(/[^a-z0-9. ]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Whole-word R1 (the key appears as consecutive tokens) or R4 (a 2 to 6 token window contains-matches). */
export function textMentions(tokens: readonly string[], key: string): boolean {
  const k = splitKey(key);
  if (!k.length) return false;
  for (let i = 0; i + k.length <= tokens.length; i++) if (k.every((t, j) => tokens[i + j] === t)) return true;
  for (let w = 2; w <= 6; w++) for (let i = 0; i + w <= tokens.length; i++) if (containMatch(tokens.slice(i, i + w).join('-'), key)) return true;
  return false;
}

/**
 * 6.4: non-vendor tweets are matched against live event names and aliases. When 3 or more
 * distinct authors match one event within 6 h, one synthetic family-x ping is written.
 */
export function xAttach(store: LabStore, now: Date, opts: { dry?: boolean } = {}): { synthetic: number; attached: number } {
  const since = new Date(now.getTime() - 2 * DAY).toISOString();
  const tweets = store.eventPings.forSource('x', since).filter((p) => !p.isLaunch && !p.externalId.startsWith('lev-'));
  const live = store.events.all({ status: ['candidate', 'confirmed'] });
  let synthetic = 0;
  let attached = 0;
  store.transaction(() => {
    for (const e of live) {
      const keys = [e.key, ...e.aliases];
      const hits = tweets.filter((t) => {
        const toks = textTokens(t.title);
        return keys.some((k) => textMentions(toks, k));
      });
      for (const t of hits) {
        if (!t.eventId) {
          store.eventPings.upsert({ ...t, eventId: e.id, matchRule: 'contain' });
          attached++;
        }
      }
      const byBucket = new Map<number, Set<string>>();
      for (const t of hits) {
        const tt = Date.parse(pingTime(t));
        for (const other of hits) {
          const ot = Date.parse(pingTime(other));
          if (ot >= tt && ot - tt <= X_ATTACH_WINDOW_H * HOUR && other.author) {
            const bucket = Math.floor(tt / HOUR);
            if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
            byBucket.get(bucket)!.add(other.author.toLowerCase());
          }
        }
      }
      for (const [bucket, authors] of byBucket) {
        if (authors.size < X_ATTACH_AUTHORS) continue;
        const id = `x:${e.id}:${bucket}`;
        if (store.eventPings.get(id)) continue;
        const at = new Date(bucket * HOUR).toISOString();
        store.eventPings.upsert({
          id, source: 'x', family: 'x', externalId: `${e.id}:${bucket}`, eventId: e.id, matchRule: 'key', name: e.name, nameKey: e.key,
          title: `${authors.size} watched accounts on ${e.name}`, url: '', author: null, vendor: null, sourceTime: at, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), prevSeenAt: null,
          metricFirst: authors.size, metricPrev: null, metricLast: authors.size, rank: null, velocityPerH: null, robustZ: null,
          isLaunch: false, isBaseline: false, qualifies: true, qualifyReason: `X: ${authors.size} watched accounts in 6h`, fakeStar: null, fakeStarInfo: null, lexicon: true, dry: Boolean(opts.dry),
        });
        synthetic++;
        break; // one synthetic ping per event per pass
      }
    }
  });
  return { synthetic, attached };
}
