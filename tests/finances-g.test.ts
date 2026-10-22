import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { G_READY, G_TREE_FILES } from '@/lib/g-ready';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** /finances under GladOS (glados-ui SPEC S02 §4.4, §5.7, AC02.21 to AC02.26). */
describe('finances GladOS tree', () => {
  const src = read('app/finances/FinancesG.tsx');
  const page = read('app/finances/page.tsx');

  test('one fetch, two trees; registered for the guard', () => {
    expect(page).toMatch(/treeFor\(getAppearance\(\), '\/finances'\) === 'glados'/);
    expect(page).toContain('<FinancesG {...props} />');
    expect(page).toContain('<FinancesClient {...props} />');
    expect(G_READY).toContain('/finances');
    expect(G_TREE_FILES['/finances']).toContain('app/finances/FinancesG.tsx');
  });

  test('the header carries no money figure, only the visibility toggle (AC02.22)', () => {
    const header = src.slice(src.indexOf('size="page"'), src.indexOf('Income by category'));
    expect(header).not.toMatch(/headlineTotal|netMonthly|usd\(/);
    expect(header).toContain('aria-pressed={hide}');
  });

  test('expenses: honest empty state, no bar list duplicate (AC02.23, AC02.25)', () => {
    expect(src).toMatch(/expensesSource === 'none' \? '—'/);
    expect(src).toContain('Upload a card CSV to see spend by category');
    expect(src).toContain('<GDonut');
    expect(src).not.toContain('maxCategory');
  });

  test('every unconfigured surface routes to setup (AC02.24, setup-links rule)', () => {
    expect(src).toContain('href={processorSetupHref(a.id)}');
    expect(src).toContain("href={processorSetupHref('stripe')}");
    expect(src).toMatch(/kind="unconfigured"[\s\S]{0,200}setupHref="\/integrations"/);
    expect(src).toContain('processorPeriodLabel(a, headlinePeriod)');
    expect(src).not.toContain('Connect →');
  });

  test('hide values reaches the chart, tiles and tips (AC02.26)', () => {
    expect(src).toContain('hideValues={hide}');
    expect(src).toMatch(/data-mask=\{hide \|\| undefined\}/);
    expect(src).toContain("'finances:hide-values'");
  });

  test('house rules: no raw controls, no literals, no mono, no brand literal', () => {
    expect(src).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(src).not.toMatch(/font-mono/);
    expect(code(src)).not.toContain('GladOS');
  });
});
