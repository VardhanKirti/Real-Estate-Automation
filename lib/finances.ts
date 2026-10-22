/**
 * Finances domain — pure, real-ready. Income flows through a processor/account
 * registry (Stripe wired today; PayPal, FanBasis ×2, Wise ×2 are honest pending
 * slots until their keys land). Expenses are seeded SAMPLE data until the
 * statement-ingestion engine (Phase 2) replaces them with parsed bank/CC rows.
 *
 * No faked money: an unwired account reports null income, never a zero that
 * reads as "earned nothing". The page renders pending honestly.
 */

import { INTEGRATIONS, setupHrefFor } from '@/lib/integrations-catalog';

// ── Income: processor / account registry ────────────────────────────────────

export type IncomeAccount = {
  id: string;
  processor: string; // 'Stripe' | 'PayPal' | 'FanBasis' | 'Wise'
  label: string; // display label, incl. the business for multi-account processors
  configured: boolean; // does this account have credentials in the env?
  live: boolean; // actually pulling real income right now (Stripe only, for now)
  income: number | null; // month-to-date income in USD (null = pending)
};

/** Recent outgoing transfer (e.g. Wise) — money the operator sent out. */
export type OutgoingTransfer = {
  amountCents: number;
  currency: string;
  status: string;
  created: string | number;
  reference?: string;
};

/**
 * Every processor the operator runs money through. Stripe carries its real
 * month-to-date income when connected; the rest are multi-account-ready slots
 * (two FanBasis slots, two Wise). `configured` flags
 * which accounts have keys in the env (from `configuredProcessors`); `live`
 * means a real pull is actually happening — true only for Stripe today, so a
 * key-set-but-not-yet-integrated account reads "key set", never a faked number.
 */
export function incomeAccounts(
  stripe: { connected: boolean; mtdUsd: number | null },
  configured: Record<string, boolean> = {},
  liveIncomeUsd: Record<string, number> = {},
): IncomeAccount[] {
  // Non-Stripe accounts light up when a real month-to-date income is supplied
  // (e.g. FanBasis via its customers API); otherwise they're honest pending.
  const account = (id: string, processor: string, label: string): IncomeAccount => {
    const live = liveIncomeUsd[id] != null;
    return {
      id,
      processor,
      label,
      configured: configured[id] ?? false,
      live,
      income: live ? liveIncomeUsd[id] : null,
    };
  };
  return [
    {
      id: 'stripe',
      processor: 'Stripe',
      label: 'Stripe',
      configured: configured.stripe ?? stripe.connected,
      live: stripe.connected,
      income: stripe.connected ? stripe.mtdUsd : null,
    },
    account('paypal', 'PayPal', 'PayPal'),
    account('fanbasis-1', 'FanBasis', 'FanBasis · Account 1'),
    account('fanbasis-2', 'FanBasis', 'FanBasis · Account 2'),
    account('wise-1', 'Wise', 'Wise · Account 1'),
    account('wise-2', 'Wise', 'Wise · Account 2'),
  ];
}

/** Total month-to-date income across accounts; pending (null) counts as zero. */
export function totalIncome(accounts: IncomeAccount[]): number {
  return accounts.reduce((sum, a) => sum + (a.income ?? 0), 0);
}

export type IncomeCategory = { key: string; label: string; usd: number };

/**
 * Real income-by-category derivation, shared by /finances and the home
 * widget: one column per processor account, using exactly the income
 * already pulled (pending/unconfigured accounts contribute $0, never a
 * faked figure). Sum-consistent with `totalIncome(accounts)` by
 * construction — same source array, same numbers. No category-tagged
 * ledger exists yet beyond the raw processor pulls, so this is the honest
 * grouping until one does.
 */
export function incomeCategories(accounts: IncomeAccount[]): IncomeCategory[] {
  return accounts.map((a) => ({ key: a.id, label: a.processor, usd: a.income ?? 0 }));
}

// ── Expenses: seeded sample until statement ingestion lands (Phase 2) ────────

export type ExpenseItem = { id: string; label: string; category: string; monthly: number };

/**
 * Placeholder recurring spend for an AI-operator / agency stack. Clearly a
 * Intentionally empty: no invented subscriptions. Real spend arrives via the
 * statement uploader into the local ledger (data/ledger.db).
 */
export const SAMPLE_EXPENSES: ExpenseItem[] = [];

/** Sum of every recurring monthly cost. */
export function totalExpenses(items: ExpenseItem[]): number {
  return items.reduce((sum, e) => sum + e.monthly, 0);
}

/** Per-category totals, largest first. */
export function expensesByCategory(items: ExpenseItem[]): { category: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const e of items) totals.set(e.category, (totals.get(e.category) ?? 0) + e.monthly);
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** Net monthly cash flow — income minus expenses (may be negative). */
export function net(income: number, expenses: number): number {
  return income - expenses;
}

// ── Honest expense source (SPEC S02 FR-N4, H9) ──────────────────────────────

/** Where the expense figures on /finances come from. `none` renders no figure. */
export type ExpensesSource = 'uploaded' | 'demo' | 'none';

/**
 * Picks the expense rows the page may show. An uploaded ledger always wins;
 * Filming shows the scripted demo set; otherwise there is nothing, and the
 * page says so instead of presenting seeded sample rows as real spend.
 */
export function expensesView(input: {
  ledgerSpend: { category: string; total: number }[];
  filming: boolean;
  demo: () => { category: string; total: number }[];
}): { source: ExpensesSource; byCategory: { category: string; total: number }[]; total: number } {
  const source: ExpensesSource = input.ledgerSpend.length > 0 ? 'uploaded' : input.filming ? 'demo' : 'none';
  const byCategory = source === 'uploaded' ? input.ledgerSpend : source === 'demo' ? input.demo() : [];
  return { source, byCategory, total: byCategory.reduce((s, c) => s + c.total, 0) };
}

// ── Processor cards (SPEC S02 FR-N7, H10, H11) ──────────────────────────────

/** The period suffix under a live processor's income: the page's headline
 *  period (MTD on real data, YTD in Filming), never a literal. */
export function processorPeriodLabel(
  account: { live: boolean; configured: boolean },
  headlinePeriod: string,
): string {
  if (account.live) return headlinePeriod;
  return account.configured ? 'pull pending' : 'awaiting key';
}

/** Where a not-configured processor's Set up link goes: its /integrations
 *  tile when the catalog has one (Stripe via its `payments` connector),
 *  otherwise the board. `fanbasis-1` → `fanbasis`, `wise-2` → `wise`. */
export function processorSetupHref(accountId: string): string {
  const base = accountId.replace(/-\d+$/, '');
  if (base === 'stripe') return setupHrefFor('payments');
  const entry = INTEGRATIONS.find((e) => e.slug === base);
  return entry ? `/integrations#${entry.slug}` : '/integrations';
}

// ── Stripe month-to-date helpers (pure; the connector feeds in raw charges) ──

/** Unix seconds for the first instant of `now`'s calendar month (UTC). */
export function monthStartUnix(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

/** Sum only the charges that actually settled (paid + succeeded). */
export function sumChargeIncome(
  charges: { amount: number; currency: string; paid: boolean; status: string }[],
): { amountCents: number; currency: string; count: number } {
  let amountCents = 0;
  let count = 0;
  let currency = 'usd';
  for (const c of charges) {
    if (c.paid && c.status === 'succeeded') {
      amountCents += c.amount;
      count += 1;
      currency = c.currency;
    }
  }
  return { amountCents, currency, count };
}
