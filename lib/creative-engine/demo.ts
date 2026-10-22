import type { Campaign, Run, Workflow } from '@/lib/creative-engine/schemas';
import { TEMPLATES } from '@/lib/creative-engine/workflow';
import type { HealthSnapshot } from '@/lib/creative-engine/schemas';
import { RUN_TIMEOUT_MS } from '@/lib/creative-engine/schemas';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import type { SavedAd } from '@/lib/foreplay/saved';
import type { WatchEntry } from '@/lib/foreplay/watchlist';
import type { Signal } from '@/lib/foreplay/signals';
import type { Catalog } from '@/lib/arcads/catalog';

/**
 * Sample set for viewing the Creative Engine UI on a blank install. Opt-in
 * only (`?sample=1`), clearly badged, read-only, never written to the store.
 *
 * One fictional world (SPEC §5 C9, S03 FR-9): Lumen Desk, a desk lamp that
 * dims itself when you have been working too long, sold to remote workers.
 * Every brand (Northwind Tools, Kestrel Systems, Orbit Labs, Pinion, Halyard),
 * ad, hook and figure is made up, and the product is neutral on purpose: a
 * sample that resembled the operator's own offers would read as real data.
 * Counts are fixed (4 angles, 2 selected, 2 scripts, 1 brief, 1 rendering
 * run) so every widget keeps its populated state.
 */

export const SAMPLE_PRODUCT = 'Lumen Desk';
export const SAMPLE_CONCEPT = 'a desk lamp that dims itself when you have been working too long';

// The sample's clock runs from now, so its history never ages out of the
// run timeline (S07 F8): research 26 days ago, a render in flight today.
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const D = 1440;

const POOL: Campaign['research'] extends infer R ? (R extends { pool: infer P } ? P : never) : never = [
  { id: 'smp-ad-1', brand: 'Northwind Tools', brandId: 'b1', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 74, hook: 'I stopped working at midnight because my lamp told me to', hookSource: 'spoken', transcript: [{ t: 0, s: 'I stopped working at midnight because my lamp told me to.' }, { t: 4, s: 'It dims a little every half hour after nine.' }, { t: 9, s: 'By eleven the desk is basically asleep.' }], drivers: { curiosity: 8.1, relief: 6.4, status: 5.2, fear: 2.1, greed: 3.0 }, ctaType: 'LEARN_MORE', linkUrl: null, probes: ['lamp that dims at night', 'work late habit'], duplicates: 6 },
  { id: 'smp-ad-2', brand: 'Kestrel Systems', brandId: 'b2', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 41, hook: 'This lamp has a bedtime', hookSource: 'spoken', transcript: [{ t: 0, s: 'This lamp has a bedtime.' }, { t: 3, s: 'And honestly, so do I now.' }], drivers: { relief: 7.7, curiosity: 5.9, greed: 4.3, status: 2.2 }, ctaType: 'SHOP_NOW', linkUrl: null, probes: ['lamp that dims at night', 'desk setup upgrade'], duplicates: 3 },
  { id: 'smp-ad-3', brand: 'Orbit Labs', brandId: 'b3', thumbnail: null, video: null, image: null, format: 'image', live: true, daysRunning: 33, hook: 'The calmest desk on the internet', hookSource: 'text', transcript: [], drivers: { status: 8.8, curiosity: 6.2, relief: 3.1 }, ctaType: 'SHOP_NOW', linkUrl: null, probes: ['desk setup upgrade'], duplicates: 1 },
  { id: 'smp-ad-4', brand: 'Northwind Tools', brandId: 'b1', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 29, hook: 'My eyes stopped hurting in a week', hookSource: 'spoken', transcript: [{ t: 0, s: 'My eyes stopped hurting in a week.' }, { t: 4, s: 'Same screen, same hours, different light.' }], drivers: { relief: 8.9, curiosity: 4.4, greed: 3.8 }, ctaType: 'LEARN_MORE', linkUrl: null, probes: ['eye strain at night', 'work late habit'], duplicates: 2 },
  { id: 'smp-ad-5', brand: 'Pinion', brandId: 'b4', thumbnail: null, video: null, image: null, format: 'video', live: true, daysRunning: 26, hook: 'Your desk knows you are tired before you do', hookSource: 'spoken', transcript: [{ t: 0, s: 'Your desk knows you are tired before you do.' }, { t: 3, s: 'It just lowers the light and waits.' }], drivers: { curiosity: 7.0, fear: 5.5, status: 4.0 }, ctaType: 'SHOP_NOW', linkUrl: null, probes: ['lamp that dims at night'], duplicates: 4 },
  { id: 'smp-ad-6', brand: 'Halyard', brandId: 'b5', thumbnail: null, video: null, image: null, format: 'video', live: false, daysRunning: 22, hook: 'We took the overhead light out and kept the focus', hookSource: 'spoken', transcript: [{ t: 0, s: 'We took the overhead light out and kept the focus.' }], drivers: { relief: 6.1, curiosity: 6.8, greed: 2.0 }, ctaType: null, linkUrl: null, probes: ['desk setup upgrade'], duplicates: null },
];

