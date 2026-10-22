import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { THEMES } from '@/lib/theme';
import { GLOBALS_CSS, resolveColour, tokenMap } from './helpers/theme-css';

/**
 * S10 home responsive: source assertions for the layout engine, the token
 * contract and the honesty fixes. The visual sweep (widths x themes x dock x
 * sidebar) is scripts/home-responsive-audit.mjs.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HOME = read('components/Home6Console.tsx');
const CHART = read('components/Home6Chart.tsx');
const STRIP = read('components/FinancePipelineStrip.tsx');
const BLOCK = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('/* ── S10 home responsive'), GLOBALS_CSS.indexOf('/* ── end S10 home responsive ── */'));

describe('layout engine (FR-1 to FR-6)', () => {
  test('the viewport breakpoint is gone', () => {
    expect(HOME).not.toContain('max-[1250px]');
    expect(HOME).not.toContain('grid-cols-[320px_1fr_312px]');
  });

  test('home is a named size container with three tiers', () => {
    expect(BLOCK).toContain('container: home / inline-size');
    expect(BLOCK).toContain('@container home (min-width: 1184px)');
    expect(BLOCK).toContain('@container home (min-width: 640px)');
    expect(BLOCK).toContain('container: h6-card / inline-size');
    expect(HOME).toContain('h6-home');
  });

  test('DOM order is main, then left, then right', () => {
    const main = HOME.indexOf('h6-col h6-col-main');
    const left = HOME.indexOf('h6-col h6-col-left');
    const right = HOME.indexOf('h6-col h6-col-right');
    expect(main).toBeGreaterThan(-1);
    expect(main).toBeLessThan(left);
    expect(left).toBeLessThan(right);
  });

  test('the bottom padding clears the Wizard launcher', () => {
    expect(BLOCK).toMatch(/padding-bottom: calc\(48px \+ var\(--launcher-clear, 56px\)\)/);
    expect(GLOBALS_CSS).toMatch(/--launcher-clear: 56px/);
  });
});

describe('tokens only (AC10.13)', () => {
  test.each([
    ['components/Home6Console.tsx', HOME],
    ['components/Home6Chart.tsx', CHART],
    ['components/FinancePipelineStrip.tsx', STRIP],
  ])('%s has no raw hex or rgba', (_, src) => {
    // literal colours only: rgb(var(--mist-rgb) / a) is a token and stays allowed
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  });

  test('the freshness track no longer appends hex alpha to a var()', () => {
    expect(HOME).not.toContain('${s.color}55');
  });

  const map = tokenMap();
  const NEW = ['--h6-gold', '--h6-pink', '--h6-stale', '--h6-row-bg', '--h6-row-hover', '--h6-tooltip-shadow'];
  test.each([...THEMES])('%s defines every new --h6-* token', (theme) => {
    for (const t of NEW) {
      const own = map.get(':root')!.get(theme === 'console' ? 'base' : theme);
      expect(own?.has(t), `${theme} ${t}`).toBe(true);
    }
  });

  // CIEDE2000, for the "every pair of chart series is at least 20 apart" rule (S10 §5)
  function lab(hex: string): [number, number, number] {
    const n = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92));
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function deltaE([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
    const rad = Math.PI / 180;
    const cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const g = 0.5 * (1 - Math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7)));
    const [ap1, ap2] = [(1 + g) * a1, (1 + g) * a2];
    const [c1, c2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
    const h = (b: number, a: number) => ((Math.atan2(b, a) / rad) % 360 + 360) % 360;
    const [h1, h2] = [h(b1, ap1), h(b2, ap2)];
    let dh = h2 - h1;
    if (c1 * c2 === 0) dh = 0;
    else if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
    const lb = (L1 + L2) / 2;
    const cbp = (c1 + c2) / 2;
    const hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    const t = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
    const sl = 1 + (0.015 * (lb - 50) ** 2) / Math.sqrt(20 + (lb - 50) ** 2);
    const sc = 1 + 0.045 * cbp;
    const sh = 1 + 0.015 * cbp * t;
    const rt = -2 * Math.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
    const [x, y, z] = [(L2 - L1) / sl, (c2 - c1) / sc, dH / sh];
    return Math.sqrt(x * x + y * y + z * z + rt * y * z);
  }

  test.each([...THEMES])('%s chart series are at least 20 apart (CIEDE2000)', (theme) => {
    const series = ['--h6-gold', '--h6-teal', '--h6-indigo', '--h6-pink'].map((t) => [t, resolveColour(map, theme, t)!] as const);
    for (const [, v] of series) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    for (let i = 0; i < series.length; i++)
      for (let j = i + 1; j < series.length; j++) {
        const d = deltaE(lab(series[i][1]), lab(series[j][1]));
        expect(d, `${theme} ${series[i][0]} vs ${series[j][0]}`).toBeGreaterThanOrEqual(20);
      }
  });
});

