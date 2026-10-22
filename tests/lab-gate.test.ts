import { describe, expect, test } from 'vitest';
import type { LabScriptBody } from '@/lib/schemas';
import { bannedFromSkill, containsPhrase, deterministicGate, findDash, gateBadness, gateWithScores, isBaitCta, sectionBudgets } from '@/lib/lab/gate';

/** 60 s at 120 wpm = 120 words: hook 10% (12), demo 70% (84), cta 20% (24). */
const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
function body(over: Partial<LabScriptBody> = {}, spoken: [string, string, string] = [words(12), words(84), words(24)]): LabScriptBody {
  return {
    durationS: 60,
    wpm: 120,
    hooks: [{ form: 'results_first', trigger: 'curiosity', spoken: 'I cut my bill to three dollars a month', onScreen: 'Three dollars', words: 9 }],
    hookChoice: 0,
    sections: [
      { type: 'hook', startPct: 0, endPct: 10, spoken: spoken[0], onScreen: '', visualNote: '' },
      { type: 'demo', startPct: 10, endPct: 80, spoken: spoken[1], onScreen: '', visualNote: '' },
      { type: 'cta', startPct: 80, endPct: 100, spoken: spoken[2], onScreen: '', visualNote: '' },
    ],
    cta: 'Follow for part two.',
    caption: 'The setup and the real numbers.',
    titles: ['Prompt caching, tested'],
    ...over,
  };
}
const failing = (b: LabScriptBody, banned?: string[]) => deterministicGate(b, { bannedWords: banned }).checks.filter((c) => !c.ok).map((c) => c.id);

describe('the deterministic gate (SPEC §4.12, AC8)', () => {
  test('a clean script inside every budget passes', () => {
    const g = deterministicGate(body());
    expect(g.passed).toBe(true);
    expect(g.scores).toBeNull();
    expect(g.checks.map((c) => c.id)).toEqual(['no-dashes', 'banned-words', 'no-hedging', 'cta', 'total-words', 'hook-words']);
  });

  test('dashes: em, en, figure, minus, a spaced hyphen and a double hyphen fail; hyphenated words and number ranges pass', () => {
    for (const d of ['this — that', 'this – that', 'a ‒ b', 'a − b', 'this - that', 'this -- that']) expect(findDash(d)).not.toBeNull();
    for (const ok of ['a well-known trick', '30–60 seconds', 'from 2024 – 2026', 'state-of-the-art']) expect(findDash(ok)).toBeNull();
    const b = body({}, [words(12), `${words(40)} — ${words(43)}`, words(24)]);
    const g = deterministicGate(b);
    expect(g.checks.find((c) => c.id === 'no-dashes')).toMatchObject({ ok: false, section: 1 });
  });

  test('banned words match on word boundaries, from the defaults and from the voice skill', () => {
    expect(containsPhrase('Unlock the setup', 'unlock')).toBe(true);
    expect(containsPhrase('It unlocked the door', 'unlock')).toBe(false);
    expect(failing(body({ caption: 'Leverage this.' }))).toContain('banned-words');
    expect(failing(body({ caption: 'However, it works.' }), ['however'])).toContain('banned-words');
    expect(failing(body({ caption: 'However, it works.' }))).not.toContain('banned-words');
  });

  test('hedging and "in conclusion" fail', () => {
    expect(failing(body({ cta: 'It might be worth a follow.' }))).toContain('no-hedging');
    expect(failing(body({ caption: 'In conclusion, it works.' }))).toContain('banned-words');
  });

  test('engagement-bait CTAs fail; a plain follow passes', () => {
    for (const bait of ['Comment AGENT below and I will send it', 'Type the word MEMORY below', 'Drop a keyword in the comments', 'Tag a friend who needs this', 'Smash that like button']) expect(isBaitCta(bait)).toBe(true);
    for (const ok of ['Follow for part two.', 'The full setup is linked in my bio.']) expect(isBaitCta(ok)).toBe(false);
    expect(failing(body({ cta: 'Comment AGENT below' }))).toContain('cta');
  });

  test('total words ±15%: 102 of 120 passes, 101 fails (sections kept inside ±25%)', () => {
    expect(failing(body({}, [words(11), words(71), words(20)]))).not.toContain('total-words'); // 102 = -15%
    expect(failing(body({}, [words(11), words(70), words(20)]))).toContain('total-words'); // 101
  });

  test('each section ±25%: 105 words in an 84-word section passes, 106 fails and names the section', () => {
    const ok = sectionBudgets(body({}, [words(12), words(105), words(24)]))[1];
    expect(ok).toMatchObject({ budget: 84, words: 105, over: false });
    const g = deterministicGate(body({}, [words(12), words(106), words(24)]));
    expect(g.checks.find((c) => c.id === 'section-1')).toMatchObject({ ok: false, section: 1 });
  });

  test('the chosen hook stays inside its form budget', () => {
    const long = body({ hooks: [{ form: 'imperative', trigger: 'urgency', spoken: words(11, 'go'), onScreen: '', words: 11 }] });
    expect(deterministicGate(long).checks.find((c) => c.id === 'hook-words')).toMatchObject({ ok: false, detail: '11 of 10 words' });
  });

  test('model scores fold in: under 3 fails with the blamed section; null leaves the gate unscored', () => {
    const det = deterministicGate(body());
    const g = gateWithScores(det, { voice: 2, tension: 4, evidence: 4, register: 3 }, { voice: 1 });
    expect(g.passed).toBe(false);
    expect(g.checks.find((c) => c.id === 'model-voice')).toMatchObject({ ok: false, section: 1, detail: 'scored 2 of 5' });
    expect(gateWithScores(det, null)).toMatchObject({ passed: true, scores: null });
    expect(gateBadness(g)).toBeGreaterThan(gateBadness(gateWithScores(det, { voice: 4, tension: 4, evidence: 4, register: 4 })));
  });
});

describe('banned words from a voice skill', () => {
  test('quoted phrases and parenthesised lists on banned/AI-tell/hedging lines; long examples are not banned words', () => {
    const md = [
      '## Banned (things he does not say on camera)',
      '- No em dashes or en dashes (en dash only in number ranges). No "however" / "but the problem is". No AI-tell words (unlock, leverage, seamless, game-changing, etc.).',
      '- No academic phrasing, no hedging ("arguably", "it could be said").',
      '- **Slick setups:** "Here is the thing that took me far too long to realise." is a rewrite example.',
      '- Casual phrasing he uses: "a bunch of", "way too long".',
    ].join('\n');
    const b = bannedFromSkill(md);
    expect(b).toEqual(expect.arrayContaining(['however', 'but the problem is', 'unlock', 'leverage', 'seamless', 'game-changing', 'arguably', 'it could be said']));
    expect(b).not.toContain('a bunch of');
    expect(b.some((w) => w.includes('took me'))).toBe(false);
    expect(bannedFromSkill(null)).toEqual([]);
  });
});
