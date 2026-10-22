import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * glados-ui SPEC S05 AC05.1, AC05.2 (lane K source scan, §3.5.3).
 * AC05.1: the GladOS trees of the Knowledge and System pages use none of the
 * old recipes (glass panels and labels, c-btn, the -t radii, terminal
 * SectionHead). AC05.2: GBrainRadial and DriftRail hold no colour literal;
 * a token with an alpha, `rgb(var(--token) / a)`, is allowed.
 */
const root = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

const G_TREES = [
  'components/setup/SetupG.tsx',
  'components/setup/SetupControlsG.tsx',
  'components/login/LoginG.tsx',
  'components/compute/ComputeG.tsx',
  'components/integrations/WhatsAppG.tsx',
  'components/integrations/ConnectFlowG.tsx',
  'components/integrations/ConnectionsG.tsx',
  'components/integrations/CategoryG.tsx',
  'components/integrations/ApiKeysG.tsx',
  'components/knowledge/DriftG.tsx',
  'components/knowledge/KnowledgeG.tsx',
  'components/knowledge/FocusG.tsx',
  'components/knowledge/KnowledgeAbout.tsx',
  'components/database/DatabaseG.tsx',
  'components/brain/BrainG.tsx',
  'components/brain/BrainAbout.tsx',
  'components/system-g/AboutButton.tsx',
  'components/system-g/style-context.tsx',
];

const OLD_RECIPES = /glass-panel|glass-label|c-btn|rounded-(lg|md|sm)-t\b|\bSectionHead\b|from '@\/components\/terminal'/;
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;

describe('lane K GladOS trees (AC05.1)', () => {
  for (const f of G_TREES) {
    it(`${f} uses no old recipe and no colour literal`, () => {
      const src = read(f);
      const lines = src.split('\n');
      const hits = lines
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter(({ l }) => OLD_RECIPES.test(l) || LITERAL.test(l))
        .map(({ l, i }) => `${f}:${i} ${l.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('shared engines hold no colour literal (AC05.2)', () => {
  for (const f of ['components/GBrainRadial.tsx', 'components/knowledge/DriftRail.tsx']) {
    it(f, () => {
      const hits = read(f)
        .split('\n')
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => LITERAL.test(l))
        .map(({ l, i }) => `${f}:${i} ${l.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('lane K GladOS honesty', () => {
  it('Drift never claims to route the draft (AC05.13, H35)', () => {
    expect(read('components/knowledge/DriftG.tsx')).not.toContain('Routes to approval queue');
    expect(read('components/knowledge/DriftG.tsx')).toContain('DRAFT_FOOTER');
  });

  it('Drift shows no actions for an insight without a proposed fix (edge 9)', () => {
    expect(read('components/knowledge/DriftG.tsx')).toMatch(/\{fix && \(\s*<>\s*<GButton[^]*Update canon/);
  });

  it('/brain names no remembered counts (AC05.4)', () => {
    for (const f of ['components/brain/BrainG.tsx', 'app/brain/page.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/v0\.41|'1240|15k chunks/);
    }
  });

  it('/knowledge has no avg connections stat (AC05.12)', () => {
    expect(code(read('components/knowledge/KnowledgeG.tsx'))).not.toMatch(/avg connections|avgDegree/i);
  });

  it('the style label is never a GladOS literal in lane K trees (§3.6)', () => {
    for (const f of G_TREES) expect(code(read(f)), f).not.toMatch(/>[^<{]*GladOS|'GladOS'|"GladOS"/);
  });
});
