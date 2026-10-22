import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sendRangeFor, sendSpanMs, SEND_RANGES } from '@/lib/brand-deals-view';
import { filterDeals, parseDealQuery } from '@/components/brand-deals/use-deal-board';
import { G_READY, G_TREE_FILES } from '@/lib/g-ready';
import type { Deal } from '@/lib/brand-deals';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const deal = (over: Partial<Deal>): Deal => ({
  id: 'd', brand: 'Acme', email: 'a@acme.example', subject: '', tag: 'NORMAL', tagReason: '', chainLen: 1, summary: null, chain: [],
  stage: 'approval', lastEventAt: null, quotedUsd: null, quoteSource: null, outcome: 'open', ...over,
});

describe('send activity ranges (S02 FR-B4)', () => {
  test('the smallest range that holds an event', () => {
    expect(sendRangeFor([{ at: at(2 * 3600_000) }], NOW)).toBe('24h');
    expect(sendRangeFor([{ at: at(3 * DAY) }], NOW)).toBe('7d');
    expect(sendRangeFor([{ at: at(20 * DAY) }, { at: at(40 * DAY) }], NOW)).toBe('30d');
  });
  test('older history falls back to all, and nothing at all to 24 h', () => {
    expect(sendRangeFor([{ at: at(47 * DAY) }], NOW)).toBe('all');
    expect(sendRangeFor([], NOW)).toBe('24h');
  });
  test('the all span reaches past the oldest event', () => {
    expect(sendSpanMs('7d', [], NOW)).toBe(SEND_RANGES['7d'].spanMs);
    const span = sendSpanMs('all', [{ at: at(50 * DAY) }, { at: at(47 * DAY) }], NOW);
    expect(span).toBeGreaterThan(50 * DAY);
    expect(span).toBeLessThan(53 * DAY);
  });
});

describe('deal filters (FR-B1, FR-B5)', () => {
  const deals = [
    deal({ id: 'a', stage: 'approval', chainLen: 1 }),
    deal({ id: 'b', stage: 'sent', chainLen: 3, tag: 'UNIQUE', brand: 'Sol Vantage' }),
    deal({ id: 'c', stage: 'closed', outcome: 'won', chainLen: 12 }),
    deal({ id: 'd', stage: 'closed', outcome: 'lost', chainLen: 5 }),
  ];
  const ids = (ds: Deal[]) => ds.map((d) => d.id);
  test('stage, token, text and depth combine', () => {
    expect(ids(filterDeals(deals, 'closed', '', null))).toEqual(['c', 'd']);
    expect(ids(filterDeals(deals, 'won', '', null))).toEqual(['c']);
    expect(ids(filterDeals(deals, 'all', '/unique', null))).toEqual(['b']);
    expect(ids(filterDeals(deals, 'all', 'sol', null))).toEqual(['b']);
    expect(ids(filterDeals(deals, 'all', '', '2-3'))).toEqual(['b']);
    expect(ids(filterDeals(deals, 'all', '', '10+'))).toEqual(['c']);
  });
  test('an unknown slash token filters nothing but stays visible', () => {
    expect(parseDealQuery('/nope acme')).toEqual({ token: '/nope', tokenFilter: null, text: 'acme' });
  });
});

describe('the GladOS tree (X5, GP4, house rules)', () => {
  const src = read('components/brand-deals/DealBoardG.tsx');
  test('is registered for the guard', () => {
    expect(G_READY).toContain('/brand-deals');
    expect(G_TREE_FILES['/brand-deals']).toContain('components/brand-deals/DealBoardG.tsx');
  });
  test('the page forks on the appearance and the Classic board stays as it was', () => {
    const page = read('app/brand-deals/page.tsx');
    expect(page).toMatch(/treeFor\(getAppearance\(\), '\/brand-deals'\) === 'glados'/);
    expect(page).toContain('<DealBoard initial={snapshot}');
  });
  test('bdpilot not reporting routes to setup (H7)', () => {
    expect(src).toMatch(/bdpilot is not reporting[\s\S]{0,300}setupHref="\/setup"/);
  });
  test('no raw controls, no colour literals, no mono, no brand literal', () => {
    expect(src).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(src).not.toMatch(/font-mono|--font-mono/);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('GladOS');
  });
  test('the Telegram link only renders with BDPILOT_BOT_URL (H5)', () => {
    expect(src).toMatch(/\{botUrl && \(/);
  });
});
