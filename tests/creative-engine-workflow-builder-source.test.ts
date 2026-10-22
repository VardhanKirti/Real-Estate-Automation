import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * S05b source guards for the builder's space and wiring step: one native
 * wheel handler (no React onWheel, which is passive and can't stop page
 * zoom), pointer events instead of mouse-leave cancelling drags, no fixed
 * "expanded" offset (SPEC §5 C14), and tokens only in the builder files.
 */

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const builderFiles = ['components/creative-engine/WorkflowCanvas.tsx', 'components/creative-engine/SpendGate.tsx', ...fs.readdirSync(path.join(root, 'components/creative-engine/workflow')).map((f) => `components/creative-engine/workflow/${f}`)];

describe('workflow builder source', () => {
  const canvas = read('components/creative-engine/WorkflowCanvas.tsx');
  test('the stage wheel is one native non-passive listener', () => {
    expect(canvas).not.toMatch(/\bonWheel=\{/);
    expect(canvas).toMatch(/addEventListener\('wheel', [^)]*\{ passive: false \}\)/);
  });
  test('drags use pointer events with capture, never mouse-leave', () => {
    expect(canvas).not.toMatch(/onMouseLeave=\{onUp\}/);
    expect(canvas).toMatch(/setPointerCapture/);
  });
  test('the hard-coded expanded offset is gone; full screen is a token-layered portal', () => {
    const css = read('app/globals.css');
    expect(css).not.toMatch(/\.ae-o-graph\.wf\.expanded\s*\{/);
    expect(css).not.toMatch(/top:\s*112px/);
    expect(css).toMatch(/\.ae-o-wf-full \{[^}]*z-index: var\(--z-wf-full\)/);
    expect(canvas).toMatch(/className="ae-octane ae-o-wf-full"/);
  });
  test('every new builder token is defined on .ae-octane and re-keyed for the themes that differ', () => {
    const css = read('app/globals.css');
    for (const t of ['--o-wire-sel', '--o-drop-ok', '--o-drop-replace', '--z-wf-full']) expect(css).toMatch(new RegExp(`\\.ae-octane \\{[^}]*${t}:`));
    expect(css).toMatch(/:root\[data-theme='frost'\] \.ae-octane,\s*:root\[data-theme='grey-frost'\] \.ae-octane \{ --o-drop-ok:/);
    expect(css).toMatch(/:root\[data-theme='red'\] \.ae-octane \{ --o-drop-ok:/);
  });
  test.each(builderFiles)('%s has no raw colours and no emoji', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    expect(src).not.toMatch(/\brgba?\(/);
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
