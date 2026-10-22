import { describe, expect, test } from 'vitest';
import { RUN_TIMEOUT_MS, RUN_TYPICAL_MS, RUN_KINDS, type RunKind, type RunStatus } from '@/lib/creative-engine/schemas';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import {
  TYPICAL_AT, defaultRunId, droppedLinkText, engineSearch, resolveLinkIds, laneFor, nearestRunId, orderedRuns, parseEngineLink, placeRuns, progressFor, rangeFor,
  readyOrder, routeForRun, runAriaLabel, runHeadline, runSubline, widerRange, narrowerRange, assetIdForRun,
} from '@/lib/creative-engine/timeline';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const H = 3600_000;
const D = 24 * H;

function run(p: Partial<ResolvedRun> & { id: string; kind?: RunKind; status?: RunStatus; ageMs?: number }): ResolvedRun {
  const { ageMs = H, kind = 'research', status = 'delivered', ...rest } = p;
  const startedAt = new Date(NOW - ageMs).toISOString();
  return {
    campaignId: 'cmp-1', kind, title: `${kind} · Lumen Desk`, startedAt, finishedAt: status === 'running' ? null : startedAt,
    error: null, abandoned: false, outputRef: null, arcads: null, foreplay: null, dry: false,
    status, elapsedMs: 30_000, timeoutMs: RUN_TIMEOUT_MS[kind], ...rest,
  };
}

describe('rangeFor (F8, Q-ENG-13)', () => {
  test('no runs: 24 h', () => expect(rangeFor([], NOW)).toBe('24h'));
  test('newest run 3 h old: 24 h', () => expect(rangeFor([run({ id: 'a', ageMs: 3 * H })], NOW)).toBe('24h'));
  test('newest run 9 d old: 30 d', () => expect(rangeFor([run({ id: 'a', ageMs: 9 * D }), run({ id: 'b', ageMs: 12 * D })], NOW)).toBe('30d'));
  test('newest run 3 d old: 7 d', () => expect(rangeFor([run({ id: 'a', ageMs: 3 * D })], NOW)).toBe('7d'));
  test('a render in flight does not shrink a week-old history to 24 h', () => {
    expect(rangeFor([run({ id: 'r', status: 'running', ageMs: 90_000 }), run({ id: 'a', ageMs: 9 * D })], NOW)).toBe('30d');
  });
  test('only a running run: the range that holds it', () => expect(rangeFor([run({ id: 'r', status: 'running', ageMs: 90_000 })], NOW)).toBe('24h'));
  test('older than 30 d: 30 d', () => expect(rangeFor([run({ id: 'a', ageMs: 60 * D })], NOW)).toBe('30d'));
  test('wider and narrower steps', () => {
    expect(widerRange('24h')).toBe('7d');
    expect(widerRange('30d')).toBeNull();
    expect(narrowerRange('7d')).toBe('24h');
    expect(narrowerRange('24h')).toBeNull();
  });
});