export const SAMPLE_CAMPAIGN_ID = 'ae-sample-1';

const BRIEF_MD = [
  '# A lamp with a bedtime · Lumen Desk',
  '',
  '**Angle.** The longest-running ads sell the evening the buyer gets back, not the lamp. The lamp is the reason they stop.',
  '',
  '## Proof',
  '| Brand | Hook | Days running | Status | Format | Copies |',
  '|---|---|---|---|---|---|',
  '| Northwind Tools | I stopped working at midnight because my lamp told me to | 74 | live | video | 6 |',
  '| Kestrel Systems | This lamp has a bedtime | 41 | live | video | 3 |',
  '| Pinion | Your desk knows you are tired before you do | 26 | live | video | 4 |',
  '',
  'Median longevity of the proof set: **41 days** while live.',
  '',
  '> Longevity while live is the only spend proxy available for these ads. No engagement, spend, CTR or revenue figures exist for them, and none are implied.',
  '',
  '## Script (Hook · Show · Demo · Result · Verdict, 15s)',
  '**Hook** (3s)',
  'My lamp has a bedtime and it is earlier than mine.',
  '',
  '**Show** (2s)',
  'This is it.',
  '',
  '**Demo** (5s)',
  'After nine it dims a little every half hour, so I wrap up instead of grinding.',
  '',
  '**Result** (2s)',
  'I get my evenings back.',
  '',
  '**Verdict** (3s)',
  'Link in bio if you need a lamp with rules.',
  '',
  '**CTA.** Link in bio to see the lamp',
  '',
  '38 spoken words for 15s · fits · tone: Best friend sharing',
  '',
  '## Deliverable',
  '- Formats proven for this angle: video',
  '- Aspect: 9:16 first',
  '- Duration: 15s',
  '- Production: UGC actor (Arcads) or Motion Console',
  '',
  '## Provenance',
  `- Concept: "${SAMPLE_CONCEPT}"`,
  '- Research: standard depth, 5 probes, 17 Foreplay calls, claude',
  '- Script version 2 by claude',
  '- Sample data: every brand and figure above is fictional',
].join('\n');

