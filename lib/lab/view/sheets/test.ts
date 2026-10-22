/**
 * Test sheet (`?test=<id>` or `new`) model (01 18.1) and its builder. LabTest, the hygiene rules and
 * the result copy are section 06's.
 */
import type { LabTest } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { TRIAL_REELS_RULES, resultCopy } from '@/lib/lab/ledger/tests';
import { FEATURE_LABEL } from '@/lib/lab/distill';
import { humanize } from '@/lib/lab/view/legacy';
import { testStatusLabel } from '@/lib/lab/view/ledger';
import { clip } from '@/lib/lab/view/posts';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtCount } from '@/lib/lab/view/format';
import { withSample } from '@/lib/lab/view/section';

export type TestSheetView = { mode: 'new'; form: TestFormView } | { mode: 'view'; test: TestDetailView };

export type TestFormView = {
  kinds: { id: 'trial_reels' | 'yt_test_compare'; label: string; help: string; hygiene: string[] }[];
  variables: { trial_reels: ('hook' | 'cover')[]; yt_test_compare: ('title' | 'thumbnail' | 'title_thumbnail')[] };
  /** from &post= */
  prefillPostId: string | null;
  /** owned Instagram posts, last 14 days, newest first (one per arm) */
  instagramPosts: { id: string; label: string }[];
  /** owned YouTube long-form posts (Shorts excluded, 06 10.4), newest first */
  youtubeVideos: { id: string; label: string }[];
  /** shown Playbook rows; featureKey "<feature>:<value>" (06 10.2) */
  lifts: { featureKey: string; label: string; expectedSign: 1 | -1 }[];
  limits: { titleMin: 1; titleMax: 120; hypothesisMax: 500; armsMin: 2; armsMax: 3; variantMax: 500 };
};

export type TestDetailView = {
  /** section 06, unchanged */
  test: LabTest;
  /** as TestRowModel.kindLabel (12.2) */
  kindLabel: string;
  /** testStatusLabel (12.2 table) */
  statusLabel: string;
  /** section 06 13.3 sub-line for the result */
  resultSubline: string | null;
  tone: 'neutral' | 'ok';
  /** 06 13.3: "Confirms the Playbook: {featureLabel}" | "Goes against the Playbook: {featureLabel}" | null */
  confirmsText: string | null;
  /** metricsText: "reach 4,200 . shares 63 . 1.50% shares per reach" | "watch time share 54%" | "no numbers yet" */
  arms: { id: string; label: string; variantText: string; postHref: string | null; metricsText: string; isWinner: boolean }[];
  /** trial_reels only */
  hygiene: string[];
  actions: { enterMetrics: boolean; judgeNow: boolean; recordResult: boolean; stop: boolean };
};

/* ── builder (01 18) ──────────────────────────────────────────────────── */

const DAY = 86_400_000;

export function testForm(store: LabStore, prefillPostId: string | null, now: Date): TestFormView {
  const L = LAB_COPY.sheet;
  const owned = store.posts.all().filter((p) => p.isOwned && p.postedAt).sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
  const hooks = new Map(store.dissections.all().map((d) => [d.postId, d.hookText]));
  const label = (id: string, caption: string) => clip(hooks.get(id) || caption.split('\n')[0] || id, 60);
  const lifts: TestFormView['lifts'] = [];
  for (const p of store.profiles.latest()) for (const f of p.features) {
    if (!f.shown || f.lift === null) continue;
    lifts.push({ featureKey: `${f.feature}:${f.value}`, label: `${FEATURE_LABEL[f.feature] ?? humanize(f.feature)}: ${humanize(f.value).toLowerCase()}`, expectedSign: f.lift >= 1 ? 1 : -1 });
  }
  return {
    kinds: [
      { id: 'trial_reels', label: LAB_COPY.ledger.kind.trial_reels, help: L.trialHelp, hygiene: [...TRIAL_REELS_RULES] },
      { id: 'yt_test_compare', label: LAB_COPY.ledger.kind.yt_test_compare, help: L.ytHelp, hygiene: [] },
    ],
    variables: { trial_reels: ['hook', 'cover'], yt_test_compare: ['title', 'thumbnail', 'title_thumbnail'] },
    prefillPostId: prefillPostId && store.posts.get(prefillPostId) ? prefillPostId : null,
    instagramPosts: owned.filter((p) => p.platform === 'instagram' && Date.parse(p.postedAt!) >= now.getTime() - 14 * DAY).map((p) => ({ id: p.id, label: label(p.id, p.caption) })),
    youtubeVideos: owned.filter((p) => p.platform === 'youtube' && (p.durationS ?? 0) > 180).map((p) => ({ id: p.id, label: label(p.id, p.caption) })),
    lifts: lifts.sort((a, b) => a.label.localeCompare(b.label)),
    limits: { titleMin: 1, titleMax: 120, hypothesisMax: 500, armsMin: 2, armsMax: 3, variantMax: 500 },
  };
}