describe('placeRuns (F9, F10)', () => {
  const W = 564;
  const opts = { padLeft: 76, padRight: 52 };
  test('dots sit inside the inner track, never under the side labels', () => {
    const runs = [run({ id: 'old', ageMs: 23.9 * H }), run({ id: 'new', ageMs: 1000 }), run({ id: 'mid', kind: 'script', ageMs: 12 * H })];
    const p = placeRuns(runs, '24h', W, NOW, opts);
    for (const d of p.items) {
      expect(d.x).toBeGreaterThanOrEqual(opts.padLeft);
      expect(d.x).toBeLessThanOrEqual(W - opts.padRight);
    }
    expect(p.dots).toHaveLength(3);
    expect(p.earlier).toBe(0);
  });
  test('two runs a minute apart at 24 h on a 564 px strip cluster', () => {
    const p = placeRuns([run({ id: 'a', ageMs: 2 * H }), run({ id: 'b', ageMs: 2 * H + 60_000 })], '24h', W, NOW, opts);
    expect(p.clusters).toHaveLength(1);
    expect(p.clusters[0].runIds.sort()).toEqual(['a', 'b']);
    expect(p.dots).toHaveLength(0);
  });
  test('the same two runs in different lanes stay separate dots', () => {
    const p = placeRuns([run({ id: 'a', kind: 'research', ageMs: 2 * H }), run({ id: 'b', kind: 'ugc', ageMs: 2 * H + 60_000 })], '24h', W, NOW, opts);
    expect(p.clusters).toHaveLength(0);
    expect(p.dots.map((d) => d.lane).sort()).toEqual([0, 2]);
  });
  test('lanes by kind group', () => {
    expect(laneFor('research')).toBe(0);
    expect(laneFor('angles')).toBe(0);
    expect(laneFor('script')).toBe(1);
    expect(laneFor('brief')).toBe(1);
    for (const k of ['ugc', 'motion', 'image', 'workflow'] as const) expect(laneFor(k)).toBe(2);
  });
  test('runs older than the range are counted in earlier, not drawn', () => {
    const p = placeRuns([run({ id: 'a', ageMs: 2 * D }), run({ id: 'b', ageMs: 2 * H })], '24h', W, NOW, opts);
    expect(p.earlier).toBe(1);
    expect(p.items.map((i) => i.id)).toEqual(['b']);
  });
  test('a start in the future (clock skew) is clamped to now', () => {
    const p = placeRuns([run({ id: 'f', ageMs: -5 * 60_000 })], '24h', W, NOW, opts);
    expect(p.xOf.f).toBeCloseTo(W - opts.padRight);
  });
  test('hundreds of runs stay at or under 40 drawn elements', () => {
    const many = Array.from({ length: 300 }, (_, i) => run({ id: `r${i}`, kind: RUN_KINDS[i % RUN_KINDS.length], ageMs: (i / 300) * 29 * D }));
    const p = placeRuns(many, '30d', W, NOW, opts);
    expect(p.items.length).toBeLessThanOrEqual(40);
    expect(p.items.reduce((s, i) => s + i.runIds.length, 0)).toBe(300);
  });
});

describe('selection (F13, F14)', () => {
  test('default: newest running, else newest delivered, else none', () => {
    expect(defaultRunId([], NOW)).toBeNull();
    const a = run({ id: 'a', ageMs: 3 * H });
    const b = run({ id: 'b', ageMs: 1 * H, status: 'failed' });
    expect(defaultRunId([a, b], NOW)).toBe('a');
    expect(defaultRunId([a, b, run({ id: 'r', status: 'running', ageMs: 2 * H })], NOW)).toBe('r');
  });
  test('ordered oldest first within the range; nearest snaps to the closer dot', () => {
    const rs = [run({ id: 'n', ageMs: 1 * H }), run({ id: 'o', ageMs: 20 * H }), run({ id: 'x', ageMs: 3 * D })];
    const order = orderedRuns(rs, '24h', NOW);
    expect(order.map((r) => r.id)).toEqual(['o', 'n']);
    const p = placeRuns(rs, '24h', 564, NOW);
    expect(nearestRunId(p.xOf, p.xOf.o + 3, order)).toBe('o');
    expect(nearestRunId(p.xOf, 10_000, order)).toBe('n');
  });
});

describe('labels (F11, F12)', () => {
  test('a delivered brief reads "Brief ready"', () => expect(runHeadline({ kind: 'brief', status: 'delivered' })).toBe('Brief ready'));
  test('running reads generating; failed reads failed', () => {
    expect(runHeadline({ kind: 'motion', status: 'running' })).toBe('Motion video generating');
    expect(runHeadline({ kind: 'image', status: 'failed' })).toBe('Image failed');
  });
  test('running subline ticks from startedAt, not the poll', () => {
    const r = run({ id: 'r', status: 'running', ageMs: 95_000, elapsedMs: 90_000 });
    expect(runSubline(r, NOW)).toBe('1m 35s elapsed');
    expect(runSubline(r, NOW + 1000)).toBe('1m 36s elapsed');
  });
  test('aria label names kind, title and age without repeating the kind', () => {
    const r = run({ id: 'b', kind: 'brief', title: 'Brief · A lamp with a bedtime', ageMs: 9 * D });
    expect(runAriaLabel(r, NOW)).toBe('Brief · A lamp with a bedtime · delivered 9 d ago');
  });
});