export function sampleCampaign(): Campaign {
  const scriptId = 'scr-smp-01';
  const script2Id = 'scr-smp-02';
  return {
    id: SAMPLE_CAMPAIGN_ID,
    origin: 'live',
    name: 'Lumen Desk lamp launch',
    concept: { text: SAMPLE_CONCEPT, product: SAMPLE_PRODUCT, audience: 'remote workers', goal: 'sales' },
    research: {
      depth: 'standard',
      expandedBy: 'claude',
      minDays: 21,
      format: 'any',
      probes: [
        { query: 'lamp that dims at night', why: 'the product itself, as ad copy phrases it', results: 11 },
        { query: 'work late habit', why: 'the habit the buyer wants to break', results: 7 },
        { query: 'eye strain at night', why: 'the adjacent pain the audience searches', results: 5 },
        { query: 'desk setup upgrade', why: 'status framing of the same purchase', results: 4 },
        { query: 'evenings back', why: 'the outcome, stated as time', results: 6 },
      ],
      pool: POOL,
      pooled: 23,
      apiCalls: 17,
      ranAt: iso(26 * D + 52),
    },
    angles: [
      { id: 'ang-smp-1', title: 'A lamp with a bedtime', thesis: 'The longest-running ads sell the evening the buyer gets back, not the lamp. The lamp is the reason they stop.', hookPattern: '"My X has a bedtime"', whyItWorks: 'Relief plus curiosity; two proof ads past 40 days and six running copies.', proofAdIds: ['smp-ad-1', 'smp-ad-2', 'smp-ad-5'], drivers: ['relief', 'curiosity'], formats: ['video'], confidence: 'strong', selected: true },
      { id: 'ang-smp-2', title: 'Eyes back in a week', thesis: 'A felt change with a time on it. A body result beats any brightness spec.', hookPattern: '"My eyes stopped hurting in N days"', whyItWorks: 'Relief is the top driver at 8.9; the proof ad is live at 29 days.', proofAdIds: ['smp-ad-4'], drivers: ['relief'], formats: ['video'], confidence: 'plausible', selected: true },
      { id: 'ang-smp-3', title: 'The calm desk', thesis: 'Status framing: the desk people screenshot, warm light, nothing on it but the work.', hookPattern: '"The calmest desk on the internet"', whyItWorks: 'Status 8.8 on the image ad still live at 33 days; works as a static.', proofAdIds: ['smp-ad-3'], drivers: ['status'], formats: ['image', 'video'], confidence: 'plausible', selected: false },
      { id: 'ang-smp-4', title: 'Lose the overhead light', thesis: 'Contrarian swap: the thing you remove is a light, the thing you keep is focus.', hookPattern: '"We took the X out and kept the Y"', whyItWorks: 'Curiosity-led; the proof ad ran 22 days before pausing, so plausible only.', proofAdIds: ['smp-ad-6'], drivers: ['curiosity', 'relief'], formats: ['video'], confidence: 'plausible', selected: false },
    ],
    adsWanted: 2,
    scripts: [
      {
        id: scriptId,
        angleId: 'ang-smp-1',
        framework: 'hook-show-demo-result-verdict',
        controls: { targetSeconds: 15, tone: 'best-friend', intro: 'using', cta: 'Link in bio to see the lamp', noStageDirections: true },
        versions: [
          { n: 1, hook: 'My lamp has a bedtime and honestly it is smarter than me.', beats: [{ name: 'Hook', spoken: 'My lamp has a bedtime and honestly it is smarter than me.', action: 'desk at night, lamp mid-frame', seconds: 3 }, { name: 'Show', spoken: 'This is the one I keep talking about.', action: 'taps the lamp', seconds: 2 }, { name: 'Demo', spoken: 'After nine it starts dimming every half hour, so by eleven I am done whether I like it or not.', action: 'time-lapse of the light lowering', seconds: 5 }, { name: 'Result', spoken: 'I got my evenings back.', action: 'back to camera', seconds: 2 }, { name: 'Verdict', spoken: 'If you always work too late, the link in bio has it.', action: 'small nod', seconds: 3 }], cta: 'Link in bio to see the lamp', fullScript: 'My lamp has a bedtime and honestly it is smarter than me. This is the one I keep talking about. After nine it starts dimming every half hour, so by eleven I am done whether I like it or not. I got my evenings back. If you always work too late, the link in bio has it.', wordCount: 55, targetSeconds: 15, fits: false, notes: 'first pass, over by 18 words', at: iso(44), by: 'claude' },
          { n: 2, hook: 'My lamp has a bedtime and it is earlier than mine.', beats: [{ name: 'Hook', spoken: 'My lamp has a bedtime and it is earlier than mine.', action: 'desk at night, lamp mid-frame', seconds: 3 }, { name: 'Show', spoken: 'This is it.', action: 'taps the lamp', seconds: 2 }, { name: 'Demo', spoken: 'After nine it dims a little every half hour, so I wrap up instead of grinding.', action: 'time-lapse of the light lowering', seconds: 5 }, { name: 'Result', spoken: 'I get my evenings back.', action: 'back to camera', seconds: 2 }, { name: 'Verdict', spoken: 'Link in bio if you need a lamp with rules.', action: 'small nod', seconds: 3 }], cta: 'Link in bio to see the lamp', fullScript: 'My lamp has a bedtime and it is earlier than mine. This is it. After nine it dims a little every half hour, so I wrap up instead of grinding. I get my evenings back. Link in bio if you need a lamp with rules.', wordCount: 38, targetSeconds: 15, fits: true, notes: 'tightened to budget', at: iso(41), by: 'claude' },
        ],
        approvedVersion: 2,
        createdAt: iso(21 * D + 45),
      },
      {
        id: script2Id,
        angleId: 'ang-smp-2',
        framework: 'before-after',
        controls: { targetSeconds: 12, tone: 'chill-recommender', intro: 'before-after', cta: 'Try it for 30 nights', noStageDirections: true },
        versions: [
          { n: 1, hook: 'My eyes used to burn by ten every night.', beats: [{ name: 'Before', spoken: 'My eyes used to burn by ten every night. Bright desk, bright screen, no end point.', action: 'harsh overhead light, squinting', seconds: 4 }, { name: 'After', spoken: 'A week with this lamp and that stopped. It warms and dims on its own.', action: 'warm desk light, relaxed', seconds: 5 }, { name: 'CTA', spoken: 'Try it for thirty nights, link below.', action: 'to camera', seconds: 3 }], cta: 'Try it for 30 nights', fullScript: 'My eyes used to burn by ten every night. Bright desk, bright screen, no end point. A week with this lamp and that stopped. It warms and dims on its own. Try it for thirty nights, link below.', wordCount: 38, targetSeconds: 12, fits: false, notes: '', at: iso(30), by: 'claude' },
        ],
        approvedVersion: null,
        createdAt: iso(17 * D + 31),
      },
    ],
    briefs: [
      {
        id: 'brf-smp-1',
        scriptId,
        angleId: 'ang-smp-1',
        title: 'A lamp with a bedtime · Lumen Desk',
        markdown: BRIEF_MD,
        proof: { ads: [{ id: 'smp-ad-1', brand: 'Northwind Tools', hook: 'I stopped working at midnight because my lamp told me to', daysRunning: 74, live: true, format: 'video', duplicates: 6, linkUrl: null }, { id: 'smp-ad-2', brand: 'Kestrel Systems', hook: 'This lamp has a bedtime', daysRunning: 41, live: true, format: 'video', duplicates: 3, linkUrl: null }, { id: 'smp-ad-5', brand: 'Pinion', hook: 'Your desk knows you are tired before you do', daysRunning: 26, live: true, format: 'video', duplicates: 4, linkUrl: null }], medianDays: 41, drivers: { curiosity: 7.0, relief: 6.4, status: 3.8, greed: 2.4, fear: 2.5 }, note: 'Longevity while live is the only spend proxy available for these ads. No engagement, spend, CTR or revenue figures exist for them, and none are implied.' },
        status: 'ready',
        at: iso(14 * D + 38),
      },
    ],
    generations: [
      { id: 'gen-smp-ugc', kind: 'ugc', scriptId, request: { situationId: 'smp-sit-2', voiceId: null }, runIds: ['run-smp-ugc'], assetIds: ['ast-smp-1'], at: iso(11 * D + 28) },
      { id: 'gen-smp-motion', kind: 'motion', scriptId, request: { model: 'seedance-2.0', duration: 15 }, runIds: ['run-smp-m1', 'run-smp-m2'], assetIds: ['ast-smp-2'], at: iso(8 * D + 12) },
    ],
    assets: [
      { id: 'ast-smp-1', generationId: 'gen-smp-ugc', kind: 'video', path: null, thumbnailPath: null, sourceUrl: null, model: 'ugc-actor', creditsCharged: 1, durationSec: 15, at: iso(11 * D + 24) },
      { id: 'ast-smp-2', generationId: 'gen-smp-motion', kind: 'video', path: null, thumbnailPath: null, sourceUrl: null, model: 'seedance-2.0', creditsCharged: 18.5, durationSec: 15, at: iso(8 * D + 6) },
    ],
    arcads: { productId: 'prod-sample', folderId: 'fold-sample' },
    createdAt: iso(26 * D + 60),
    updatedAt: iso(8 * D + 6),
  };
}

