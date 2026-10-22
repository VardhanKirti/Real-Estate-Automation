import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { DriftRail } from '@/components/knowledge/DriftRail';
import type { DriftInsight } from '@/lib/drift';

const SRC = readFileSync(join(process.cwd(), 'components/knowledge/DriftRail.tsx'), 'utf8');

const insight = (id: string): DriftInsight =>
  ({
    id,
    claim: 'Fictional claim',
    state: 'open',
    confidence: 'high',
    detectedAt: '2026-10-01',
    occurrences: [{ source: 'Calls/example-call.md', date: '2026-09-30', speaker: 'Rep', excerpt: 'Example' }],
    canon: { file: 'Sales/example.md', passage: 'Example passage' },
  }) as unknown as DriftInsight;

/**
 * GladOS UI H35 (S05 F05.42, edge 9, AC05.13): nothing on /drift sends or
 * writes. The draft says so and offers a Copy; insights with no proposed fix
 * show no action buttons.
 */
describe('/drift says nothing is sent (H35)', () => {
  test('no "Routes to approval queue" claim remains', () => {
    expect(SRC).not.toMatch(/Routes to approval queue/);
  });

  test('the draft footer says Not sent, links Comms, and offers Copy of the draft text', () => {
    expect(SRC).toMatch(/Not sent\. Copy it, or send from/);
    expect(SRC).toMatch(/<Link href="\/inbox"[^>]*>\s*Comms\s*<\/Link>/);
    expect(SRC).toMatch(/<CopyButton text=\{fix\.message\}/);
    expect(SRC).toMatch(/navigator\.clipboard\.writeText\(text\)/);
  });

  test('Update canon says it writes nothing and copies the new passage', () => {
    expect(SRC).toMatch(/Not written\. Copy the new passage/);
    expect(SRC).toMatch(/<CopyButton text=\{fix\.added\}/);
  });

  test('an insight with no proposed fix renders no action buttons (edge 9)', () => {
    const html = renderToStaticMarkup(createElement(DriftRail, { insights: [insight('drift-no-fix-fixture')] }));
    expect(html).toContain('Fictional claim');
    expect(html).not.toContain('Update canon');
    expect(html).not.toContain('Draft correction');
  });

  test('an insight with a proposed fix keeps both buttons', () => {
    const html = renderToStaticMarkup(createElement(DriftRail, { insights: [insight('drift-tier1-scope')] }));
    expect(html).toContain('Update canon');
    expect(html).toContain('Draft correction');
  });
});
