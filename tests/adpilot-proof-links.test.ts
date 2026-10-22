import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adStore } from '@/lib/foreplay/store';
import { readSavedAds, saveAd } from '@/lib/foreplay/saved';
import { readWatchEntries } from '@/lib/foreplay/watchlist';
import { storeAdById, storeWall, toWallAd } from '@/lib/foreplay/wall';
import type { ForeplayAd } from '@/lib/foreplay/client';
import type { Signal } from '@/lib/foreplay/signals';
import { adpilotHref, findLinkedAd, isLinkId, proofLibraryLinks, signalLink, type AdpilotLink } from '@/lib/adpilot-links';

/**
 * SPEC G2 ACG2.3: every Proof library row in the Creative Engine lands on the
 * matching ad or brand in AdPilot. The rows come from proofLibraryLinks (what
 * the drawer renders); they are resolved the way the AdPilot page does it:
 * the capped wall, saved ads, then the store lookup for an ?ad= outside the
 * wall; brands from the watchlist. The browser half of the same check is
 * the Playwright run named in the Phase 4 report.
 */

const WALL_CAP = 80; // app/adpilot/page.tsx storeWall(80)

/** What /adpilot?ad= or ?brand= opens for this link, mirroring page.tsx + AdLibrary. */
function landsOn(link: AdpilotLink): boolean {
  const wall = storeWall(WALL_CAP);
  const saved = readSavedAds().map((s) => s.ad);
  if (link.kind === 'brand') return readWatchEntries().some((w) => w.id === link.id);
  const linked = isLinkId(link.id) && !findLinkedAd(link.id, [wall, saved]) ? storeAdById(link.id) : null;
  return findLinkedAd(link.id, [wall, saved, linked ? [linked] : null])?.id === link.id;
}

const DAY = 86_400;
const ad = (id: string, brandId: string, days: number): ForeplayAd => ({ id, brand_id: brandId, live: true, running_duration: { seconds: days * DAY } } as unknown as ForeplayAd);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-links-'));
  process.env.ADSCOUT_STORE_DIR = dir;
});
afterEach(() => {
  delete process.env.ADSCOUT_STORE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ACG2.3: Proof library rows land on the right AdPilot item', () => {
  function seed() {
    adStore.writeWatchlist([
      { id: 'brand-a', name: 'Northwind Tools', addedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'brand-b', name: 'Kestrel Systems', addedAt: '2026-10-01T00:00:00.000Z' },
    ] as never);
    // 100 long runners fill the 80-ad wall; the fresh launch ranks below the cap.
    adStore.writeBrandAds('brand-a', [...Array.from({ length: 100 }, (_, i) => ad(`a-${i}`, 'brand-a', 30 + i)), ad('a-fresh', 'brand-a', 0)]);
    adStore.writeBrandAds('brand-b', [ad('b-1', 'brand-b', 12)]);
    saveAd(toWallAd(ad('b-1', 'brand-b', 12), 'Kestrel Systems'));
    const signals: Signal[] = [
      { type: 'new_launch', brandId: 'brand-a', brandName: 'Northwind Tools', adId: 'a-fresh', message: 'Northwind Tools launched a new ad', at: '2026-10-08T10:00:00.000Z' },
      { type: 'winner', brandId: 'brand-a', brandName: 'Northwind Tools', adId: 'a-99', message: 'Northwind Tools: an ad passed 60 days live', at: '2026-10-08T09:00:00.000Z' },
      { type: 'velocity_spike', brandId: 'brand-b', brandName: 'Kestrel Systems', message: 'Kestrel Systems doubled its live ads', at: '2026-10-08T08:00:00.000Z' },
    ];
    return signals;
  }

  test('every row of a store with a fresh launch outside the wall resolves', () => {
    const signals = seed();
    const links = proofLibraryLinks(readSavedAds(), readWatchEntries(), signals);
    expect(links).toEqual([
      { kind: 'ad', id: 'b-1' },
      { kind: 'brand', id: 'brand-a' },
      { kind: 'brand', id: 'brand-b' },
      { kind: 'ad', id: 'a-fresh' },
      { kind: 'ad', id: 'a-99' },
      { kind: 'brand', id: 'brand-b' },
    ]);
    for (const l of links) expect(landsOn(l), `${l.kind}=${l.id}`).toBe(true);
  });

  test('the fresh launch is outside the capped wall, so only the store lookup finds it', () => {
    seed();
    expect(storeWall(WALL_CAP).some((a) => a.id === 'a-fresh')).toBe(false);
    expect(storeAdById('a-fresh')).toMatchObject({ id: 'a-fresh', brand: 'Northwind Tools' });
    expect(storeAdById('nope')).toBeNull();
  });

  test('an ad or brand that is not stored does not land (AdPilot shows its toast instead)', () => {
    seed();
    expect(landsOn({ kind: 'ad', id: 'gone' })).toBe(false);
    expect(landsOn({ kind: 'brand', id: 'brand-z' })).toBe(false);
  });

  test('the committed Filming world: every Proof library row resolves', () => {
    const snap = path.join(process.cwd(), 'filming', 'demo-data', 'ad-intel');
    if (!fs.existsSync(snap)) return;
    process.env.ADSCOUT_STORE_DIR = snap; // read only
    const links = proofLibraryLinks(readSavedAds(), readWatchEntries(), adStore.readSignals().slice(0, 60));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(landsOn(l), `${l.kind}=${l.id}`).toBe(true);
  });
});

describe('link helpers', () => {
  test('hrefs, signal targets and id checks', () => {
    expect(adpilotHref({ kind: 'ad', id: 'x 1' })).toBe('/adpilot?ad=x%201');
    expect(adpilotHref({ kind: 'brand', id: 'b' })).toBe('/adpilot?brand=b');
    expect(signalLink({ adId: 'a', brandId: 'b' })).toEqual({ kind: 'ad', id: 'a' });
    expect(signalLink({ brandId: 'b' })).toEqual({ kind: 'brand', id: 'b' });
    expect(isLinkId('aiUq-9_x.1')).toBe(true);
    expect(isLinkId('<script>')).toBe(false);
    expect(isLinkId(['a'])).toBe(false);
  });
});