export function sampleRuns(): ResolvedRun[] {
  const base = (r: Partial<Run> & Pick<Run, 'id' | 'kind' | 'title' | 'startedAt'>): Run => ({
    campaignId: SAMPLE_CAMPAIGN_ID, finishedAt: null, error: null, abandoned: false, outputRef: null, arcads: null, foreplay: null, dry: false, ...r,
  });
  const resolve = (r: Run, status: ResolvedRun['status']): ResolvedRun => ({ ...r, status, elapsedMs: Math.max(0, (r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt)), timeoutMs: RUN_TIMEOUT_MS[r.kind] });
  return [
    resolve(base({ id: 'run-smp-m2', kind: 'motion', title: 'seedance-2.0 · 15s · #2', startedAt: new Date(Date.now() - 95_000).toISOString(), arcads: { id: 'as-2', type: 'seedance_20', model: 'seedance-2.0', creditsCharged: 18.5, pollPath: 'assets', lastPolledAt: new Date(Date.now() - 12_000).toISOString(), lastStatus: 'pending', lastRaw: null, creditsBefore: 980.47, sourceUrl: null, thumbnailUrl: null } }), 'running'),
    resolve(base({ id: 'run-smp-m1', kind: 'motion', title: 'seedance-2.0 · 15s · #1', startedAt: iso(8 * D + 12), finishedAt: iso(8 * D + 6), outputRef: 'asset:sample', arcads: { id: 'as-1', type: 'seedance_20', model: 'seedance-2.0', creditsCharged: 18.5, pollPath: 'assets', lastPolledAt: iso(8 * D + 6), lastStatus: 'generated', lastRaw: null, creditsBefore: 998.97, sourceUrl: null, thumbnailUrl: null } }), 'delivered'),
    resolve(base({ id: 'run-smp-img', kind: 'image', title: 'nano-banana-2 · 1:1', startedAt: iso(9 * D + 20), finishedAt: iso(9 * D + 19), error: 'body.prompt: The content could not be processed because it contained material flagged by a content checker (credits are not refunded)', arcads: { id: 'as-0', type: 'nano-banana-2', model: 'nano-banana-2', creditsCharged: 0.03, pollPath: 'assets', lastPolledAt: iso(9 * D + 19), lastStatus: 'failed', lastRaw: null, creditsBefore: null, sourceUrl: null, thumbnailUrl: null } }), 'failed'),
    resolve(base({ id: 'run-smp-ugc', kind: 'ugc', title: 'UGC · My lamp has a bedtime and it is earlier than mine.', startedAt: iso(11 * D + 28), finishedAt: iso(11 * D + 24), outputRef: 'asset:sample', arcads: { id: 'scr-x', type: 'ugc', model: 'ugc-actor', creditsCharged: 1, pollPath: 'talking-actors', lastPolledAt: iso(11 * D + 24), lastStatus: 'completed', lastRaw: null, creditsBefore: 999.97, sourceUrl: null, thumbnailUrl: null } }), 'delivered'),
    resolve(base({ id: 'run-smp-brief', kind: 'brief', title: 'Brief · A lamp with a bedtime', startedAt: iso(14 * D + 38), finishedAt: iso(14 * D + 38) }), 'delivered'),
    resolve(base({ id: 'run-smp-script2', kind: 'script', title: 'Script · Eyes back in a week', startedAt: iso(17 * D + 31), finishedAt: iso(17 * D + 30) }), 'delivered'),
    resolve(base({ id: 'run-smp-script1', kind: 'script', title: 'Script · A lamp with a bedtime', startedAt: iso(21 * D + 45), finishedAt: iso(21 * D + 44) }), 'delivered'),
    resolve(base({ id: 'run-smp-angles', kind: 'angles', title: 'Angles · Lumen Desk lamp launch', startedAt: iso(25 * D + 51), finishedAt: iso(25 * D + 50) }), 'delivered'),
    resolve(base({ id: 'run-smp-research', kind: 'research', title: 'Research · standard · Lumen Desk lamp launch', startedAt: iso(26 * D + 55), finishedAt: iso(26 * D + 52), foreplay: { apiCalls: 17 } }), 'delivered'),
  ];
}

