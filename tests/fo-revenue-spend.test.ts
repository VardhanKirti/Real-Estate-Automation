/**
 * fo/revenue lane: F8 spend report on /finances
 * (docs/projects/founderos-ui/pages/feature-additions.md).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openLedger } from '@/lib/ledger';
import { OTHER_CATEGORY, merchantOf, monthWindow, sampleSpendRows, spendReport } from '@/lib/spend-report';
import { G_TREE_FILES } from '@/lib/g-ready';
import type { LedgerRow } from '@/lib/statements';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const row = (date: string, description: string, usd: number, category: string, direction: 'in' | 'out' = 'out'): LedgerRow => ({
  date, description, amountCents: Math.round(usd * 100), direction, category,
});

describe('spend report', () => {
  test('no outbound rows: null (the card shows its empty state, never a zero)', () => {
    expect(spendReport([])).toBeNull();
    expect(spendReport([row('2026-09-02', 'CLIENT PAYMENT', 900, 'Income', 'in')])).toBeNull();
  });

  test('six months ending at the latest uploaded month, by category, with month over month', () => {
    const r = spendReport([
      row('2026-09-03', 'VERCEL INC 4471', 200, 'Software'),
      row('2026-09-10', 'META ADS 1234', 1000, 'Advertising'),
      row('2026-08-03', 'VERCEL INC 4471', 100, 'Software'),
      row('2026-08-19', 'META ADS 9999', 700, 'Advertising'),
      row('2026-01-01', 'OLD THING', 50, 'Software'),
      row('2026-09-12', 'REFUND', 40, 'Income', 'in'),
    ])!;
    expect(r.months.map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(r.months[5]).toMatchObject({ total: 1200, byCategory: { Advertising: 1000, Software: 200 } });
    expect(r.months[0].total).toBe(0);
    expect(r.total).toBe(2000);
    expect(r.categories.map((c) => c.category)).toEqual(['Advertising', 'Software']);
    expect(r.mom).toEqual({ month: '2026-09', total: 1200, prevMonth: '2026-08', prevTotal: 800, deltaPct: 50 });
    expect(r.merchants[0]).toEqual({ merchant: 'Meta Ads', total: 1700, count: 2 });
    expect(r.txns.every((t) => t.date >= '2026-04')).toBe(true);
  });

  test('more than five categories roll the tail into Other; month parts sum to the month', () => {
    const cats = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const r = spendReport(cats.map((c, i) => row('2026-09-01', `SHOP ${c}`, 100 - i, c)))!;
    expect(r.keys).toEqual(['A', 'B', 'C', 'D', 'E', OTHER_CATEGORY]);
    const sep = r.months[5];
    expect(Object.values(sep.byCategory).reduce((a, b) => a + b, 0)).toBeCloseTo(sep.total, 5);
    expect(sep.byCategory[OTHER_CATEGORY]).toBe(94 + 95);
  });

  test('a single month has no month over month', () => {
    expect(spendReport([row('2026-09-01', 'X', 10, 'Software')])!.mom).toBeNull();
  });

  test('merchant names drop processor prefixes and reference numbers', () => {
    expect(merchantOf('SQ *CORNER CAFE 0042')).toBe('Corner Cafe');
    expect(merchantOf('UPWORK *ESCROW 2231')).toBe('Upwork Escrow');
    expect(merchantOf('123456')).toBe('123456');
    expect(monthWindow('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  test('the sample fixture fills six months', () => {
    const r = spendReport(sampleSpendRows(new Date('2026-10-12T12:00:00Z')))!;
    expect(r.months[5].month).toBe('2026-09');
    expect(r.months.every((m) => m.total > 0)).toBe(true);
  });

  test('ledger.spendRows returns outbound rows only, newest first, from a month', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spend-'));
    try {
      const l = openLedger(join(dir, 'ledger.db'));
      l.insertRows([row('2026-08-01', 'A', 5, 'Software'), row('2026-09-01', 'B', 6, 'Software'), row('2026-09-02', 'C', 7, 'Income', 'in')]);
      expect(l.spendRows().map((r) => r.description)).toEqual(['B', 'A']);
      expect(l.spendRows('2026-09').map((r) => r.description)).toEqual(['B']);
      l.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('spend report in both trees', () => {
  test('page: the ledger only, sample only for Filming or ?sample=1 on an empty ledger', () => {
    const page = read('app/finances/page.tsx');
    expect(page).toContain('spendReport(spendRows)');
    expect(page).toMatch(/filming \|\| \(!realSpend && searchParams\?\.sample === '1'\)/);
    expect(page).not.toMatch(/DECLARED_EXPENSES/);
  });

  test('empty state copy and the uploader link in both trees; GladOS uses the kit parts the spec names', () => {
    const g = read('app/finances/SpendingG.tsx');
    const c = read('app/finances/Spending.tsx');
    for (const src of [g, c]) {
      expect(src).toContain('Upload a statement to see spending.');
      expect(src).toContain('#statement-upload');
      expect(src).toMatch(/data-sample-badge|GSampleBadge/);
    }
    expect(g).toMatch(/GStackedBar/);
    expect(g).toMatch(/GList/);
    expect(g).toMatch(/GSheet/);
    expect(G_TREE_FILES['/finances']).toContain('app/finances/SpendingG.tsx');
    expect(read('app/finances/FinancesG.tsx')).toContain('<SpendingG spend={spend} hide={hide} />');
    expect(read('app/finances/FinancesClient.tsx')).toContain('<Spending spend={spend} hide={hideValues} />');
  });
});
