/**
 * Spend report for /finances (FounderOS merge F8, FO `ExpenditureReport` +
 * `MonthlyExpenses` + `spend-report.ts`). Expenses by category per month, top
 * merchants and month over month, from the uploaded card statement ledger
 * (lib/ledger.ts, rows already categorised by lib/statements.ts). Pure.
 *
 * Honest or absent: no declared or seeded expense fallback (FO's
 * DECLARED_EXPENSES is not ported). Bank statement PDFs are parsed to monthly
 * totals only (lib/bank-statements.ts) with no line items or categories, and
 * their debits include the card payments already in the ledger, so they are
 * left out rather than double counted. The window ends at the latest uploaded
 * month, not today, so a gap in uploads never reads as zero spend.
 */
import type { LedgerRow } from '@/lib/statements';

export const SPEND_MONTHS = 6;
/** Categories drawn as their own stack part; the rest roll into Other. */
export const SPEND_TOP_CATEGORIES = 5;
export const OTHER_CATEGORY = 'Other';

export type SpendTxn = { date: string; description: string; usd: number; category: string; merchant: string };
export type SpendMonth = { month: string; label: string; total: number; byCategory: Record<string, number> };
export type SpendCategory = { category: string; total: number; share: number; count: number };
export type SpendMerchant = { merchant: string; total: number; count: number };
export type SpendReport = {
  months: SpendMonth[];
  /** every category in the window, largest first */
  categories: SpendCategory[];
  /** the stacked bar's keys: the top categories plus Other when anything rolls up */
  keys: string[];
  merchants: SpendMerchant[];
  total: number;
  /** latest month against the one before; null when there is no earlier month with spend */
  mom: { month: string; total: number; prevMonth: string; prevTotal: number; deltaPct: number | null } | null;
  /** the window's transactions, newest first, for the per-category sheet */
  txns: SpendTxn[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m - 1) % 12]} ${String(y).slice(2)}`;
}

/** The `count` calendar months ending at `last` (YYYY-MM), oldest first. */
export function monthWindow(last: string, count = SPEND_MONTHS): string[] {
  const [y, m] = last.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** A card descriptor reduced to a merchant name: no reference numbers, processor prefixes or store ids. */
export function merchantOf(description: string): string {
  const cleaned = description
    .replace(/^(sq|tst|pp|paypal|sp|py)\s*\*\s*/i, '')
    .replace(/[*#]/g, ' ')
    .replace(/\b[\w.-]*\d[\w.-]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3);
  if (words.length === 0) return description.trim() || 'Unknown';
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Null when there is no outbound row: the card shows its empty state. */
export function spendReport(rows: readonly LedgerRow[], months = SPEND_MONTHS): SpendReport | null {
  const out = rows.filter((r) => r.direction === 'out' && /^\d{4}-\d{2}/.test(r.date) && r.amountCents > 0);
  if (out.length === 0) return null;
  const last = out.reduce((m, r) => (r.date.slice(0, 7) > m ? r.date.slice(0, 7) : m), '0000-00');
  const window = monthWindow(last, months);
  const inWindow = out.filter((r) => r.date.slice(0, 7) >= window[0]);

  const txns: SpendTxn[] = inWindow
    .map((r) => ({ date: r.date, description: r.description, usd: r.amountCents / 100, category: r.category, merchant: merchantOf(r.description) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.usd - a.usd);
  const total = round2(txns.reduce((n, t) => n + t.usd, 0));

  const catTotals = new Map<string, { total: number; count: number }>();
  const merchTotals = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    const c = catTotals.get(t.category) ?? { total: 0, count: 0 };
    c.total += t.usd;
    c.count++;
    catTotals.set(t.category, c);
    const m = merchTotals.get(t.merchant) ?? { total: 0, count: 0 };
    m.total += t.usd;
    m.count++;
    merchTotals.set(t.merchant, m);
  }
  const categories: SpendCategory[] = [...catTotals.entries()]
    .map(([category, c]) => ({ category, total: round2(c.total), count: c.count, share: total > 0 ? c.total / total : 0 }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  const top = categories.slice(0, SPEND_TOP_CATEGORIES).map((c) => c.category);
  const keys = categories.length > SPEND_TOP_CATEGORIES ? [...top, OTHER_CATEGORY] : top;

  const monthsOut: SpendMonth[] = window.map((month) => {
    const byCategory: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    let sum = 0;
    for (const t of txns) {
      if (t.date.slice(0, 7) !== month) continue;
      const k = top.includes(t.category) ? t.category : OTHER_CATEGORY;
      byCategory[k] = round2((byCategory[k] ?? 0) + t.usd);
      sum += t.usd;
    }
    return { month, label: monthLabel(month), total: round2(sum), byCategory };
  });

  const merchants: SpendMerchant[] = [...merchTotals.entries()]
    .map(([merchant, m]) => ({ merchant, total: round2(m.total), count: m.count }))
    .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant))
    .slice(0, 5);

  const cur = monthsOut[monthsOut.length - 1];
  const prev = [...monthsOut].reverse().slice(1).find((m) => m.total > 0);
  const mom = prev
    ? { month: cur.month, total: cur.total, prevMonth: prev.month, prevTotal: prev.total, deltaPct: prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 1000) / 10 : null }
    : null;

  return { months: monthsOut, categories, keys, merchants, total, mom, txns };
}

/** What the page hands both trees. */
export type SpendCard = { state: 'none' } | { state: 'ready'; sample: boolean; report: SpendReport };

/**
 * Filming and `?sample=1` fixture: six months of invented card spend ending
 * last month. A response, never a ledger row; always shown with the Sample badge.
 */
export function sampleSpendRows(now: Date = new Date()): LedgerRow[] {
  const plan: [string, string, number][] = [
    ['Software', 'NORTHBEAM ANALYTICS', 412],
    ['Software', 'LINEAR APP', 96],
    ['Software', 'VERCEL INC', 240],
    ['Advertising', 'META ADS 4471', 1850],
    ['Contractors', 'UPWORK *ESCROW 2231', 2200],
    ['Travel', 'DELTA AIR 0062', 640],
    ['Meals', 'SQ *CORNER CAFE', 84],
    ['Office', 'WEWORK 118 MEMBERSHIP', 450],
  ];
  const rows: LedgerRow[] = [];
  for (let back = 6; back >= 1; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    plan.forEach(([category, description, base], i) => {
      if (category === 'Travel' && back % 2 === 0) return;
      const swing = 1 + (((back * 7 + i * 3) % 9) - 4) / 20;
      rows.push({ date: `${ym}-${String(3 + i * 3).padStart(2, '0')}`, description, amountCents: Math.round(base * swing * 100), direction: 'out', category });
    });
  }
  return rows;
}