describe('routeForRun (F15)', () => {
  const campaign = {
    id: 'cmp-1',
    scripts: [{ id: 'scr-1', angleId: 'ang-1' }],
    briefs: [{ id: 'brf-1', at: new Date(NOW - D).toISOString() }],
    generations: [{ id: 'gen-u', runIds: ['run-ugc'] }, { id: 'gen-m', runIds: ['run-mo'] }],
    assets: [{ id: 'ast-u', generationId: 'gen-u', path: '/content-media/creative-engine/cmp-1/u.mp4' }, { id: 'ast-m', generationId: 'gen-m', path: '/content-media/creative-engine/cmp-1/m.mp4' }],
  } as unknown as Parameters<typeof routeForRun>[1];
  const cases: [string, ResolvedRun, ReturnType<typeof routeForRun>][] = [
    ['research delivered', run({ id: 'r1', kind: 'research' }), { sheet: 'generator', focus: 'research', campaignId: 'cmp-1' }],
    ['angles delivered', run({ id: 'r2', kind: 'angles' }), { sheet: 'generator', focus: 'angles', campaignId: 'cmp-1' }],
    ['script delivered', run({ id: 'r3', kind: 'script', outputRef: 'campaign:cmp-1#script:scr-1' }), { sheet: 'scripter', scriptId: 'scr-1', angleId: 'ang-1', campaignId: 'cmp-1' }],
    ['brief delivered', run({ id: 'r4', kind: 'brief', outputRef: 'campaign:cmp-1#brief:brf-9' }), { sheet: 'briefings', briefId: 'brf-9', campaignId: 'cmp-1' }],
    ['brief delivered, no ref: newest brief', run({ id: 'r4b', kind: 'brief' }), { sheet: 'briefings', briefId: 'brf-1', campaignId: 'cmp-1' }],
    ['ugc delivered', run({ id: 'run-ugc', kind: 'ugc', outputRef: 'asset:cmp-1/u.mp4' }), { sheet: 'ugc', assetId: 'ast-u', campaignId: 'cmp-1' }],
    ['motion delivered', run({ id: 'run-mo', kind: 'motion' }), { sheet: 'console', assetId: 'ast-m', campaignId: 'cmp-1' }],
    ['image delivered, no asset', run({ id: 'run-img', kind: 'image' }), { sheet: 'console', campaignId: 'cmp-1' }],
    ['workflow delivered', run({ id: 'run-wf', kind: 'workflow' }), { sheet: 'console', campaignId: 'cmp-1' }],
    ['running', run({ id: 'r5', kind: 'motion', status: 'running' }), { sheet: 'runs', runId: 'r5' }],
    ['queued', run({ id: 'r6', kind: 'ugc', status: 'queued' }), { sheet: 'runs', runId: 'r6' }],
    ['failed', run({ id: 'r7', kind: 'image', status: 'failed' }), { sheet: 'runs', runId: 'r7' }],
    ['stale', run({ id: 'r8', kind: 'ugc', status: 'stale' }), { sheet: 'runs', runId: 'r8' }],
    ['abandoned', run({ id: 'r9', kind: 'motion', status: 'abandoned' }), { sheet: 'runs', runId: 'r9' }],
    ['health', run({ id: 'r10', kind: 'health' }), { sheet: 'credits' }],
    ['no campaign', run({ id: 'r11', kind: 'research', campaignId: null }), { sheet: 'runs', runId: 'r11' }],
  ];
  test.each(cases)('%s', (_n, r, want) => expect(routeForRun(r, campaign)).toEqual(want));
  test('an asset is found by generation even without a file ref', () => {
    expect(assetIdForRun({ id: 'run-mo', outputRef: null }, campaign as never)).toBe('ast-m');
    expect(assetIdForRun({ id: 'run-mo', outputRef: null }, null)).toBeUndefined();
  });
});

describe('progressFor (F19)', () => {
  const kind = 'motion';
  const typ = RUN_TYPICAL_MS[kind];
  const out = RUN_TIMEOUT_MS[kind];
  const at = (ms: number, status: RunStatus = 'running') => progressFor({ kind, status, startedAt: new Date(NOW - ms).toISOString(), elapsedMs: ms }, NOW);
  test('0 elapsed: thumb at the left', () => {
    expect(at(0).pct).toBe(0);
    expect(at(0).phase).toBe('normal');
  });
  test('at typical: thumb on the tick', () => {
    expect(at(typ).pct).toBeCloseTo(TYPICAL_AT);
    expect(at(typ).phase).toBe('normal');
  });
  test('between typical and timeout: past the tick, slow', () => {
    const p = at((typ + out) / 2);
    expect(p.pct).toBeGreaterThan(TYPICAL_AT);
    expect(p.pct).toBeLessThan(1);
    expect(p.phase).toBe('slow');
  });
  test('past timeout: at the ring, stale', () => {
    expect(at(out + 1000).pct).toBe(1);
    expect(at(out + 1000).phase).toBe('stale');
    expect(at(1000, 'stale').phase).toBe('stale');
  });
  test('typical never exceeds the timeout', () => {
    for (const k of RUN_KINDS) expect(RUN_TYPICAL_MS[k]).toBeLessThanOrEqual(RUN_TIMEOUT_MS[k]);
  });
});