function metricsText(t: LabTest, a: LabTest['arms'][number]): string {
  const m = a.metrics;
  if (t.kind === 'yt_test_compare' && m.watchTimeSharePct !== null) return `watch time share ${Math.round(m.watchTimeSharePct)}%`;
  if (m.reach !== null && m.reach > 0 && m.shares !== null) return `reach ${fmtCount(m.reach)} · shares ${fmtCount(m.shares)} · ${((m.shares / m.reach) * 100).toFixed(2)}% shares per reach`;
  return LAB_COPY.sheet.noNumbers;
}

export function testDetail(t: LabTest, sample: boolean): TestDetailView {
  const L = LAB_COPY.sheet;
  const rc = resultCopy(t);
  const row = { status: t.status, result: t.result, resultLabel: rc.label };
  const feat = t.featureKey ? (() => { const [f, v] = t.featureKey!.split(':'); return `${FEATURE_LABEL[f] ?? humanize(f)}: ${humanize(v ?? '').toLowerCase()}`; })() : null;
  const judgeAge = t.judgeAgeH ?? 72;
  const open = t.status === 'running' || t.status === 'awaiting_result';
  const allMetrics = t.arms.every((a) => a.metrics.reach !== null && (a.metrics.atAgeH ?? 0) >= judgeAge);
  return {
    test: t,
    kindLabel: LAB_COPY.ledger.kind[t.kind] ?? t.kind,
    statusLabel: testStatusLabel(row),
    resultSubline: t.result ? rc.sub || null : null,
    tone: t.result === 'winner' ? 'ok' : 'neutral',
    confirmsText: t.confirms === null || !feat ? null : fill(t.confirms ? L.confirms : L.against, { label: feat }),
    arms: t.arms.map((a) => ({ id: a.id, label: a.label, variantText: a.variantText, postHref: a.postId ? withSample(`?post=${encodeURIComponent(a.postId)}`, sample) : null, metricsText: metricsText(t, a), isWinner: t.winnerArm === a.id })),
    hygiene: t.kind === 'trial_reels' ? [...TRIAL_REELS_RULES] : [],
    actions: {
      enterMetrics: !sample && t.kind === 'trial_reels' && open && !allMetrics,
      judgeNow: !sample && t.kind === 'trial_reels' && allMetrics && t.result === null && t.status !== 'abandoned',
      recordResult: !sample && t.kind === 'yt_test_compare' && t.result === null && t.status !== 'abandoned',
      stop: !sample && (t.status === 'planned' || t.status === 'running' || t.status === 'awaiting_result'),
    },
  };
}

export function buildTestSheet(store: LabStore, id: string, prefillPostId: string | null, now: Date, env: LabLayerEnv): TestSheetView | null {
  if (id === 'new') return { mode: 'new', form: testForm(store, prefillPostId, now) };
  const t = store.tests.get(id);
  return t ? { mode: 'view', test: testDetail(t, env.sample) } : null;
}
