import path from 'node:path';
import type { LabProfile } from '@/lib/schemas';
import { dataDir, filmingMode } from '@/lib/paths';
import { isDry } from '@/lib/lab/dry';
import type { LabStore } from '@/lib/lab/store';
import { GENERATED_MARKER, writeBrainDocs, type BrainDoc } from '@/lib/brain-docs';
import { slugifyTitle } from '@/lib/brain-dump';
import { brainStoreDir } from '@/lib/stores';
import { BRAND } from '@/lib/brand';
import { FEATURE_LABEL, profileSentences } from '@/lib/lab/distill';
import { computeDna, type Dna } from '@/lib/lab/dna';
import { beatTemplate, fmtRatio, median } from '@/lib/lab/measures';
import { latestSnapshots } from '@/lib/lab/trends';

/**
 * The Lab's distilled outputs as Optimal Engine markdown (SPEC §3 "Optimal Engine", §4.7, §8), so the
 * Wizard and every agent can retrieve and quote them. Raw posts stay in SQLite.
 *
 *   lab/viral-profile-<family>.md   one per format family, rewritten after each distill
 *   lab/digest-<yyyy>-w<ww>.md      the weekly digest (rewritten through the week)
 *
 * Files carry the brain's GENERATED_MARKER and go through `writeBrainDocs`, so a page the
 * operator edited by hand (marker removed) is never overwritten. File names use the
 * brain-dump slugger (lib/brain-dump.ts) so they match every other capture.
 */

