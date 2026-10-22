/**
 * The 13 seed calibration events of 05 9.4 (AND section 2.2), pulled from the Wikimedia API on
 * 2026-10-11. Frozen fixtures: the backtest never calls Wikimedia.
 *
 * The spec table records peak, pre_median, and the day-3 and day-7 shares of peak; the other
 * daily shares were not recorded and stay null rather than invented. The class rule reads only
 * baseline_share (= pre_median / peak) at 96 h and the day-7 share at 168 h.
 */
import type { LabEventClass } from '@/lib/schemas';
import { CLASS_RULE } from '@/lib/lab/radar/classify';

export type SeedEvent = {
  article: string;
  andClass: Exclude<LabEventClass, 'unknown'>;
  peak: number;
  preMedian: number;
  /** shares of peak on peak day + 0..7; null where the spec did not record the day */
  shares: [number, number | null, number | null, number, number | null, number | null, number | null, number];
};

const s = (d3: number, d7: number): SeedEvent['shares'] => [1, null, null, d3, null, null, null, d7];

export const SEED_EVENTS: readonly SeedEvent[] = [
  { article: 'DeepSeek', andClass: 'spike', peak: 860_907, preMedian: 2_316, shares: s(0.153, 0.077) },
  { article: 'Studio Ghibli', andClass: 'spike', peak: 179_862, preMedian: 4_269, shares: s(0.408, 0.142) },
  { article: 'OpenAI', andClass: 'spike', peak: 141_430, preMedian: 10_516, shares: s(0.305, 0.128) },
  { article: 'Sora (text-to-video model)', andClass: 'spike', peak: 13_783, preMedian: 0, shares: s(0.52, 0.225) },
  { article: 'Grok (chatbot)', andClass: 'spike', peak: 34_907, preMedian: 2_295, shares: s(0.33, 0.249) },
  { article: 'GPT-5', andClass: 'spike', peak: 11_835, preMedian: 16, shares: s(0.395, 0.183) },
  { article: 'Sora 2', andClass: 'spike', peak: 207, preMedian: 0, shares: s(0.585, 0.261) },
  { article: 'Vibe coding', andClass: 'adopted', peak: 30_248, preMedian: 15_143, shares: s(0.384, 0.523) },
  { article: 'Llama (language model)', andClass: 'adopted', peak: 2_320, preMedian: 958, shares: s(0.589, 0.326) },
  { article: 'OpenClaw', andClass: 'adopted', peak: 47_525, preMedian: 16_929, shares: s(0.513, 0.543) },
  { article: 'Claude (language model)', andClass: 'adopted', peak: 7_072, preMedian: 1_860, shares: s(0.45, 0.38) },
  { article: 'Manus (AI agent)', andClass: 'adopted', peak: 1_923, preMedian: 1_037, shares: s(0.713, 0.818) },
  { article: 'Agentic AI', andClass: 'adopted', peak: 1_630, preMedian: 1_319, shares: s(0.353, 0.933) },
];

/** The 9.2 rule on one seed row: the 96 h decision, then the 168 h recheck. */
export function seedRule(e: SeedEvent): Exclude<LabEventClass, 'unknown'> {
  const share = e.peak > 0 ? e.preMedian / e.peak : 0;
  let cls: Exclude<LabEventClass, 'unknown'> = share >= CLASS_RULE.baselineShare ? 'adopted' : 'spike';
  if (cls === 'spike' && e.shares[7] >= CLASS_RULE.day7Floor) cls = 'adopted';
  return cls;
}

export function backtestSeed(events: readonly SeedEvent[] = SEED_EVENTS): { correct: number; n: number; misses: string[] } {
  const misses = events.filter((e) => seedRule(e) !== e.andClass).map((e) => e.article);
  return { correct: events.length - misses.length, n: events.length, misses };
}