describe('deep links (§5 C20)', () => {
  test('parse ?engine=&brief=&run=&angle=&asset=', () => {
    expect(parseEngineLink('?engine=briefings&brief=brf-1')).toEqual({ sheet: 'briefings', briefId: 'brf-1' });
    expect(parseEngineLink('?engine=runs&run=run-1')).toEqual({ sheet: 'runs', runId: 'run-1' });
    expect(parseEngineLink('?engine=console&asset=ast-2')).toEqual({ sheet: 'console', assetId: 'ast-2' });
    expect(parseEngineLink('?engine=scripter&angle=ang-1')).toEqual({ sheet: 'scripter', angleId: 'ang-1' });
  });
  test('unknown sheets are ignored; odd ids are dropped, the sheet still opens', () => {
    expect(parseEngineLink('?engine=nope')).toBeNull();
    expect(parseEngineLink('?sample=1')).toBeNull();
    expect(parseEngineLink('?engine=runs&run=%3Cscript%3E')).toEqual({ sheet: 'runs' });
  });
  test('print keeps other params and clears the link on close', () => {
    expect(engineSearch('?sample=1', { sheet: 'briefings', briefId: 'brf-1' })).toBe('?sample=1&engine=briefings&brief=brf-1');
    expect(engineSearch('?sample=1&engine=runs&run=r1', null)).toBe('?sample=1');
    expect(engineSearch('?engine=runs', null)).toBe('');
  });
  test('"Proven only" round-trips through ?proven=1 on the generator only', () => {
    expect(engineSearch('', { sheet: 'generator', focus: 'angles', proofOnly: true })).toBe('?engine=generator&proven=1');
    expect(engineSearch('?engine=generator&proven=1', { sheet: 'generator', proofOnly: false })).toBe('?engine=generator');
    expect(engineSearch('', { sheet: 'scripter', proofOnly: true })).toBe('?engine=scripter');
    expect(parseEngineLink('?engine=generator&proven=1')).toEqual({ sheet: 'generator', proofOnly: true, focus: 'angles' });
    expect(parseEngineLink('?engine=briefings&proven=1')).toEqual({ sheet: 'briefings' });
  });
  test('unknown ids are dropped and named', () => {
    const campaign = { briefs: [{ id: 'brf-1' }], angles: [{ id: 'ang-1' }], assets: [{ id: 'ast-1' }] } as never;
    expect(resolveLinkIds({ sheet: 'briefings', briefId: 'brf-1' }, campaign, [])).toEqual({ target: { sheet: 'briefings', briefId: 'brf-1' }, dropped: [] });
    const r = resolveLinkIds({ sheet: 'briefings', briefId: 'brf-nope' }, campaign, []);
    expect(r).toEqual({ target: { sheet: 'briefings' }, dropped: ['brief'] });
    expect(engineSearch('?engine=briefings&brief=brf-nope', r.target)).toBe('?engine=briefings');
    expect(resolveLinkIds({ sheet: 'runs', runId: 'r1' }, null, [{ id: 'r1' }]).dropped).toEqual([]);
    expect(resolveLinkIds({ sheet: 'console', assetId: 'x' }, null, []).dropped).toEqual(['asset']);
    expect(droppedLinkText(['brief'])).toBe('That brief is not in this campaign. Opened the sheet without it.');
  });
});

describe('Ready for you order (F24)', () => {
  test('sent briefs sort after unsent ones', () => {
    const scripts = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
    expect(readyOrder(scripts, [{ scriptId: 's1', status: 'sent' }, { scriptId: 's2', status: 'ready' }]).map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });
});