/**
 * The sample's one workflow (S05b FR-66, §5 C9): TEMPLATES[1] "Prompt, video,
 * edit" on the lamp concept, with fixed ids so the read-only builder renders
 * the same graph every time. Design only: it has never run, so it carries no
 * run state and no outputs.
 */
export function sampleWorkflow(): Workflow {
  const g = TEMPLATES[1].build({ scriptId: null, beats: [] });
  const ids = new Map(g.nodes.map((n, i) => [n.id, `n-smp-${i + 1}`]));
  const text = ['A desk lamp clicks on in a dark home office; warm light spreads over a notebook. Phone footage, slow push-in.', 'Make the light warmer and hold on the lamp head for the last second.'];
  let t = 0;
  return {
    id: 'wf-sample-1', campaignId: SAMPLE_CAMPAIGN_ID, name: 'Lamp: prompt, video, edit',
    nodes: g.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, settings: n.type === 'text' ? { ...n.settings, text: text[t++] ?? n.settings.text } : n.settings })),
    edges: g.edges.map((e, i) => ({ ...e, id: `e-smp-${i + 1}`, from: ids.get(e.from)!, to: ids.get(e.to)! })),
    runStartedAt: null, runScope: null, deliveries: [], createdAt: iso(90), updatedAt: iso(60),
  };
}

