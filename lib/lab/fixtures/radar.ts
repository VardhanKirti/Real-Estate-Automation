/**
 * Radar fixture layer (08.7.2 "Radar events", "Pings", "Angle map", "Lead-time ledger", "Brief").
 * Eight fictional launches E1 to E8 (names start with "Sample"), pings across the eight ping
 * sources, coverage rows on real fixture posts, and today's morning brief.
 *
 * S0 builds this directly from the 05 row shapes. Lane R replaces the numbers with its own
 * radarFixtures(now) and maths (velocityPerH, robustZ, windowFor, matchCoverage) when it lands;
 * every id and enum here is already 05's.
 */
import type { LabEvent, LabEventPing, LabNovelty, LabEventClass, LabRadarFamily, LabRadarSource, LabWindowState, LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { stream } from '@/lib/lab/fixtures/rand';
import { BRIEF_LINES, LAUNCH_NAMES, LAUNCH_VENDORS } from '@/lib/lab/fixtures/text';
import { persistLeadTime } from '@/lib/lab/radar/leadtime';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const FAMILY: Record<Exclude<LabRadarSource, 'wikipedia'>, LabRadarFamily> = {
  hn: 'hn', hf_models: 'hf', hf_spaces: 'hf', github: 'github', vendor: 'vendor', x: 'x', producthunt: 'producthunt', tiktok_cc: 'tiktok',
};
const PING_SOURCES = Object.keys(FAMILY) as Exclude<LabRadarSource, 'wikipedia'>[];

type EventDef = {
  n: number; ageH: number; novelty: LabNovelty | null; cls: LabEventClass; state: LabWindowState | null;
  wave: number; waveAgeH: number | null; sources: Exclude<LabRadarSource, 'wikipedia'>[]; covered: number; status: LabEvent['status'];
};
/** 08.7.2 table, row for row. */
export const EVENT_DEFS: EventDef[] = [
  { n: 1, ageH: 9, novelty: 'new_category', cls: 'unknown', state: 'open', wave: 1, waveAgeH: null, sources: ['vendor', 'hn', 'hf_models', 'github', 'x'], covered: 3, status: 'confirmed' },
  { n: 2, ageH: 48, novelty: 'new_flagship', cls: 'unknown', state: 'open', wave: 2, waveAgeH: 20, sources: ['vendor', 'hn', 'x', 'hf_spaces'], covered: 9, status: 'confirmed' },
  { n: 3, ageH: 120, novelty: 'point_release', cls: 'spike', state: 'closing', wave: 1, waveAgeH: null, sources: ['vendor', 'hn', 'github'], covered: 8, status: 'confirmed' },
  { n: 4, ageH: 288, novelty: 'new_surface', cls: 'spike', state: 'closed', wave: 1, waveAgeH: null, sources: ['vendor', 'hn', 'producthunt'], covered: 11, status: 'confirmed' },
  { n: 5, ageH: 480, novelty: 'new_category', cls: 'adopted', state: 'open', wave: 2, waveAgeH: 40, sources: ['vendor', 'hn', 'github', 'tiktok_cc'], covered: 12, status: 'confirmed' },
  { n: 6, ageH: 30, novelty: 'new_surface', cls: 'unknown', state: 'open', wave: 1, waveAgeH: null, sources: ['vendor', 'x', 'producthunt'], covered: 1, status: 'confirmed' },
  { n: 7, ageH: 72, novelty: 'ecosystem', cls: 'unknown', state: 'closing', wave: 1, waveAgeH: null, sources: ['github', 'hn', 'hf_models'], covered: 6, status: 'confirmed' },
  { n: 8, ageH: 4, novelty: null, cls: 'unknown', state: null, wave: 1, waveAgeH: null, sources: ['hn'], covered: 0, status: 'candidate' },
];

export const eventId = (n: number) => `fx-ev-e${n}`;
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ANGLES: LaunchAngle[] = ['first_look', 'real_examples', 'hours_spent', 'comparison', 'how_to', 'money', 'drama', 'other'];

export function seedRadar(store: LabStore, anchor: Date, localDay: string): { events: number; pings: number; coverage: number } {
  const T = anchor.getTime();
  const r = stream('radar');
  const posts = store.posts.all().filter((p) => p.postedAt);
  const tracked = posts.filter((p) => !p.isOwned);
  const owned = posts.filter((p) => p.isOwned);
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const activeCreators = new Set(store.sources.all('tracked').map((s) => s.id)).size;
  let pingN = 0;
  let coverageN = 0;
  const used = new Set<string>();

  store.transaction(() => {
    for (const d of EVENT_DEFS) {
      const id = eventId(d.n);
      const name = LAUNCH_NAMES[d.n - 1];
      const t0 = T - d.ageH * HOUR;
      const families = [...new Set(d.sources.map((s) => FAMILY[s]))];
      const waveStart = d.waveAgeH !== null ? T - d.waveAgeH * HOUR : t0;
      const opens = d.state ? waveStart : null;
      const closing = opens !== null ? opens + 72 * HOUR : null;
      const closes = opens !== null ? opens + 168 * HOUR : null;
      const log: LabEvent['windowLog'] = d.state ? [{ at: iso(t0), from: null, to: 'open', reason: 'confirmed' }] : [];
      if (d.state === 'closing' || d.state === 'closed') log.push({ at: iso(closing!), from: 'open', to: 'closing', reason: 'most tracked creators covered it' });
      if (d.state === 'closed') log.push({ at: iso(closes!), from: 'closing', to: 'closed', reason: 'window ended' });
      if (d.wave > 1) log.push({ at: iso(waveStart), from: 'closed', to: 'open', reason: `wave ${d.wave}` });
      const attention = Array.from({ length: Math.min(21, Math.ceil(d.ageH / 24) + 3) }, (_, i) => ({ day: iso(t0 + (i - 2) * DAY).slice(0, 10), v: Math.round((i < 2 ? 200 : 4000 / (i - 1)) * r.between(0.8, 1.2)) }));
      store.events.upsert({
        id, key: key(name), name, vendor: LAUNCH_VENDORS[d.n - 1], aliases: [],
        status: d.status, mergedInto: null, dismissReason: null,
        novelty: d.novelty, noveltySource: d.novelty ? 'rule' : null,
        class: d.cls, classBasis: d.cls === 'unknown' ? null : 'hn',
        classInfo: { peak: d.cls === 'unknown' ? null : 4000, preMedian: d.cls === 'unknown' ? null : 200, baselineShare: null, day7Share: d.cls === 'adopted' ? 0.34 : d.cls === 'spike' ? 0.08 : null, decidedAt: d.cls === 'unknown' ? null : iso(t0 + 96 * HOUR), week5Share: null, classCorrect: null },
        wikiArticle: null, attention,
        t0: d.status === 'confirmed' ? iso(t0) : null, t0Rule: d.status === 'confirmed' ? (d.sources.includes('vendor') ? 'vendor' : 'two_sources') : null, t0PingId: null, t0RevisedAt: null,
        confirmedAt: d.status === 'confirmed' ? iso(t0 + 30 * 60_000) : null, firstSeenAt: iso(t0), sourceCount: families.length, sources: families,
        waveN: d.wave, waveStartedAt: d.wave > 1 ? iso(waveStart) : null,
        windowState: d.state, windowOpensAt: opens !== null ? iso(opens) : null, windowClosingAt: closing !== null ? iso(closing) : null, windowClosesAt: closes !== null ? iso(closes) : null,
        windowChangedAt: log.length ? log[log.length - 1].at : null, windowReason: log.length ? log[log.length - 1].reason : null, windowLog: log,
        clusterId: null, createdAt: iso(t0), updatedAt: iso(T),
      });

      // pings: the qualifying ones (first seen at or after t0, earliest first) plus baseline reads
      d.sources.forEach((source, i) => {
        const first = t0 + i * 25 * 60_000;
        const series = [r.int(5, 40), r.int(40, 200), r.int(150, 900)];
        const hours = Math.max(1, (Math.min(T, first + 6 * HOUR) - first) / HOUR);
        const velocity = Math.round(((series[2] - series[0]) / hours) * 10) / 10;
        pingN++;
        const ping: LabEventPing = {
          id: `${source}:fx-${d.n}-${i}`, source, family: FAMILY[source], externalId: `fx-${d.n}-${i}`, eventId: id, matchRule: source === 'github' ? 'repo' : 'key',
          name, nameKey: key(name), title: `${name}: ${source === 'vendor' ? 'introducing' : 'launch thread'}`, url: `https://example.com/lab-sample/radar/${d.n}/${source}`,
          author: null, vendor: LAUNCH_VENDORS[d.n - 1], sourceTime: iso(first), firstSeenAt: iso(first), lastSeenAt: iso(Math.min(T, first + 6 * HOUR)), prevSeenAt: iso(Math.min(T, first + 3 * HOUR)),
          metricFirst: series[0], metricPrev: series[1], metricLast: series[2], rank: r.int(1, 30), velocityPerH: velocity, robustZ: Math.round(r.between(3, 9) * 100) / 100,
          isLaunch: source === 'vendor', isBaseline: false, qualifies: d.status === 'confirmed', qualifyReason: d.status === 'confirmed' ? (source === 'vendor' ? 'vendor launch post' : 'velocity above the source baseline') : null,
          fakeStar: source === 'github' ? false : null, fakeStarInfo: null, lexicon: true, dry: true,
        };
        store.eventPings.upsert(ping);
      });

      // coverage: tracked posts posted around t0 (pre / first / follow), plus one owned post on E2
      if (d.covered > 0) {
        const near = tracked
          .filter((p) => !used.has(p.id))
          .map((p) => ({ p, dt: Date.parse(p.postedAt!) - t0 }))
          .filter((x) => x.dt > -12 * HOUR && x.dt < d.ageH * HOUR)
          .sort((a, b) => a.dt - b.dt);
        const fallback = tracked.filter((p) => !used.has(p.id) && !near.some((x) => x.p.id === p.id)).slice(0, d.covered);
        const picks = [...near.map((x) => x.p), ...fallback].slice(0, d.covered);
        const creatorsSeen = new Map<string, number>();
        picks.forEach((p, i) => {
          used.add(p.id);
          const h = (Date.parse(p.postedAt!) - t0) / HOUR;
          const m = measures.get(p.id);
          creatorsSeen.set(p.sourceId, (creatorsSeen.get(p.sourceId) ?? 0) + 1);
          coverageN++;
          store.eventCoverage.upsert({
            eventId: id, postId: p.id, sourceId: p.sourceId, platform: p.platform, isOwned: false, postedAt: p.postedAt!, hoursSinceT0: Math.round(h * 10) / 10,
            waveN: d.wave, wavePosition: h < 0 ? 'pre' : i < 3 ? 'first' : 'follow', creatorRank: creatorsSeen.size,
            matchRule: i === picks.length - 1 && d.n === 2 ? 'cluster' : 'name', confidence: i === picks.length - 1 && d.n === 2 ? 'low' : 'high', confirmed: i === picks.length - 1 && d.n === 2 ? null : true,
            // E1 and E2 cover all eight angles between them; one taken angle (real_examples) with n 5 or more
            angle: d.n === 1 ? ANGLES[i % 3] : d.n === 2 ? (i < 5 ? 'real_examples' : ANGLES[3 + (i % 5)]) : ANGLES[(i + d.n) % 7],
            angleSource: 'rule', ratio: m?.breakout ?? null, ratioAgeH: m?.breakout != null ? 24 : null, isBreakout: Boolean(m?.isBreakout), computedAt: iso(T),
          });
        });
        if (d.n === 2 && owned.length) {
          const mine = owned.find((p) => !used.has(p.id) && T - Date.parse(p.postedAt!) < 10 * DAY) ?? owned[0];
          used.add(mine.id);
          coverageN++;
          store.eventCoverage.upsert({
            eventId: id, postId: mine.id, sourceId: mine.sourceId, platform: mine.platform, isOwned: true, postedAt: mine.postedAt!, hoursSinceT0: Math.round(((Date.parse(mine.postedAt!) - t0) / HOUR) * 10) / 10,
            waveN: d.wave, wavePosition: 'follow', creatorRank: null, matchRule: 'manual', confidence: 'high', confirmed: true, angle: 'how_to', angleSource: 'manual',
            ratio: measures.get(mine.id)?.breakout ?? null, ratioAgeH: 24, isBreakout: Boolean(measures.get(mine.id)?.isBreakout), computedAt: iso(T),
          });
        }
      }
    }

    // baseline pings: the sources' own normal (never attached, never qualifying)
    let b = 0;
    while (pingN < 60) {
      const source = PING_SOURCES[b % PING_SOURCES.length];
      const seen = T - (2 + (b % 20)) * DAY - r.int(0, 20) * HOUR;
      store.eventPings.upsert({
        id: `${source}:fx-base-${b}`, source, family: FAMILY[source], externalId: `fx-base-${b}`, eventId: null, matchRule: null, name: null, nameKey: null,
        title: `Sample baseline item ${b + 1}`, url: `https://example.com/lab-sample/radar/base/${b}`, author: null, vendor: null, sourceTime: iso(seen),
        firstSeenAt: iso(seen), lastSeenAt: iso(seen + 6 * HOUR), prevSeenAt: iso(seen + 3 * HOUR), metricFirst: r.int(1, 10), metricPrev: r.int(10, 30), metricLast: r.int(20, 60), rank: r.int(10, 90),
        velocityPerH: Math.round(r.between(1, 8) * 10) / 10, robustZ: Math.round(r.between(-1, 1.5) * 100) / 100,
        isLaunch: false, isBaseline: true, qualifies: false, qualifyReason: null,
        fakeStar: source === 'github' && b === 3 ? true : source === 'github' ? false : null, fakeStarInfo: source === 'github' && b === 3 ? { burst: 55, of: 100, windowH: 1 } : null, lexicon: false, dry: true,
      });
      pingN++;
      b++;
    }

    // lane R: the lead-time table from 05 13's own maths over the fixture coverage
    void activeCreators;
    persistLeadTime(store, anchor);

    // priorities and hrefs per 05 14.1 (new_category launch 1, creator breakout 2, window closing 3)
    const items = [
      { kind: 'new_launch' as const, dedupeKey: `new_launch:${eventId(1)}`, priority: 1, at: iso(T - 9 * HOUR), line: BRIEF_LINES.new_launch(LAUNCH_NAMES[0]), href: `/lab/radar?event=${eventId(1)}`, eventId: eventId(1), postId: null },
      { kind: 'creator_breakout' as const, dedupeKey: `creator_breakout:${eventId(2)}`, priority: 2, at: iso(T - 20 * HOUR), line: BRIEF_LINES.creator_breakout('A tracked creator'), href: `/lab/radar?event=${eventId(2)}`, eventId: eventId(2), postId: null },
      { kind: 'window_closing' as const, dedupeKey: `window_closing:${eventId(3)}:1`, priority: 3, at: iso(T - 48 * HOUR), line: BRIEF_LINES.window_closing(LAUNCH_NAMES[2]), href: `/lab/radar?event=${eventId(3)}`, eventId: eventId(3), postId: null },
    ];
    store.morningBrief.upsert({ id: `lbr-${localDay}`, day: localDay, composedAt: iso(T - 2 * HOUR), items, dedupeKeys: items.map((i) => i.dedupeKey), text: items.map((i) => i.line).join('\n'), sentAt: null, sentVia: null, sendError: null, dry: true });
  });
  return { events: EVENT_DEFS.length, pings: pingN, coverage: coverageN };
}