const humanize = (v: string) => { const s = v.replaceAll('_', ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const fm = (title: string, kind: string) => `---\ntitle: ${title}\nkind: ${kind}\nsource: content-lab\n${GENERATED_MARKER}\n---\n\n`;

export function profileDoc(p: LabProfile, labels: Map<string, string>, dna: Dna | null): BrainDoc {
  const label = (feature: string, value: string) => (feature === 'topic_cluster' ? (labels.get(value) ?? value) : humanize(value));
  const shown = p.features.filter((f) => f.shown && f.lift !== null).sort((a, b) => b.lift! - a.lift!);
  const gaps = (dna?.gaps ?? []).filter((g) => g.family === p.formatFamily);
  const title = `Viral profile: ${p.label}`;
  const body = [
    `# ${title}`,
    '',
    p.method === 'case_control_mh_v1'
      ? `Version ${p.version}, distilled ${p.createdAt.slice(0, 10)} by the ${BRAND.name} Content Lab over a ${p.windowDays}-day window: ${p.breakoutsN} breakouts (3x or more their creator's own normal at 7 days, and outside their usual swing) and ${p.controlsN ?? 0} comparison posts drawn at random from the same creators; clickbait, comment bait and outside pushes excluded.`
      : `Version ${p.version}, distilled ${p.createdAt.slice(0, 10)} by the ${BRAND.name} Content Lab over a ${p.windowDays}-day window: ${p.postsN} competitor posts, ${p.breakoutsN} breakouts (3x or more their creator's own normal in this format, clickbait and comment bait excluded).`,
    ...(p.method === 'case_control_mh_v1' ? ['', 'Method: case-control, Mantel-Haenszel odds ratios, Benjamini-Hochberg q 0.10.'] : []),
    '',
    ...(shown.length ? profileSentences(p, label) : [p.method === 'case_control_mh_v1' ? 'Not enough data yet: no feature has 8 or more breakouts, 3 comparison posts and an interval clear of 1.0 that survives the false-discovery check.' : 'Not enough data yet: no feature has 8 or more breakouts with an interval clear of 1.0.']),
    '',
    '## Features that move breakouts',
    '',
    shown.length ? (p.method === 'case_control_mh_v1' ? '| Feature | Value | Odds ratio | n breakouts | Posts | 90% interval |' : '| Feature | Value | Lift | n breakouts | Posts | 90% interval |') : '',
    shown.length ? '|---|---|---|---|---|---|' : '',
    ...shown.map((f) => `| ${FEATURE_LABEL[f.feature] ?? f.feature} | ${label(f.feature, f.value)} | ${fmtRatio(f.lift)} | ${f.n} | ${f.total} | ${fmtRatio(f.lo)} to ${fmtRatio(f.hi)} |`),
    '',
    p.strand.length ? `Shape (most common beat template among the breakouts): ${beatTemplate(p.strand)}.` : '',
    ...(gaps.length ? ['', '## Your gaps', '', ...gaps.slice(0, 5).map((g) => `- ${FEATURE_LABEL[g.feature] ?? g.feature}: ${label(g.feature, g.value).toLowerCase()}, niche lift ${fmtRatio(g.nicheLift)} (n ${g.n}), you use it in ${Math.round(g.yourShare * 100)}% of ${g.yourN} posts.`)] : []),
    '',
  ];
  return { path: `lab/viral-profile-${slugifyTitle(p.formatFamily)}.md`, content: fm(title, 'lab-viral-profile') + body.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') };
}

/** ISO week label "2026-w41" for a date. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-w${String(w).padStart(2, '0')}`;
}

export type Digest = { week: string; opened: { clusterId: string; label: string; timing: string }[]; newBreakouts: number; yours: { family: string; label: string; median: number; n: number }[]; ideasReady: number; headline: string };

/** The weekly digest numbers ("3 trends opened, your tutorials beat baseline 2.1x, 4 ideas ready"). */
export function weeklyDigest(store: LabStore, opts: { now?: Date } = {}): Digest {
  const now = opts.now ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const labels = new Map(store.clusters.all().map((c) => [c.id, c.label]));
  const before = new Map<string, string | null>();
  for (const s of store.trendSnapshots.all()) if (s.day <= weekAgo) before.set(s.clusterId, s.timing);
  const opened = [...latestSnapshots(store).values()]
    .filter((s) => (s.timing === 'early' || s.timing === 'open') && before.get(s.clusterId) !== s.timing && before.get(s.clusterId) !== 'open')
    .map((s) => ({ clusterId: s.clusterId, label: labels.get(s.clusterId) ?? s.clusterId, timing: s.timing! }));
  const since = now.getTime() - 7 * 86_400_000;
  const posts = store.posts.all().filter((p) => p.postedAt && Date.parse(p.postedAt) >= since && Date.parse(p.postedAt) <= now.getTime());
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const newBreakouts = posts.filter((p) => !p.isOwned && ms.get(p.id)?.isBreakout).length;
  const byFam = new Map<string, number[]>();
  for (const p of posts.filter((x) => x.isOwned)) {
    const b = ms.get(p.id)?.breakout;
    const f = dis.get(p.id)?.format;
    if (typeof b === 'number' && f) (byFam.get(f) ?? byFam.set(f, []).get(f)!).push(b);
  }
  const yours = [...byFam.entries()].map(([family, bs]) => ({ family, label: humanize(family), median: Math.round((median(bs) ?? 0) * 10) / 10, n: bs.length })).sort((a, b) => b.n - a.n);
  const ideasReady = store.ideas.all('open').length;
  const top = yours.find((y) => y.n >= 2);
  const headline = [
    `${opened.length} trend${opened.length === 1 ? '' : 's'} opened`,
    top ? `your ${top.label} ran ${fmtRatio(top.median)} your baseline (median of ${top.n})` : null,
    `${ideasReady} idea${ideasReady === 1 ? '' : 's'} ready`,
  ].filter(Boolean).join(', ');
  return { week: isoWeek(now), opened, newBreakouts, yours, ideasReady, headline };
}

export function digestDoc(d: Digest): BrainDoc {
  const title = `Content Lab weekly digest ${d.week}`;
  const lines = [
    `# ${title}`,
    '',
    `${d.headline}.`,
    '',
    `- New competitor breakouts this week: ${d.newBreakouts}`,
    ...d.opened.map((o) => `- Trend ${o.timing}: ${o.label}`),
    ...d.yours.map((y) => `- Your ${y.label}: median ${fmtRatio(y.median)} your baseline over ${y.n} post${y.n === 1 ? '' : 's'}`),
    `- Ideas open in the queue: ${d.ideasReady}`,
    '',
  ];
  return { path: `lab/digest-${d.week}.md`, content: fm(title, 'lab-digest') + lines.join('\n') };
}

/**
 * Where the Lab's Optimal Engine docs go (08.8). Dry never touches the real brain store: a dry run on a
 * real install writes into a scratch folder under the data dir. Every Lab brain writer calls
 * this; none calls brainStoreDir() directly (tests/lab-brain-dry.test.ts enforces it).
 */
export function labBrainRoot(): string {
  if (filmingMode()) return brainStoreDir(); // already demo-data/brain
  if (isDry()) return path.join(dataDir(), 'lab-dry-brain'); // scratch, under the data dir
  return brainStoreDir();
}

/** True when a dry run would write into the real brain store (health check `brain.target`). */
export function dryBrainIsReal(): boolean {
  return isDry() && !filmingMode() && path.resolve(labBrainRoot()) === path.resolve(brainStoreDir());
}

/** Write every current profile and this week's digest into the brain store (labBrainRoot unless `root`). */
export function writeLabBrain(store: LabStore, opts: { now?: Date; root?: string } = {}): { written: number; skipped: number; paths: string[]; digest: Digest } {
  const labels = new Map(store.clusters.all().map((c) => [c.id, c.label]));
  const dna = computeDna(store, { now: opts.now });
  const digest = weeklyDigest(store, opts);
  const docs = [...store.profiles.latest().map((p) => profileDoc(p, labels, dna)), digestDoc(digest)];
  const res = writeBrainDocs(docs, opts.root ?? labBrainRoot());
  return { ...res, paths: docs.map((d) => d.path), digest };
}

