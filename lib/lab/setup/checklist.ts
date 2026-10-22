/**
 * The first-run checklist (08.4.2). Every step is detected from data; nothing is ticked by hand.
 * `doneAt` is the time of the evidence row. Dry, Filming and sample render every step `skipped`:
 * the checklist counts live runs only.
 */
import { BRAND } from '@/lib/brand';
import type { LabStore } from '@/lib/lab/store';
import type { LabHealthResult } from '@/lib/lab/setup/health';
import { apifyConfigured } from '@/lib/connectors/apify';
import { isPrivateInstance } from '@/lib/lab/setup/instance';

export type ChecklistStepId =
  | 'key_apify' | 'key_apify_ok' | 'owned_added' | 'tracked_added' | 'plan_previewed'
  | 'first_live_run' | 'first_cost_settled' | 'posts_measured' | 'radar_live'
  | 'scheduled' | 'stt_ready' | 'youtube_connected' | 'instagram_connected' | 'first_transcript' | 'lexicon_installed';
export type ChecklistStepState = 'done' | 'todo' | 'blocked' | 'skipped';
export type ChecklistStep = { id: ChecklistStepId; required: boolean; title: string; detail: string; state: ChecklistStepState; href: string; doneAt: string | null };
export type ChecklistView = { steps: ChecklistStep[]; requiredDone: number; requiredTotal: number; complete: boolean };

export const CHECKLIST_COMPLETE_LINE = 'Setup done. The Lab runs on its own now.';
const FREE_RADAR = ['hn', 'hf_models', 'hf_spaces', 'github', 'vendor'];

type Evidence = { done: boolean; at: string | null; detail?: string };

