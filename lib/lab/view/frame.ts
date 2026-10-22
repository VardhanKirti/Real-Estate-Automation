/**
 * The shared frame view (01 4, 5.3): title, page tabs, quick actions, the create menu, search, the
 * menu button, mode banner and the Run dialog model. Built once per page view.
 */
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabMode, LabState } from '@/lib/lab/view/legacy';
import { LAB_PAGES, type LabPage, type LabParams, type LayerId, type LayerState } from '@/lib/lab/view/shared';
import type { PlanEstimate } from '@/lib/lab/setup/estimate';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtAge, fmtUsd } from '@/lib/lab/view/format';
import { layerStates } from '@/lib/lab/view/layers';
import { withSample } from '@/lib/lab/view/section';
import fs from 'node:fs';
import { readEnvLocal } from '@/lib/creds';
import { lineCapFor, lineEnabled, lineSpend } from '@/lib/lab/spend';
import { SCRAPE_DEPTH } from '@/lib/lab/apify-client';
import { activeBatch } from '@/lib/lab/setup/progress';
import { checklistView, type ChecklistView } from '@/lib/lab/setup/checklist';
import { healthResults } from '@/lib/lab/setup/health';
import { radarTiles } from '@/lib/lab/radar/view';
import { pausedBy, automationDirs } from '@/lib/lab/schedule';

export type LabFrameView = {
  generatedAt: string;
  page: LabPage;
  title: 'Content Lab';
  /** "Synced 2h ago" | "Never synced" */
  lastSyncText: string;
  /** v1 type, unchanged */
  mode: LabMode;
  /** LAB_COPY.readOnly in sample, else null */
  readOnly: string | null;
  layers: Record<LayerId, LayerState>;
  pages: { id: LabPage; label: string; href: string; active: boolean; badge: number | null }[];
  quickActions: { id: 'add_source' | 'new_idea' | 'log_test' | 'run_now'; label: string; href: string | null; disabledReason: string | null }[];
  createMenu: { id: 'add_source' | 'new_idea' | 'generate_ideas' | 'log_test' | 'log_outside_score' | 'run_intel'; label: string; href: string | null; disabledReason: string | null }[];
  search: { placeholder: 'Ask the Lab'; shortcut: 'Cmd K' | 'Ctrl K' };
  menuHref: string;
  banner: { tone: 'info' | 'warn'; text: string; action: { label: string; href: string } | null } | null;
  run: RunDialogView;
  /** only in not_configured */
  emptyCard: { title: string; body: string; setupHref: string; sampleHref: string | null } | null;
  agent: { id: 'content-lab'; name: string };
  /** 01 12.4 OutsideScoreDialog: owned draft scripts with no post yet and no frozen prediction, newest first */
  outsideScripts: { id: string; label: string }[];
};

export type RunDialogView = {
  accounts: number;
  tracked: number;
  /** SCRAPE_DEPTH.cycle */
  depth: number;
  /** "This month: $8.20 of $46.00 on Daily sync." | "This month: no Apify spend recorded." (08's line caps) */
  apifyLine: string;
  dryLine: string | null;
  /** any lab_runs row pending or running */
  active: boolean;
  /** 09.2.7; filled by GET /api/lab/run?plan=1 when the dialog opens, null in the frame */
  estimate: PlanEstimate | null;
  /** 09.4.2 activeBatch(store): the batch the progress poller resumes after a reload */
  activeBatch: string | null;
  /** readOnly | "Add your accounts or a creator in Setup first" */
  disabledReason: string | null;
};

export type FrameEnv = Record<string, string | undefined>;

/** Live env for the frame's layer and spend reads: process env plus .env.local (lib/creds). */
export function frameEnv(): FrameEnv {
  return { ...process.env, ...readEnvLocal() };
}

/** 01 4.5 / v1 rule: which global state the Lab is in. */
export function labState(store: LabStore, flags: LabContext['flags']): LabState {
  if (!flags.configured && !flags.sample && !flags.filming) return 'not_configured';
  if (store.isEmpty()) return 'empty';
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const competitorMeasured = store.posts.all().filter((p) => !p.isOwned && (measures.get(p.id)?.baselineConfidence ?? 'low') !== 'low').length;
  const anyShown = store.profiles.latest().some((p) => p.features.some((f) => f.shown));
  return competitorMeasured < 30 || !anyShown ? 'thin' : 'ready';
}

