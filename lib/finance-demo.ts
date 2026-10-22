/**
 * FILMING DEMO shim — finance data (this clone only).
 *
 * `/finances` and the homepage finance widget both read live money
 * connectors (Stripe, Wise, FanBasis, bank-statement uploads) with an honest
 * "pending" fallback when a key or upload isn't there — same doctrine as
 * `lib/demo-mode.ts`. This clone has no real keys, so without a scripted
 * stand-in every section renders empty. This module is that stand-in: one
 * deterministic ~$631K YTD dataset, gated on `DEMO_MODE=1` the same way
 * `lib/demo-mode.ts` gates comms/social/connectors, and shared by both
 * surfaces so the homepage pipeline strip and the finances page always agree.
 *
 * Every dollar figure below is fixed by hand (not randomised) so the totals
 * are exactly reproducible: income-by-processor and income-by-business each
 * sum to `FINANCE_DEMO_TOTAL_USD` — see tests/finance-demo.test.ts.
 */
import { incomeAccounts, type IncomeAccount, type OutgoingTransfer } from '@/lib/finances';
import type { BusinessSeries } from '@/lib/bank-statements';

/** Headline figure — YTD revenue across every business + processor. */
export const FINANCE_DEMO_TOTAL_USD = 631_240;

// ── Income by processor — feeds the existing `incomeAccounts()` registry ────
// via its real override hooks (`liveIncomeUsd`), so the tested function in
// lib/finances.ts stays untouched. Six accounts, one deterministic figure
// each, summing to the headline total.
export const DEMO_STRIPE_YTD_USD = 354_820;
export const DEMO_PROCESSOR_YTD_USD: Record<string, number> = {
  paypal: 9_400,
  'fanbasis-1': 38_200, // venture one: a couple of installment-plan clients
  'fanbasis-2': 161_300, // venture two: cohort payments
  'wise-1': 42_900, // international deployment client, wired
  'wise-2': 24_620, // international deployment client, wired
};

const ALL_CONFIGURED: Record<string, boolean> = {
  stripe: true,
  paypal: true,
  'fanbasis-1': true,
  'fanbasis-2': true,
  'wise-1': true,
  'wise-2': true,
};

/** Every processor account, fully live, deterministic YTD income. */
export function demoIncomeAccounts(): IncomeAccount[] {
  return incomeAccounts({ connected: true, mtdUsd: DEMO_STRIPE_YTD_USD }, ALL_CONFIGURED, DEMO_PROCESSOR_YTD_USD);
}

/** Stripe balance tile — a current snapshot, distinct from YTD income. */
export const DEMO_STRIPE_AVAILABLE_USD = 48_250;
export const DEMO_STRIPE_PENDING_USD = 6_120;

// ── Income by business — bank-statement view, same two accounts already
// established in this demo world (see tests/bank-statements.test.ts,
// tests/bank.test.ts: 'General Operations' + 'Vantage'). Twelve trailing
// months, hand-fixed so credits sum to the headline total.
const MONTHS = [
  '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
] as const;

const GENERAL_OPS_CREDITS = [
  27_167, 30_563, 33_959, 29_431, 37_355, 40_750, 32_827, 44_146, 36_223, 38_487, 27_167, 32_825,
];
const GENERAL_OPS_DEBITS = [
  17_115, 19_255, 21_394, 18_542, 23_534, 25_672, 20_681, 27_812, 22_820, 24_247, 17_115, 20_680,
];
const VANTAGE_CREDITS = [
  14_022, 16_025, 20_031, 15_023, 19_029, 22_034, 17_026, 24_037, 19_029, 21_032, 15_023, 18_029,
];
const VANTAGE_DEBITS = [
  8_133, 9_294, 11_618, 8_713, 11_037, 12_780, 9_875, 13_941, 11_037, 12_199, 8_713, 10_457,
];

function series(business: string, credits: readonly number[], debits: readonly number[]): BusinessSeries {
  return {
    business,
    months: MONTHS.map((month, i) => {
      const creditsCents = credits[i] * 100;
      const debitsCents = debits[i] * 100;
      return { month, creditsCents, debitsCents, netCents: creditsCents - debitsCents };
    }),
  };
}

/** Income by business — deployment/agency retainers + course/community sales
    routed through General Operations, brand deals + the Vantage line through
    Vantage. Sorted the same way `businessSeries()` sorts (alphabetical). */
export function demoBusinessSeries(): BusinessSeries[] {
  return [
    series('General Operations', GENERAL_OPS_CREDITS, GENERAL_OPS_DEBITS),
    series('Vantage', VANTAGE_CREDITS, VANTAGE_DEBITS),
  ];
}

