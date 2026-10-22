import fs from 'node:fs';
import { z } from 'zod';
import { DRIFT_INSIGHTS, DriftInsightSchema, type DriftInsight } from '@/lib/drift';
import { dataPath } from '@/lib/paths';

/**
 * Where drift insights come from until the detection pipeline runs: a
 * drift.json in the current data directory. The real data directory has
 * none, so production shows the honest not-configured state; demo-data/
 * carries the filming insights. A malformed file reads as empty, never as a
 * crash. Server-only (node:fs).
 */
export function readDriftInsights(file: string = dataPath('drift.json')): DriftInsight[] {
  try {
    return z.array(DriftInsightSchema).parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return DRIFT_INSIGHTS;
  }
}
