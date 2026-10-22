import { describe, expect, test } from 'vitest';
import {
  FINANCE_DEMO_TOTAL_USD,
  DEMO_STRIPE_YTD_USD,
  DEMO_PROCESSOR_YTD_USD,
  demoIncomeAccounts,
  demoBusinessSeries,
  demoWiseOutgoing,
  demoRecentStripeCharges,
  demoIncomeCategories,
  demoExpensesByCategory,
} from '@/lib/finance-demo';
import { totalIncome } from '@/lib/finances';

describe('finance demo dataset', () => {
  test('income by processor sums to the headline total, exactly', () => {
    const total = totalIncome(demoIncomeAccounts());
    expect(total).toBe(FINANCE_DEMO_TOTAL_USD);
  });

  test('income by business sums within $1 of the headline total', () => {
    const total = demoBusinessSeries().reduce(
      (sum, series) => sum + series.months.reduce((s, m) => s + m.creditsCents, 0),
      0,
    );
    expect(Math.abs(total / 100 - FINANCE_DEMO_TOTAL_USD)).toBeLessThanOrEqual(1);
  });

  test('headline is a non-round, camera-ready figure', () => {
    expect(FINANCE_DEMO_TOTAL_USD).toBe(631_240);
    expect(FINANCE_DEMO_TOTAL_USD % 1000).not.toBe(0);
  });

  test('every processor account is live with a real demo figure', () => {
    const accounts = demoIncomeAccounts();
    expect(accounts).toHaveLength(6);
    for (const a of accounts) {
      expect(a.live).toBe(true);
      expect(a.income).toBeGreaterThan(0);
    }
  });

  test('income by business ships the two demo-world accounts, alphabetical', () => {
    const series = demoBusinessSeries();
    expect(series.map((s) => s.business)).toEqual(['General Operations', 'Vantage']);
    for (const s of series) {
      expect(s.months).toHaveLength(12);
      for (const m of s.months) {
        expect(m.netCents).toBe(m.creditsCents - m.debitsCents);
      }
    }
  });

  test('outgoing Wise transfers are a few contractor payments, all negative-facing', () => {
    const transfers = demoWiseOutgoing();
    expect(transfers.length).toBeGreaterThanOrEqual(2);
    expect(transfers.length).toBeLessThanOrEqual(6);
    for (const t of transfers) {
      expect(t.amountCents).toBeGreaterThan(0);
      expect(t.reference).toBeTruthy();
    }
  });

  test('recent Stripe charges are populated and ordered newest first', () => {
    const charges = demoRecentStripeCharges();
    expect(charges.length).toBeGreaterThan(0);
    for (let i = 1; i < charges.length; i++) {
      expect(charges[i].created).toBeLessThanOrEqual(charges[i - 1].created);
    }
  });

  test('income categories sum to the headline total, exactly', () => {
    const categories = demoIncomeCategories();
    const total = categories.reduce((sum, c) => sum + c.usd, 0);
    expect(total).toBe(FINANCE_DEMO_TOTAL_USD);
  });

  test('income categories are Deployments, Course, Brand deals, Community — each real and positive', () => {
    const categories = demoIncomeCategories();
    expect(categories.map((c) => c.label)).toEqual(['Deployments', 'Course', 'Brand deals', 'Community']);
    for (const c of categories) {
      expect(c.usd).toBeGreaterThan(0);
      expect(Number.isInteger(c.usd)).toBe(true);
    }
  });

  test('income categories are a real regrouping of the processor totals, not invented revenue', () => {
    const categoryTotal = demoIncomeCategories().reduce((sum, c) => sum + c.usd, 0);
    const processorTotal =
      DEMO_STRIPE_YTD_USD + Object.values(DEMO_PROCESSOR_YTD_USD).reduce((sum, v) => sum + v, 0);
    expect(categoryTotal).toBe(processorTotal);
  });

  test('monthly expenses are a plausible non-zero breakdown, separate from income', () => {
    const expenses = demoExpensesByCategory();
    expect(expenses.length).toBeGreaterThanOrEqual(3);
    const categories = expenses.map((e) => e.category);
    expect(new Set(categories).size).toBe(categories.length); // no duplicate categories
    for (const e of expenses) {
      expect(e.total).toBeGreaterThan(0);
    }
    const total = expenses.reduce((sum, e) => sum + e.total, 0);
    // Expenses are a monthly figure, well under the YTD income headline.
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(FINANCE_DEMO_TOTAL_USD);
  });
});