export function labMode(store: LabStore, flags: LabContext['flags']): LabMode {
  const state = labState(store, flags);
  return {
    state,
    configured: flags.configured,
    sample: Boolean(flags.sample),
    filming: Boolean(flags.filming),
    dry: Boolean(flags.dry),
    dryReason: flags.dryReason ?? null,
    dryLabel: flags.dryLabel ?? null,
    setupHref: flags.setupHref,
    fixtureName: flags.fixtureName ?? null,
    defaultTab: 'today',
  };
}

export function frameLayers(store: LabStore, env: FrameEnv): Record<LayerId, LayerState> {
  return layerStates({
    youtubeOAuth: Boolean(env.LAB_YT_REFRESH_TOKEN?.trim()),
    instagramOAuth: Boolean(env.LAB_IG_ACCESS_TOKEN?.trim()),
    commentsEnabled: lineEnabled('comments', { env, store }),
  });
}

/** Checklist with cached health (no network, AC-08-9). */
export function frameChecklist(store: LabStore, flags: LabContext['flags'], now: Date, env: FrameEnv): ChecklistView {
  const recorded = Boolean(flags.dry || flags.sample || flags.filming);
  const health = healthResults(store, { now, env });
  return checklistView(store, { health, dry: recorded, dryLabel: flags.sample ? 'sample data' : flags.dryLabel ?? null, now });
}

export function runDialogView(store: LabStore, flags: LabContext['flags'], now: Date, env: FrameEnv, readOnly: string | null): RunDialogView {
  const sources = store.sources.all().filter((s) => s.status === 'active');
  const accounts = sources.filter((s) => s.kind === 'owned').length;
  const tracked = sources.filter((s) => s.kind === 'tracked').length;
  const runs = store.runs.recent(200);
  const spent = lineSpend(store, 'apify.sync', now);
  const cap = lineCapFor('apify.sync', env);
  const anySpend = store.spend.all().some((s) => !s.dry && (s.line ?? 'apify.sync') === 'apify.sync');
  return {
    accounts,
    tracked,
    depth: SCRAPE_DEPTH.cycle,
    apifyLine: anySpend || spent > 0 ? fill(LAB_COPY.frame.apifyLine, { spent: fmtUsd(spent), cap: cap === null ? fmtUsd(0) : fmtUsd(cap) }) : LAB_COPY.frame.apifyNone,
    dryLine: flags.dry || flags.filming ? (flags.dryLabel ?? LAB_COPY.frame.dryLine) : null,
    active: runs.some((r) => r.status === 'queued' || r.status === 'running'),
    estimate: null,
    activeBatch: activeBatch(store, now),
    disabledReason: readOnly ?? (accounts + tracked === 0 ? LAB_COPY.frame.needsSources : null),
  };
}

function lastSyncText(store: LabStore, now: Date): string {
  const last = store.runs.recent(200).find((r) => r.kind === 'scrape' && r.status === 'succeeded' && r.finishedAt);
  if (!last?.finishedAt) return LAB_COPY.frame.neverSynced;
  return fill(LAB_COPY.frame.syncedAgo, { age: fmtAge((now.getTime() - Date.parse(last.finishedAt)) / 3_600_000) });
}

function pausedText(): string | null {
  try {
    const p = pausedBy(automationDirs(), (f) => fs.existsSync(f), 'lab');
    return p ? LAB_COPY.frame.bannerPaused : null;
  } catch {
    return null;
  }
}

