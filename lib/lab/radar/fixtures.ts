/**
 * Radar fixtures for dry and Filming (05 18). Deterministic, built relative to `now`; every name
 * starts with `Sample` so a fixture is never mistaken for a real launch. Under LAB_DRY=1 on a real
 * install they are returned, never written; under Filming they persist with `dry = 1`.
 * (The full fixture world's E1 to E8 are lib/lab/fixtures/radar.ts, 08.7.2.)
 */
import type { LabEvent, LabEventPing, LabNovelty, LabEventClass, LabRadarFamily, LabRadarSource, LabWindowState } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { newEvent } from '@/lib/lab/radar/events';
import { canonicalKey } from '@/lib/lab/radar/names';
import { SOURCE_FAMILY } from '@/lib/lab/radar/config';
import { HOUR } from '@/lib/lab/radar/util';

type Row = { n: number; name: string; novelty: LabNovelty | null; cls: LabEventClass; ageH: number | null; state: LabWindowState | null; wave: number; covered: number; sources: Exclude<LabRadarSource, 'wikipedia'>[] };

/** 05 18, row for row. */
export const RADAR_FIXTURE_ROWS: readonly Row[] = [
  { n: 1, name: 'Sample Model 7', novelty: 'new_flagship', cls: 'unknown', ageH: 9, state: 'open', wave: 1, covered: 3, sources: ['vendor', 'hn', 'hf_models'] },
  { n: 2, name: 'Sample Agent Kit', novelty: 'new_category', cls: 'adopted', ageH: 48, state: 'open', wave: 2, covered: 9, sources: ['vendor', 'hn', 'github'] },
  { n: 3, name: 'Sample 6.1', novelty: 'point_release', cls: 'spike', ageH: 120, state: 'closing', wave: 1, covered: 11, sources: ['vendor', 'hn'] },
  { n: 4, name: 'Sample Plugin', novelty: null, cls: 'unknown', ageH: null, state: null, wave: 1, covered: 0, sources: ['hn'] },
];

export type RadarFixtures = { events: LabEvent[]; pings: LabEventPing[]; coverage: { eventId: string; creators: number; active: number }[] };

const iso = (ms: number) => new Date(ms).toISOString();

export function radarFixtures(now: Date): RadarFixtures {
  const T = Math.floor(now.getTime() / HOUR) * HOUR;
  const events: LabEvent[] = [];
  const pings: LabEventPing[] = [];
  const coverage: RadarFixtures['coverage'] = [];
  for (const r of RADAR_FIXTURE_ROWS) {
    const first = r.ageH === null ? T - 4 * HOUR : T - r.ageH * HOUR;
    const id = `fx-rf-${r.n}`;
    const waveStart = r.wave > 1 ? T - 20 * HOUR : first;
    const opens = r.state ? (r.cls === 'adopted' ? waveStart : first) : null;
    const span = r.cls === 'adopted' ? { open: 168, closing: 504 } : { open: 72, closing: 168 };
    const e = newEvent(r.name, iso(first), now, {
      id,
      status: r.state ? 'confirmed' : 'candidate',
      novelty: r.novelty,
      noveltySource: r.novelty ? 'rule' : null,
      class: r.cls,
      t0: r.state ? iso(first) : null,
      t0Rule: r.state ? 'vendor' : null,
      confirmedAt: r.state ? iso(first + 30 * 60_000) : null,
      sourceCount: new Set(r.sources.map((s) => SOURCE_FAMILY[s])).size,
      sources: [...new Set(r.sources.map((s) => SOURCE_FAMILY[s]))].sort() as LabRadarFamily[],
      waveN: r.wave,
      waveStartedAt: r.wave > 1 ? iso(waveStart) : null,
      windowState: r.state,
      windowOpensAt: opens === null ? null : iso(opens),
      windowClosingAt: opens === null ? null : iso(opens + span.open * HOUR),
      windowClosesAt: opens === null ? null : iso(opens + span.closing * HOUR),
      windowChangedAt: r.state ? iso(first) : null,
      windowReason: r.state === 'closing' ? 'The window clock is running out' : r.state ? 'confirmed' : null,
      windowLog: r.state ? [{ at: iso(first), from: null, to: 'open', reason: 'confirmed' }, ...(r.state === 'closing' ? [{ at: iso(first + 72 * HOUR), from: 'open' as const, to: 'closing' as const, reason: 'The window clock is running out' }] : [])] : [],
      createdAt: iso(first),
      updatedAt: iso(T),
    });
    events.push(e);
    r.sources.forEach((source, i) => {
      const seen = first + i * 20 * 60_000;
      pings.push({
        id: `${source}:fx-rf-${r.n}-${i}`, source, family: SOURCE_FAMILY[source], externalId: `fx-rf-${r.n}-${i}`, eventId: id, matchRule: 'key', name: r.name, nameKey: canonicalKey(r.name),
        title: source === 'vendor' ? `Introducing ${r.name}` : `${r.name} launch thread`, url: `https://example.com/lab-sample/radar/${r.n}/${source}`, author: null, vendor: 'Sample Labs',
        sourceTime: iso(seen), firstSeenAt: iso(seen), lastSeenAt: iso(T), prevSeenAt: null, metricFirst: 120, metricPrev: null, metricLast: 120 + 40 * r.n, rank: i + 1,
        velocityPerH: 30 + 5 * r.n, robustZ: null, isLaunch: source === 'vendor', isBaseline: false, qualifies: true, qualifyReason: source === 'vendor' ? 'Vendor: launch post' : 'HN: 160 points',
        fakeStar: source === 'github' ? false : null, fakeStarInfo: null, lexicon: true, dry: true,
      });
    });
    if (r.covered) coverage.push({ eventId: id, creators: r.covered, active: 14 });
  }
  return { events, pings, coverage };
}

/**
 * Filming only: persist the fixtures with dry = 1 when the demo world has no Radar rows yet
 * (the 08.7.2 world already carries E1 to E8, so this is a no-op there).
 */
export function persistRadarFixtures(store: LabStore, now: Date): { events: number; pings: number } {
  if (store.events.all().length) return { events: 0, pings: 0 };
  const f = radarFixtures(now);
  store.transaction(() => {
    for (const e of f.events) store.events.upsert(e);
    for (const p of f.pings) store.eventPings.upsert(p);
  });
  return { events: f.events.length, pings: f.pings.length };
}
