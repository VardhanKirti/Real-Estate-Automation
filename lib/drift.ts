import { z } from 'zod';

/**
 * Canon drift: contradictions between what the knowledge canon says and what
 * gets said in incoming context (sales calls, threads). The detection
 * pipeline that would diff live transcripts against the brain store doesn't
 * run yet, so there are no insights to show — this module just carries the
 * schema the real pipeline will eventually fill.
 */

export const DriftConfidenceSchema = z.enum(['high', 'medium']);
export type DriftConfidence = z.infer<typeof DriftConfidenceSchema>;

export const DriftStateSchema = z.enum(['new', 'reviewed', 'resolved']);
export type DriftState = z.infer<typeof DriftStateSchema>;

export const DriftOccurrenceSchema = z.object({
  source: z.string().min(1),
  speaker: z.string().min(1),
  date: z.string().min(1),
  excerpt: z.string().min(1),
});
export type DriftOccurrence = z.infer<typeof DriftOccurrenceSchema>;

export const DriftCanonRefSchema = z.object({
  file: z.string().min(1),
  passage: z.string().min(1),
});
export type DriftCanonRef = z.infer<typeof DriftCanonRefSchema>;

export const DriftInsightSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  occurrences: z.array(DriftOccurrenceSchema).min(3),
  canon: DriftCanonRefSchema,
  confidence: DriftConfidenceSchema,
  state: DriftStateSchema,
  detectedAt: z.string().min(1),
});
export type DriftInsight = z.infer<typeof DriftInsightSchema>;

/**
 * No drift detection pipeline runs against the live brain store yet, so
 * there are no insights to show. DriftRail renders its honest empty state
 * for this.
 */
export const DRIFT_INSIGHTS: DriftInsight[] = [];
