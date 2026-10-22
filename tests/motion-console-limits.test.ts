import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source scan for S05a FR-2 (AC5a.1): the Motion console must never call the
 * throwing `ConsoleControlsSchema.parse(` from an edit path, and every text
 * field it renders carries a maxLength taken from CONSOLE_LIMITS.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const consoleSrc = read('components/creative-engine/MotionConsole.tsx');
const rowsSrc = read('components/creative-engine/octane-rows.tsx');

describe('Motion console never throws on input', () => {
  test('the only ConsoleControlsSchema.parse( is the defaults initialiser', () => {
    const calls = consoleSrc.match(/ConsoleControlsSchema\.parse\(([^)]*)\)/g) ?? [];
    expect(calls).toEqual(['ConsoleControlsSchema.parse({})']);
  });
  test('no setC updater or set() body calls .parse(', () => {
    const updaters = consoleSrc.match(/setC\(\(cur\)[^;]*;/g) ?? [];
    expect(updaters.length).toBeGreaterThan(0);
    for (const u of updaters) expect(u).not.toMatch(/\.parse\(/);
    const setBody = consoleSrc.slice(consoleSrc.indexOf('const set = useCallback'), consoleSrc.indexOf('const composed = useMemo'));
    expect(setBody).toContain('safeParse');
    expect(setBody).not.toMatch(/ConsoleControlsSchema\.parse\(/);
  });
  test('the console is wrapped in ConsoleErrorBoundary', () => {
    expect(consoleSrc).toMatch(/<ConsoleErrorBoundary[^>]*>[\s\S]*?<MotionConsoleBody[\s\S]*?<\/ConsoleErrorBoundary>/);
  });
});

describe('every console text field is capped by CONSOLE_LIMITS', () => {
  test('each <input> and <textarea> that edits text has maxLength={CONSOLE_LIMITS.*}', () => {
    // reference path fields are lists and frames, capped by count, not length
    // the console's fields render through the skin adapters (OInput / OTextarea, glados-ui GP1)
    const fields = consoleSrc.match(/<(input|textarea|OInput|OTextarea)\b[\s\S]*?\/>/g) ?? [];
    const text = fields.filter((f) => !/reference(Images|Videos|Audios)|reference paths|startFrame|endFrame/.test(f));
    expect(text.length).toBeGreaterThanOrEqual(3); // preset name, describe, dialogue
    for (const f of text) expect(f, f).toMatch(/maxLength=\{CONSOLE_LIMITS\.\w+\}/);
  });
  test('each <TextRow> passes maxLength={CONSOLE_LIMITS.*}', () => {
    const rows = consoleSrc.match(/<TextRow\b[\s\S]*?\/>/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2); // Subject, Overlay text
    for (const r of rows) expect(r, r).toMatch(/maxLength=\{CONSOLE_LIMITS\.\w+\}/);
  });
  test('TextRow forwards its maxLength to the input', () => {
    expect(rowsSrc).toMatch(/maxLength=\{maxLength\}/);
  });
});
