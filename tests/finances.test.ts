import { describe, expect, test } from 'vitest';
import {
  incomeAccounts,
  totalIncome,
  totalExpenses,
  expensesByCategory,
  net,
  monthStartUnix,
  sumChargeIncome,
  SAMPLE_EXPENSES,
  expensesView,
  processorPeriodLabel,
  processorSetupHref,
} from '@/lib/finances';
import { INTEGRATIONS } from '@/lib/integrations-catalog';

describe('expensesView (H9, S02 FR-N4)', () => {
  const demo = () => [{ category: 'Software', total: 120 }];

  test("no ledger and not Filming: source 'none', no rows, no figure", () => {
    const v = expensesView({ ledgerSpend: [], filming: false, demo });
    expect(v).toEqual({ source: 'none', byCategory: [], total: 0 });
  });

  test('an uploaded ledger always wins, Filming or not', () => {
    const ledgerSpend = [{ category: 'Rent', total: 900 }, { category: 'Ads', total: 100 }];
    for (const filming of [false, true]) {
      const v = expensesView({ ledgerSpend, filming, demo });
      expect(v.source).toBe('uploaded');
      expect(v.byCategory).toBe(ledgerSpend);
      expect(v.total).toBe(1000);
    }
  });

  test('Filming without a ledger shows the scripted demo set', () => {
    const v = expensesView({ ledgerSpend: [], filming: true, demo });
    expect(v.source).toBe('demo');
    expect(v.total).toBe(120);
  });
});

describe('processor cards (H10, H11, S02 FR-N7)', () => {
  test('a live processor reads the page period, never a literal YTD', () => {
    expect(processorPeriodLabel({ live: true, configured: true }, 'MTD')).toBe('MTD');
    expect(processorPeriodLabel({ live: true, configured: true }, 'YTD')).toBe('YTD');
    expect(processorPeriodLabel({ live: false, configured: true }, 'MTD')).toBe('pull pending');
    expect(processorPeriodLabel({ live: false, configured: false }, 'MTD')).toBe('awaiting key');
  });

  test('every processor slot has a Set up target; catalogued ones deep-link to their tile', () => {
    expect(processorSetupHref('stripe')).toBe('/integrations#stripe');
    expect(processorSetupHref('paypal')).toBe('/integrations#paypal');
    expect(processorSetupHref('wise-1')).toBe('/integrations#wise');
    expect(processorSetupHref('wise-2')).toBe('/integrations#wise');
    for (const a of incomeAccounts({ connected: false, mtdUsd: null })) {
      const href = processorSetupHref(a.id);
      expect(href.startsWith('/integrations')).toBe(true);
      const slug = href.split('#')[1];
      if (slug) expect(INTEGRATIONS.some((e) => e.slug === slug)).toBe(true);
    }
  });
});

describe('incomeAccounts', () => {
  test('lists every processor slot (Stripe, PayPal, FanBasis×2, Wise×2)', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts).toHaveLength(6);
    expect(accounts.map((a) => a.id)).toEqual([
      'stripe',
      'paypal',
      'fanbasis-1',
      'fanbasis-2',
      'wise-1',
      'wise-2',
    ]);
  });

  test('Stripe goes live with its real month-to-date income when connected', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    const stripe = accounts.find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(true);
    expect(stripe.income).toBe(7000);
  });

  test('unwired processors are honest pending — null income, not a faked zero', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(accounts.find((a) => a.id === 'paypal')!.income).toBeNull();
    expect(accounts.find((a) => a.id === 'wise-1')!.live).toBe(false);
  });

  test('Stripe stays pending when not connected', () => {
    const stripe = incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(false);
    expect(stripe.income).toBeNull();
  });

  test('non-Stripe accounts derive `configured` from the passed config map (key set ≠ live pull)', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { paypal: true, 'wise-1': true });
    const paypal = accounts.find((a) => a.id === 'paypal')!;
    expect(paypal.configured).toBe(true); // key present
    expect(paypal.live).toBe(false); // but no real pull implemented yet
    expect(paypal.income).toBeNull(); // so never a faked number
    expect(accounts.find((a) => a.id === 'wise-1')!.configured).toBe(true);
    expect(accounts.find((a) => a.id === 'fanbasis-2')!.configured).toBe(false);
  });

  test('stripe.configured defaults to its connection state', () => {
    expect(incomeAccounts({ connected: true, mtdUsd: 100 }).find((a) => a.id === 'stripe')!.configured).toBe(true);
    expect(incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!.configured).toBe(false);
  });

  test('a non-Stripe account goes live with real income when passed in liveIncomeUsd', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { 'fanbasis-2': true }, { 'fanbasis-2': 3400 });
    const aa = accounts.find((a) => a.id === 'fanbasis-2')!;
    expect(aa.configured).toBe(true);
    expect(aa.live).toBe(true);
    expect(aa.income).toBe(3400);
    // others still pending
    expect(accounts.find((a) => a.id === 'paypal')!.live).toBe(false);
  });
});

describe('totalIncome', () => {
  test('sums live account income, treating pending (null) as zero', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(totalIncome(accounts)).toBe(7000);
  });
});

describe('expenses', () => {
  const fixture = [
    { id: 'a', label: 'A', category: 'Software', monthly: 20 },
    { id: 'b', label: 'B', category: 'Software', monthly: 30 },
    { id: 'c', label: 'C', category: 'Advertising', monthly: 100 },
  ];

  test('totalExpenses sums the monthly amounts', () => {
    expect(totalExpenses(fixture)).toBe(150);
  });

  test('expensesByCategory groups + sorts by total descending', () => {
    expect(expensesByCategory(fixture)).toEqual([
      { category: 'Advertising', total: 100 },
      { category: 'Software', total: 50 },
    ]);
  });

  test('SAMPLE_EXPENSES ships empty: real spend arrives via statement uploads', () => {
    expect(SAMPLE_EXPENSES).toEqual([]);
  });
});

describe('net', () => {
  test('income minus expenses, positive or negative', () => {
    expect(net(150, 100)).toBe(50);
    expect(net(100, 150)).toBe(-50);
  });
});

describe('Stripe month-to-date helpers', () => {
  test('monthStartUnix returns the first of the calendar month at 00:00 UTC', () => {
    const unix = monthStartUnix(new Date('2026-06-16T10:30:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('sumChargeIncome counts only paid + succeeded charges', () => {
    const result = sumChargeIncome([
      { amount: 5000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 2000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 9999, currency: 'usd', paid: false, status: 'failed' },
      { amount: 100, currency: 'usd', paid: true, status: 'pending' },
    ]);
    expect(result).toEqual({ amountCents: 7000, currency: 'usd', count: 2 });
  });
});