/** The 15 steps of 08.4.2 in order, each with its detection. */
export function checklistView(store: LabStore, opts: { health: LabHealthResult[]; dry: boolean; dryLabel?: string | null; privateInstance?: boolean; now?: Date }): ChecklistView {
  const now = opts.now ?? new Date();
  const ok = (id: string): Evidence => {
    const h = opts.health.find((x) => x.id === id);
    return { done: h?.state === 'ok', at: h?.state === 'ok' ? h.checkedAt : null };
  };
  const sources = store.sources.all();
  const liveRuns = store.runs.recent(1000).filter((r) => !r.dry);
  const firstScrape = liveRuns.filter((r) => r.kind === 'scrape' && r.status === 'succeeded').sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0] ?? null;
  const scrapeIds = new Set(liveRuns.filter((r) => r.kind === 'scrape' && r.status === 'succeeded').map((r) => r.id));
  const settled = store.spend.all().filter((s) => !s.dry && s.runId && scrapeIds.has(s.runId) && s.actualSource === 'provider').sort((a, b) => (a.settledAt ?? a.at).localeCompare(b.settledAt ?? b.at))[0] ?? null;
  const owned = sources.filter((s) => s.kind === 'owned' && s.status === 'active');
  const tracked = sources.filter((s) => s.kind === 'tracked' && s.status === 'active');
  // an owned post with a metrics row from a non-dry run: the post's source is owned and a live scrape covered it
  const ownedIds = new Set(owned.map((s) => s.id));
  const liveScrapeSources = new Set(liveRuns.filter((r) => (r.kind === 'scrape' || r.kind === 'snapshot') && r.status === 'succeeded').flatMap((r) => ((r.input as { sourceIds?: unknown })?.sourceIds as string[] | undefined) ?? []));
  const measuredPost = store.posts.all().find((p) => ownedIds.has(p.sourceId) && liveScrapeSources.has(p.sourceId) && store.metrics.forPost(p.id).length > 0) ?? null;
  const radarOk = FREE_RADAR.map((s) => store.priors.get(`job:radar.${s}`)?.value as { lastOkAt?: string | null; dry?: boolean } | null | undefined).filter((v) => v?.lastOkAt && !v.dry).map((v) => v!.lastOkAt!).sort()[0] ?? null;
  const schedule = store.priors.get('schedule');
  const heartbeat = opts.health.find((h) => h.id === 'schedule.heartbeat');
  const whisper = store.transcripts.all().find((t) => t.provider.toLowerCase().includes('whisper') && t.status === 'done');
  const whisperRun = whisper ? liveRuns.some((r) => r.kind === 'transcribe') : false;
  const preview = store.priors.get('checklist:plan_previewed');

  const isPrivate = opts.privateInstance ?? isPrivateInstance();
  const defs: { id: ChecklistStepId; required: boolean; title: string; href: string; ev: Evidence; after?: ChecklistStepId[] }[] = [
    { id: 'key_apify', required: true, title: 'Paste your Apify token', href: '?setup=keys', ev: { done: apifyConfigured(), at: null } },
    { id: 'key_apify_ok', required: true, title: 'Apify accepts the token', href: '?setup=keys', ev: ok('apify.auth'), after: ['key_apify'] },
    { id: 'owned_added', required: true, title: 'Add your own accounts', href: '?setup=sources', ev: { done: owned.length >= 1, at: owned.map((s) => s.addedAt).sort()[0] ?? null } },
    { id: 'tracked_added', required: true, title: 'Add 5 or more creators to track', href: '?setup=sources', ev: { done: tracked.length >= 5, at: tracked.map((s) => s.addedAt).sort()[4] ?? null, detail: `${tracked.length} of 5 added.` } },
    { id: 'plan_previewed', required: true, title: 'Preview the first run', href: '?setup=sources', ev: { done: Boolean(preview), at: preview?.updatedAt ?? null }, after: ['key_apify', 'key_apify_ok', 'owned_added', 'tracked_added'] },
    { id: 'first_live_run', required: true, title: 'Do the first live run', href: '?setup=sources', ev: { done: Boolean(firstScrape), at: firstScrape?.finishedAt ?? firstScrape?.startedAt ?? null }, after: ['plan_previewed'] },
    { id: 'first_cost_settled', required: true, title: "Confirm the first run's cost", href: '?setup=spend', ev: { done: Boolean(settled), at: settled?.settledAt ?? null }, after: ['first_live_run'] },
    { id: 'posts_measured', required: true, title: 'Your posts have numbers', href: '/lab', ev: { done: Boolean(measuredPost), at: measuredPost ? store.metrics.forPost(measuredPost.id)[0]?.capturedAt ?? null : null }, after: ['first_live_run'] },
    { id: 'radar_live', required: true, title: 'Radar is reading launches', href: '/lab/radar', ev: { done: Boolean(radarOk), at: radarOk } },
    { id: 'scheduled', required: isPrivate, title: 'Run the Lab on a schedule', href: '?setup=schedule', ev: { done: Boolean(schedule) && heartbeat?.state === 'ok', at: schedule?.updatedAt ?? null } },
    { id: 'stt_ready', required: false, title: 'Turn on speech to text', href: '?setup=keys', ev: ok('openai.auth') },
    { id: 'first_transcript', required: false, title: 'First Whisper transcript', href: '/lab/breakouts', ev: { done: Boolean(whisper && whisperRun), at: null } },
    { id: 'youtube_connected', required: false, title: 'Connect YouTube Analytics', href: '?setup=keys', ev: ok('youtube.token') },
    { id: 'instagram_connected', required: false, title: 'Connect Instagram insights', href: '?setup=keys', ev: ok('instagram.token') },
    { id: 'lexicon_installed', required: false, title: 'Concreteness lexicon', href: '?setup=keys', ev: ok('lexicon.file') },
  ];

  const byId = new Map(defs.map((d) => [d.id, d]));
  const steps: ChecklistStep[] = defs.map((d) => {
    if (opts.dry) return { id: d.id, required: d.required, title: d.title, detail: `Checklist counts live runs only. This is ${opts.dryLabel ?? 'a dry run'}.`, state: 'skipped', href: d.href, doneAt: null };
    if (d.id === 'scheduled' && !isPrivate) {
      const detail = BRAND.id === 'founderos' ? 'Schedule your own runs with `npm run lab-sync -- tick` from cron or launchd.' : 'Schedule runs on the private instance only.';
      return { id: d.id, required: false, title: d.title, detail, state: 'skipped', href: d.href, doneAt: null };
    }
    if (d.ev.done) return { id: d.id, required: d.required, title: d.title, detail: 'Done.', state: 'done', href: d.href, doneAt: d.ev.at };
    const blocker = (d.after ?? []).map((a) => byId.get(a)!).find((p) => !p.ev.done);
    if (blocker) return { id: d.id, required: d.required, title: d.title, detail: `After: ${blocker.title}`, state: 'blocked', href: d.href, doneAt: null };
    return { id: d.id, required: d.required, title: d.title, detail: d.ev.detail ?? (d.id === 'radar_live' ? 'Needs one live tick of the free Radar sources.' : 'To do.'), state: 'todo', href: d.href, doneAt: null };
  });
  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.state === 'done').length;
  const complete = !opts.dry && required.length > 0 && requiredDone === required.length;
  if (complete && !store.priors.get('checklist:complete')) {
    try {
      store.priors.set({ key: 'checklist:complete', value: { at: now.toISOString() }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
    } catch {
      /* read-only sample store */
    }
  }
  return { steps, requiredDone, requiredTotal: required.length, complete };
}

/** Write the `plan_previewed` evidence (GET /api/lab/run?plan=1 and `lab-sync -- plan`). Never in sample. */
export function markPlanPreviewed(store: LabStore, now: Date = new Date()): void {
  store.priors.set({ key: 'checklist:plan_previewed', value: { at: now.toISOString() }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
}