export function sampleHealth(): HealthSnapshot {
  return {
    ok: true,
    dry: true, // placeholders render instead of missing files
    dryEnv: false,
    filming: false,
    foreplay: { configured: true, remaining: 7_420, total: 10_000, lastSyncAt: iso(140), setupHref: '/integrations#foreplay' },
    arcads: {
      configured: true,
      health: {
        auth: { lastProbeAt: iso(140), ok: true, error: null },
        catalog: { lastProbeAt: iso(140), ok: true, error: null },
        'seedance-2.0': { lastProbeAt: iso(1400), ok: true, error: null },
        veo31: { lastProbeAt: iso(1400), ok: true, error: null },
        'kling-3.0': { lastProbeAt: iso(1400), ok: false, error: 'end frame alone: accepted, charged, then failed' },
        credits: { lastProbeAt: iso(140), ok: true, error: null },
      },
      creditsThisMonth: 38.03,
      sessionSpent: 38.03,
      sessionCap: 200,
      sessionSince: iso(300),
      ledgerEntries: 4,
      balance: { at: iso(6), creditsIncluded: 1000, creditsRemaining: 961.97, additionalCreditsUsed: 0, periodStart: iso(14_400), periodEnd: iso(-28_800), plan: 'Scale' },
      productId: 'prod-sample',
      productName: SAMPLE_PRODUCT,
      ugcPath: 'v2',
      setupHref: '/integrations#arcads',
    },
    claude: { present: true, version: '2.1.286 (Claude Code)' },
  };
}

