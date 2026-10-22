import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { dataPath } from '@/lib/paths';

/**
 * The portfolio we send to brands.
 *
 * This is NOT the content studio's upload store (lib/content-uploads.ts) —
 * that one models local files we produced. These are published, public pieces
 * that live on Instagram/YouTube, kept here so an inbound brand can be
 * answered with the three examples that actually apply to them.
 *
 * The load-bearing field is `requires`. A "build a tool on their API" video is
 * unsendable to a brand with no API — it promises work we cannot do for them.
 * `fitsBrand()` makes that a deterministic check instead of a judgement call
 * made at 11pm while answering an email.
 *
 * Classification honesty: `analysisSource` records where the structured fields
 * came from. 'operator' means the operator described it; 'auto' means an enrichment
 * pass read a transcript. Fields that need someone to actually watch the video
 * (hookType) stay null rather than guessed. Server-only (node:fs).
 */

/** What a brand must have for a given example's format to be reproducible for them. */
export const BrandCapabilitySchema = z.enum([
  'api',      // a public API we can build against
  'mcp',      // an MCP server
  'github',   // an open-source repo worth a build video
  'cli',      // something installable/scriptable
  'web-app',  // a UI that can be screen-recorded — nearly everyone
]);
export type BrandCapability = z.infer<typeof BrandCapabilitySchema>;

export const ContentExampleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  platform: z.enum(['instagram', 'youtube', 'tiktok', 'other']),
  /** Who it was made for. null = organic/own-audience. */
  brand: z.string().nullable(),
  /** The positioning of the piece — the axis brands mean by "a different angle". */
  angle: z.enum([
    'tool-build',       // builds something live and gives it away
    'feature-demo',     // walks the product's functionality
    'review-opinion',   // talking-head take on a product
    'paid-ad',          // ran as an ad, not organic
    'showcase',         // "look what this does", light on build
  ]),
  format: z.enum(['screen-recording', 'talking-head', 'voiceover-broll', 'mixed']),
  /** Needs someone to watch the first seconds. Null until then — never guessed. */
  hookType: z.enum(['claim', 'question', 'result', 'contradiction']).nullable(),
  /** Brand capabilities the format depends on. Empty = works for any brand. */
  requires: z.array(BrandCapabilitySchema),
  ctaMechanism: z.enum(['manychat', 'link-in-bio', 'none']),
  /** ManyChat automation names in content-uploads proof screenshots, if linked. */
  manychatFlows: z.array(z.string()),
  clearance: z.enum(['public', 'ask-first', 'nda']),
  /** The operator's own words about the piece. The source of truth for the fields above. */
  notes: z.string(),
  analysisSource: z.enum(['operator', 'auto', 'pending']),
  createdAt: z.string().min(1),
});
export type ContentExample = z.infer<typeof ContentExampleSchema>;

/** A ManyChat automation's real numbers — the proof that sits behind the examples. */
export const ManychatRunSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['live', 'stopped']),
  runs: z.number().int().nonnegative(),
  ctrPct: z.number(),
  triggerKeyword: z.string(),
  /** Relative age as the dashboard reported it — we only have that, not a date. */
  ageLabel: z.string(),
  /** Filename in public/content-media/uploads/. */
  screenshot: z.string().min(1),
});
export type ManychatRun = z.infer<typeof ManychatRunSchema>;

/** One outreach: which examples went to whom, so we never resend the same three. */
export const ExampleSendSchema = z.object({
  id: z.string().min(1),
  sentAt: z.string().min(1),
  brand: z.string().min(1),
  recipient: z.string(),
  channel: z.enum(['email', 'dm', 'call']),
  /** bdpilot's thread id, so a send links back to the live negotiation. */
  dealId: z.string().nullable(),
  /** Gmail thread id for the same conversation. */
  threadId: z.string().nullable(),
  exampleIds: z.array(z.string()),
  manychatRunIds: z.array(z.string()),
  note: z.string(),
});
export type ExampleSend = z.infer<typeof ExampleSendSchema>;

const StoreSchema = z.object({
  examples: z.array(ContentExampleSchema),
  manychatRuns: z.array(ManychatRunSchema),
  sends: z.array(ExampleSendSchema),
});
export type ExamplesStore = z.infer<typeof StoreSchema>;

const EMPTY: ExamplesStore = { examples: [], manychatRuns: [], sends: [] };

export function examplesStorePath(): string {
  return process.env.CONTENT_EXAMPLES_PATH ?? dataPath('content-examples.json');
}

export function readExamples(file: string = examplesStorePath()): ExamplesStore {
  try {
    return StoreSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return EMPTY;
  }
}

export function writeExamples(store: ExamplesStore, file: string = examplesStorePath()): void {
  StoreSchema.parse(store);
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
}

// ------------------------------------------------------------------ the gate

export type FitVerdict = { fits: boolean; reason: string };

/**
 * Can this example be sent to this brand?
 *
 * The Emergent case: a web-only product with no API or MCP. A tool-build video
 * implies we would build against them, and we cannot, so it is withheld with a
 * reason rather than silently ranked low.
 */
export function fitsBrand(
  example: ContentExample,
  brand: { name: string; capabilities: BrandCapability[] },
): FitVerdict {
  const missing = example.requires.filter((r) => !brand.capabilities.includes(r));
  if (missing.length > 0) {
    return { fits: false, reason: `${brand.name} has no ${missing.join('/')} — this format is not reproducible for them` };
  }
  if (example.clearance === 'nda') {
    return { fits: false, reason: 'under NDA — cannot be shown outside the client' };
  }
  if (example.clearance === 'ask-first') {
    return { fits: true, reason: 'clear with the original client before sending' };
  }
  return { fits: true, reason: 'ok' };
}

/** Examples sendable to a brand, best-fitting first (most specific requirements win). */
export function selectForBrand(
  store: ExamplesStore,
  brand: { name: string; capabilities: BrandCapability[] },
): Array<{ example: ContentExample; verdict: FitVerdict }> {
  return store.examples
    .map((example) => ({ example, verdict: fitsBrand(example, brand) }))
    .filter((r) => r.verdict.fits)
    .sort((a, b) => b.example.requires.length - a.example.requires.length);
}

/** Headline proof numbers across every ManyChat automation. */
export function manychatTotals(store: ExamplesStore): { runs: number; avgCtrPct: number; flows: number } {
  const rows = store.manychatRuns;
  if (rows.length === 0) return { runs: 0, avgCtrPct: 0, flows: 0 };
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  // Weighted by runs — a 62% flow with 200 sends should not lift the headline.
  const weighted = rows.reduce((n, r) => n + r.ctrPct * r.runs, 0) / runs;
  return { runs, avgCtrPct: Math.round(weighted * 10) / 10, flows: rows.length };
}

/** Everything already sent to a brand, so a follow-up shows different work. */
export function alreadySentTo(store: ExamplesStore, brand: string): Set<string> {
  const seen = new Set<string>();
  for (const s of store.sends) {
    if (s.brand.toLowerCase() === brand.toLowerCase()) s.exampleIds.forEach((id) => seen.add(id));
  }
  return seen;
}