function outsideScripts(store: LabStore): { id: string; label: string }[] {
  return store.scripts
    .all()
    .filter((sc) => sc.status === 'draft' && !sc.publishedPostId && !store.predictions.forScript(sc.id).some((p) => p.origin === 'live' && p.status !== 'void' && p.predictor === 'brody'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((sc) => ({ id: sc.id, label: sc.title }));
}

export function buildFrame(page: LabPage, store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, opts: { env?: FrameEnv; checklist?: ChecklistView } = {}): LabFrameView {
  const env = opts.env ?? frameEnv();
  const mode = labMode(store, flags);
  const sample = Boolean(flags.sample);
  const s = (h: string) => withSample(h, sample);
  const readOnly = sample ? LAB_COPY.readOnly : null;
  const notConfigured = mode.state === 'not_configured';
  const layers = frameLayers(store, env);
  const checklist = notConfigured ? null : (opts.checklist ?? frameChecklist(store, flags, now, env));
  const needsKey = notConfigured ? LAB_COPY.needsKey : null;
  const writeBlock = readOnly ?? needsKey;

  let radarBadge: number | null = null;
  if (!notConfigured && layers.radar === 'live') {
    try {
      radarBadge = radarTiles(store, now, { sample, dry: Boolean(flags.dry) }).length || null;
    } catch {
      radarBadge = null;
    }
  }
  const studioBadge = notConfigured ? null : store.ideas.all('open').length || null;
  const ledgerBadge = notConfigured || layers.ledger !== 'live' ? null : store.predictions.list({ status: 'frozen', origin: 'live' }).length || null;
  const badge: Record<LabPage, number | null> = { today: null, radar: radarBadge, breakouts: null, playbook: null, studio: studioBadge, ledger: ledgerBadge, creatorverse: null };

  const c = LAB_COPY.frame;
  const run = runDialogView(store, flags, now, env, readOnly);
  const runBlock = writeBlock ?? run.disabledReason;

  let banner: LabFrameView['banner'] = null;
  const paused = notConfigured || sample ? null : pausedText();
  if (paused) banner = { tone: 'info', text: paused, action: { label: c.resume, href: s('?setup=schedule') } };
  else if (mode.state === 'empty') banner = { tone: 'info', text: c.bannerEmpty, action: { label: c.bannerEmptyAction, href: s('?setup=sources&focus=add') } };
  else if (mode.state === 'thin') banner = { tone: 'warn', text: c.bannerThin, action: null };

  return {
    generatedAt: now.toISOString(),
    page,
    title: 'Content Lab',
    lastSyncText: notConfigured ? c.neverSynced : lastSyncText(store, now),
    mode,
    readOnly,
    layers,
    pages: LAB_PAGES.map((p) => ({ id: p.id, label: p.label, href: s(p.path), active: p.id === page, badge: badge[p.id] })),
    quickActions: [
      { id: 'add_source', label: c.addSource, href: s('?setup=sources&focus=add'), disabledReason: readOnly },
      { id: 'new_idea', label: c.newIdea, href: s('/lab/studio?new=1'), disabledReason: writeBlock },
      { id: 'log_test', label: c.logTest, href: s('?test=new'), disabledReason: writeBlock },
      { id: 'run_now', label: run.active ? c.running : c.runNow, href: null, disabledReason: runBlock },
    ],
    createMenu: [
      { id: 'add_source', label: c.addSource, href: s('?setup=sources&focus=add'), disabledReason: readOnly },
      { id: 'new_idea', label: c.newIdea, href: s('/lab/studio?new=1'), disabledReason: writeBlock },
      { id: 'generate_ideas', label: c.generateIdeas, href: s('/lab/studio#generate'), disabledReason: writeBlock },
      { id: 'log_test', label: c.logTest, href: s('?test=new'), disabledReason: writeBlock },
      { id: 'log_outside_score', label: c.logOutsideScore, href: null, disabledReason: writeBlock ?? (layers.ledger === 'live' ? null : LAB_COPY.layer.ledger) },
      { id: 'run_intel', label: c.runIntel, href: null, disabledReason: writeBlock },
    ],
    search: { placeholder: 'Ask the Lab', shortcut: 'Cmd K' },
    menuHref: s(notConfigured ? '?setup=keys' : checklist && !checklist.complete ? '?setup=checklist' : '?setup=keys'),
    banner,
    run,
    emptyCard: notConfigured ? { title: c.emptyTitle, body: c.emptyBody, setupHref: '?setup=keys', sampleHref: '?sample=1' } : null,
    agent: { id: 'content-lab', name: flags.agentName ?? LAB_COPY.title },
    outsideScripts: notConfigured || layers.ledger !== 'live' ? [] : outsideScripts(store),
  };
}