// ── Outgoing Wise transfers — a few contractor payments. ────────────────────
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export function demoWiseOutgoing(): OutgoingTransfer[] {
  return [
    { amountCents: 780_000, currency: 'USD', status: 'completed', created: hoursAgo(14), reference: 'Deployment engineering — sprint payment' },
    { amountCents: 420_000, currency: 'USD', status: 'completed', created: hoursAgo(56), reference: 'Video production — monthly retainer' },
    { amountCents: 215_000, currency: 'GBP', status: 'completed', created: hoursAgo(132), reference: 'Course support — cohort operations' },
  ];
}

// ── Recent income — Stripe. ──────────────────────────────────────────────
const minsAgo = (m: number) => Math.floor(Date.now() / 1000) - m * 60;

export function demoRecentStripeCharges(): { amount: number; currency: string; description: string; created: number }[] {
  return [
    { amount: 480_000, currency: 'usd', description: 'Northwind Logistics — deployment retainer', created: minsAgo(45) },
    { amount: 129_900, currency: 'usd', description: 'Cohort 14 enrollment', created: minsAgo(130) },
    { amount: 250_000, currency: 'usd', description: 'Vertex Freight — deployment retainer', created: minsAgo(210) },
    { amount: 900_000, currency: 'usd', description: 'Sol Vantage — sponsorship invoice', created: minsAgo(340) },
    { amount: 64_900, currency: 'usd', description: 'Cohort 14 enrollment', created: minsAgo(480) },
    { amount: 375_000, currency: 'usd', description: 'Halcyon Dental Group — deployment retainer', created: minsAgo(610) },
  ];
}

// ── Income by category — the same processor money above, regrouped by what
// it's actually for instead of who moved it. Stripe carries several
// businesses at once (deployment retainers, the course's Stripe-side
// enrollments, the odd sponsorship invoice, a slice of community/newsletter
// membership), so its YTD total is split by hand into those four buckets;
// every other processor maps to exactly one category. The split is fixed,
// not computed, so the figures stay exactly reproducible — see
// tests/finance-demo.test.ts. Feeds both the homepage pipeline widget and
// the /finances hero, so the two surfaces always agree.
const STRIPE_BY_CATEGORY_USD = {
  deployments: 244_910, // Northwind Logistics, Vertex Freight, Halcyon Dental + other retainers
  course: 69_910, // cohort enrollments booked on Stripe
  brandDeals: 20_000, // Sol Vantage sponsorship invoice + one-off placements
  community: 20_000, // Syndicate membership + small recurring seats
} as const;

export type IncomeCategory = { key: string; label: string; usd: number };

/** Income regrouped by category instead of processor — same dataset, same
    total (`FINANCE_DEMO_TOTAL_USD`), just summed a different way. */
export function demoIncomeCategories(): IncomeCategory[] {
  const stripeSum = Object.values(STRIPE_BY_CATEGORY_USD).reduce((a, b) => a + b, 0);
  if (stripeSum !== DEMO_STRIPE_YTD_USD) {
    // Keeps the category split honest if the Stripe total ever changes above.
    throw new Error('finance-demo: STRIPE_BY_CATEGORY_USD must sum to DEMO_STRIPE_YTD_USD');
  }
  return [
    {
      key: 'deployments',
      label: 'Deployments',
      usd:
        STRIPE_BY_CATEGORY_USD.deployments +
        DEMO_PROCESSOR_YTD_USD['wise-1'] +
        DEMO_PROCESSOR_YTD_USD['wise-2'] +
        DEMO_PROCESSOR_YTD_USD['fanbasis-1'],
    },
    {
      key: 'course',
      label: 'Course',
      usd: STRIPE_BY_CATEGORY_USD.course + DEMO_PROCESSOR_YTD_USD['fanbasis-2'],
    },
    {
      key: 'brand-deals',
      label: 'Brand deals',
      usd: STRIPE_BY_CATEGORY_USD.brandDeals + DEMO_PROCESSOR_YTD_USD.paypal,
    },
    {
      key: 'community',
      label: 'Community',
      usd: STRIPE_BY_CATEGORY_USD.community,
    },
  ];
}

// ── Monthly expenses — a plausible recurring-spend breakdown for a one-person
// AI-operator/agency stack: contractor payouts, the software/infra bill,
// paid acquisition, processor fees. Distinct from the income figures above —
// this is spend, not revenue, and never touches FINANCE_DEMO_TOTAL_USD. ────
export function demoExpensesByCategory(): { category: string; total: number }[] {
  return [
    { category: 'Contractor payouts', total: 18_400 },
    { category: 'Ads', total: 6_100 },
    { category: 'Software & infrastructure', total: 4_250 },
    { category: 'Payment processing fees', total: 2_890 },
  ];
}