describe('honest and functional (FR-8 to FR-22)', () => {
  test('Details reads the real port and journal mode', () => {
    expect(HOME).not.toContain('4100');
    expect(HOME).not.toContain("'sqlite · WAL'");
    expect(HOME).toContain('db.journalMode()');
    expect(HOME).toContain("headers().get('host')");
    expect(read('lib/db.ts')).toMatch(/journalMode: \(\): string =>/);
  });

  test('the inert "Operator console" label is gone (Q-HOME-1)', () => {
    expect(HOME).not.toContain('Operator console');
  });

  test('the finance strip takes its period from the caller', () => {
    expect(STRIP).toContain('period');
    expect(STRIP).not.toMatch(/of MTD|\} MTD|'MTD'\)/);
    expect(STRIP).toContain('/finances?category=');
    expect(HOME).toMatch(/financePeriod: 'MTD' \| 'YTD' = filming \? 'YTD' : 'MTD'/);
    expect(read('app/finances/FinancesClient.tsx')).toContain("searchParams?.get('category')");
  });

  test('every tile and row leads somewhere', () => {
    expect(HOME).toContain("href: '/drift'");
    expect(HOME).toContain("'/social/beehiiv'");
    expect(HOME).toContain('`/social/${c.key}`');
    expect(HOME).toContain('<HomeCopyValue');
    expect(HOME).toMatch(/s\.href \?/);
  });

  test('the chart draws at real pixels and reads by keyboard', () => {
    expect(CHART).toContain('ResizeObserver');
    expect(CHART).toContain('requestAnimationFrame');
    expect(CHART).toContain('bucketSeries');
    expect(CHART).toContain('ArrowLeft');
    expect(CHART).toContain('aria-live="polite"');
    expect(BLOCK).toMatch(/\.h6-chart-svg \{[^}]*touch-action: pan-y/);
  });

  test('honesty fixes H2 to H4 hold in the Classic console (SPEC §3.4, GP5)', () => {
    // H2: no hard-coded, always-green Live pill; the lead pill comes from statusPill.
    expect(HOME).not.toMatch(/>\s*Live\s*</);
    expect(HOME).toContain('statusPill(hero)');
    expect(HOME).toContain('{pill.text}');
    // H3: the Agents-live badge counts every active agent, not the 4-row slice.
    expect(HOME).not.toContain('{liveAgents.length}\n');
    expect(HOME).toMatch(/title=\{`\$\{activeAgents\} of/);
    expect(HOME).toContain('+{moreLive} more');
    // H4: a zero run count is explained by when the newest run happened.
    expect(HOME).toContain('db.agentRuns.latest()');
    expect(HOME).toContain('lastRunCaption(');
  });

  test('empty states carry a SetupLink (honest or absent)', () => {
    expect(HOME).toMatch(/No agents live\s*<SetupLink/);
    expect(HOME).toMatch(/No posting or comms history yet\s*<SetupLink/);
    expect(HOME).toMatch(/No audience history yet\s*<SetupLink/);
    expect(HOME).toMatch(/Brain store not mounted\s*<SetupLink/);
  });
});