/* ── S04 B25: the rest of the sample world. In `?sample=1` the Proof library,
   watchlist, signals and UGC catalog come from here, never from the store or
   the network, so no real brand or signal can appear in the preview. ── */

export function sampleSaved(): SavedAd[] {
  return POOL.slice(0, 3).map((p, i) => {
    const { probes: _p, duplicates: _d, ...ad } = p;
    return { ad, savedAt: iso(40 - i * 3) };
  });
}

export function sampleWatchlist(): WatchEntry[] {
  return [
    { id: 'b1', name: 'Northwind Tools', domain: 'northwind.example', avatar: null, addedAt: iso(9_000) },
    { id: 'b2', name: 'Kestrel Systems', domain: 'kestrel.example', avatar: null, addedAt: iso(8_000) },
    { id: 'b4', name: 'Pinion', domain: 'pinion.example', avatar: null, addedAt: iso(7_000) },
    { id: 'b5', name: 'Halyard', domain: 'halyard.example', avatar: null, addedAt: iso(6_000) },
  ];
}

export function sampleSignals(): Signal[] {
  return [
    { type: 'winner', brandId: 'b1', brandName: 'Northwind Tools', adId: 'smp-ad-1', message: 'Northwind Tools: an ad passed 60 days live', at: iso(130) },
    { type: 'new_launch', brandId: 'b2', brandName: 'Kestrel Systems', message: 'Kestrel Systems launched 3 new ads', at: iso(300) },
    { type: 'velocity_spike', brandId: 'b4', brandName: 'Pinion', message: 'Pinion doubled its live ads this week', at: iso(1_500) },
    { type: 'killed', brandId: 'b5', brandName: 'Halyard', adId: 'smp-ad-6', message: 'Halyard paused an ad after 22 days', at: iso(2_900) },
  ];
}

/** Six fictional actors and voices, typed as the real catalog so the shapes never drift. No network. */
export function sampleCatalog(): Catalog & { setupHref: string } {
  const actor = (n: number, name: string, gender: 'female' | 'male', tags: string[]) => ({
    id: `smp-actor-${n}`, name, gender, age: '25-34', imageUrl: '',
    situations: [{ id: `smp-sit-${n}`, tags, emotions: ['warm'], cameraAngle: 'front', imageUrl: '', previewUrl: '', defaultVoiceId: `smp-voice-${n}` }],
  });
  const voice = (n: number, name: string, gender: 'female' | 'male', descriptive: string) => ({ id: `smp-voice-${n}`, name, gender, age: 'young adult', accent: 'american', descriptive, audioUrl: '' });
  return {
    state: 'connected',
    detail: 'Sample catalog: fictional actors and voices',
    actors: [actor(1, 'Ines', 'female', ['home office']), actor(2, 'Sol', 'male', ['desk', 'night']), actor(3, 'Wren', 'female', ['kitchen']), actor(4, 'Arlo', 'male', ['studio']), actor(5, 'Juno', 'female', ['living room']), actor(6, 'Pax', 'male', ['car'])],
    voices: [voice(1, 'Ines (warm)', 'female', 'warm, conversational'), voice(2, 'Sol (calm)', 'male', 'calm, direct'), voice(3, 'Wren (bright)', 'female', 'bright'), voice(4, 'Arlo (low)', 'male', 'low, steady'), voice(5, 'Juno (quick)', 'female', 'quick, upbeat'), voice(6, 'Pax (dry)', 'male', 'dry, funny')],
    products: [{ id: 'prod-sample', name: SAMPLE_PRODUCT, description: 'Sample product' }],
    fetchedAt: iso(140),
    setupHref: '/integrations#arcads',
  };
}
