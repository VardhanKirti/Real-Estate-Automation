import { describe, expect, test } from 'vitest';
import { DRIFT_INSIGHTS, DriftInsightSchema, type DriftInsight } from '@/lib/drift';

const validInsight: DriftInsight = {
  id: 'drift-fixture-1',
  claim: 'Canon says X, three recent touches say Y.',
  occurrences: [
    { source: 'Calls/fixture-a.md', speaker: 'A. Fixture', date: '2026-08-01', excerpt: 'Said Y in call one.' },
    { source: 'Calls/fixture-b.md', speaker: 'B. Fixture', date: '2026-08-02', excerpt: 'Said Y in call two.' },
    { source: 'Calls/fixture-c.md', speaker: 'C. Fixture', date: '2026-08-03', excerpt: 'Said Y in call three.' },
  ],
  canon: { file: 'Canon/fixture.md', passage: 'Canon says X.' },
  confidence: 'high',
  state: 'new',
  detectedAt: '2026-08-31',
};

describe('DriftInsightSchema', () => {
  test('validates a well-formed insight', () => {
    expect(() => DriftInsightSchema.parse(validInsight)).not.toThrow();
  });

  test('rejects an insight with fewer than 3 occurrences', () => {
    const bad = { ...validInsight, occurrences: validInsight.occurrences.slice(0, 2) };
    expect(() => DriftInsightSchema.parse(bad)).toThrow();
  });

  test('rejects an unknown confidence value', () => {
    const bad = { ...validInsight, confidence: 'certain' };
    expect(() => DriftInsightSchema.parse(bad)).toThrow();
  });

  test('rejects an unknown state value', () => {
    const bad = { ...validInsight, state: 'archived' };
    expect(() => DriftInsightSchema.parse(bad)).toThrow();
  });

  test('rejects an empty canon file path', () => {
    const bad = { ...validInsight, canon: { ...validInsight.canon, file: '' } };
    expect(() => DriftInsightSchema.parse(bad)).toThrow();
  });

  test('rejects an occurrence missing a field', () => {
    const bad = { ...validInsight, occurrences: [{ ...validInsight.occurrences[0], excerpt: '' }, validInsight.occurrences[1], validInsight.occurrences[2]] };
    expect(() => DriftInsightSchema.parse(bad)).toThrow();
  });
});

describe('DRIFT_INSIGHTS (live)', () => {
  test('is an array', () => {
    expect(Array.isArray(DRIFT_INSIGHTS)).toBe(true);
  });

  test('every element, if any, passes the schema', () => {
    for (const insight of DRIFT_INSIGHTS) {
      expect(() => DriftInsightSchema.parse(insight)).not.toThrow();
    }
  });

  test('ids are unique', () => {
    const ids = DRIFT_INSIGHTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
