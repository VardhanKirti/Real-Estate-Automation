/**
 * The two Content Lab v2 builders (01 5.4): buildPageView and buildSheet. Server only (they read the
 * store, env and the filesystem); components never import this file, they receive the result.
 *
 * Kept out of the barrel (lib/lab/view/index.ts) so a client component importing a type or LAB_COPY
 * from `@/lib/lab/view` never pulls node modules into the browser bundle.
 */
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabPage, LabParams, SetupSection, SheetKind } from '@/lib/lab/view/shared';
import type { LabPageView, PageViewOf, SheetPayload } from '@/lib/lab/view/index';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { buildFrame, frameChecklist, frameEnv, frameLayers, labMode, type FrameEnv, type LabFrameView } from '@/lib/lab/view/frame';
import { buildToday } from '@/lib/lab/view/today';
import { buildRadar } from '@/lib/lab/view/radar';
import { buildBreakouts } from '@/lib/lab/view/breakouts';
import { buildPlaybook } from '@/lib/lab/view/playbook';
import { buildStudio } from '@/lib/lab/view/studio';
import { buildLedger } from '@/lib/lab/view/ledger';
import { buildCreatorverse } from '@/lib/lab/view/creatorverse';
import { buildPostSheet } from '@/lib/lab/view/sheets/post';
import { buildEventSheet } from '@/lib/lab/view/sheets/event';
import { buildIdeaSheet } from '@/lib/lab/view/sheets/idea';
import { buildScriptSheet } from '@/lib/lab/view/sheets/script';
import { buildTestSheet } from '@/lib/lab/view/sheets/test';
import { buildSetupSheet } from '@/lib/lab/view/sheets/setup';
import { buildAskSheet } from '@/lib/lab/view/sheets/ask';
import { LAB_COPY } from '@/lib/lab/view/copy';

export type BuildExtras = {
  /** Breakouts card paging index (`from`), distinct from the period offset */
  from?: number;
  /** `post` prefill for `?test=new&post=` (01 14.3) */
  prefillPost?: string | null;
  /** test hook: the env the frame and sheets read (default: process env plus .env.local) */
  env?: FrameEnv;
};

export function sheetEnv(store: LabStore, flags: LabContext['flags'], env: FrameEnv): LabLayerEnv {
  const mode = labMode(store, flags);
  return {
    layers: frameLayers(store, env),
    readOnly: mode.sample ? LAB_COPY.readOnly : null,
    sample: mode.sample,
    dry: mode.dry,
    filming: mode.filming,
    dryLabel: mode.dryLabel,
    env,
  };
}

/** 01 5.4. A not_configured world has no sheets except Setup (the empty card's Set up). */
export async function buildSheet(kind: SheetKind, id: string, store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date = new Date(), extras: BuildExtras = {}): Promise<SheetPayload> {
  const env = extras.env ?? frameEnv();
  const se = sheetEnv(store, flags, env);
  switch (kind) {
    case 'post': return { kind, id, view: buildPostSheet(store, id, now, se) };
    case 'event': return { kind, id, view: se.layers.radar === 'live' ? buildEventSheet(store, id, now, se) : null };
    case 'idea': return { kind, id, view: buildIdeaSheet(store, id, now, se) };
    case 'script': return { kind, id, view: buildScriptSheet(store, id, params.ver, now, se) };
    case 'test': return { kind, id, view: buildTestSheet(store, id, extras.prefillPost ?? null, now, se) };
    case 'ask': return { kind, id, view: await buildAskSheet(store, id, now, se) };
    case 'setup': {
      const view = buildSetupSheet(store, id, params.focus === 'add', now, se);
      return { kind, id: view.section as SetupSection, view };
    }
  }
}

/** 01 5.4: the page model for one route, with its open sheet resolved server side (2.3). */
export async function buildPageView<P extends LabPage>(page: P, store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date = new Date(), extras: BuildExtras = {}): Promise<PageViewOf[P]> {
  const env = extras.env ?? frameEnv();
  const notConfigured = labMode(store, flags).state === 'not_configured';
  const checklist = notConfigured ? undefined : frameChecklist(store, flags, now, env);
  const frame: LabFrameView = buildFrame(page, store, params, flags, now, { env, checklist });
  const s = params.sheet;
  let sheet: SheetPayload | null = null;
  if (s && (!notConfigured || s.kind === 'setup')) {
    try {
      sheet = await buildSheet(s.kind, s.id, store, params, flags, now, { ...extras, env });
    } catch (err) {
      console.error('[lab view]', page, 'sheet', err);
      sheet = null;
    }
  }
  const inp = { frame, sheet };
  let view: LabPageView;
  switch (page) {
    case 'today': view = buildToday(store, params, flags, now, { ...inp, env, checklist: checklist ?? null }); break;
    case 'radar': view = buildRadar(store, params, flags, now, inp); break;
    case 'breakouts': view = buildBreakouts(store, params, flags, now, { ...inp, from: extras.from }); break;
    case 'playbook': view = buildPlaybook(store, params, flags, now, inp); break;
    case 'studio': view = buildStudio(store, params, flags, now, { ...inp, env: sheetEnv(store, flags, env) }); break;
    case 'ledger': view = buildLedger(store, params, flags, now, inp); break;
    case 'creatorverse': view = buildCreatorverse(store, params, flags, now, inp); break;
    default: throw new Error(`unknown Lab page ${String(page)}`);
  }
  return view as PageViewOf[P];
}
