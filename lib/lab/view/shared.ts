/**
 * Shared page and sheet model types (01 5.1, 5.2). The v1 shared types live in legacy.ts (v1's
 * lib/lab/view.ts, moved whole) and are re-exported here unchanged, so each type has one definition.
 */
import type { LabEventClass, LabWindowState } from '@/lib/schemas';
import type { SetupSection } from '@/lib/lab/setup/view';
import type { Measured } from '@/lib/lab/view/legacy';

export type {
  Measured, StrandView, LadderView, CreatorRef, MetricsView, SpecimenCard, SpecimenSheet, FieldView, FieldPoint,
  IdeaCard, ScriptSheet, ScriptRow, SourceRow, RunRow, DnaView, TrendRow, TrendsView, ProfileView, LabMode, LabState,
  TranscriptSegment, WhyLift, StrandBeatView,
} from '@/lib/lab/view/legacy';

export type LabPage = 'today' | 'radar' | 'breakouts' | 'playbook' | 'studio' | 'ledger' | 'creatorverse';
export const LAB_PAGES: { id: LabPage; label: string; path: string }[] = [
  { id: 'today', label: 'Today', path: '/lab' },
  { id: 'radar', label: 'Radar', path: '/lab/radar' },
  { id: 'breakouts', label: 'Breakouts', path: '/lab/breakouts' },
  { id: 'playbook', label: 'Playbook', path: '/lab/playbook' },
  { id: 'studio', label: 'Studio', path: '/lab/studio' },
  { id: 'ledger', label: 'Ledger', path: '/lab/ledger' },
  { id: 'creatorverse', label: 'Creatorverse', path: '/lab/creatorverse' },
];
export type SheetKind = 'post' | 'event' | 'idea' | 'script' | 'test' | 'setup' | 'ask';
/** 01 D4: when several sheet params are present, the first in this order wins. */
export const SHEET_PRECEDENCE: SheetKind[] = ['script', 'test', 'event', 'idea', 'post', 'ask', 'setup'];
export const SETUP_SECTION_IDS: SetupSection[] = ['checklist', 'keys', 'sources', 'schedule', 'spend'];
/** 08's name, re-exported (01 D13: one definition per type). */
export type { SetupSection } from '@/lib/lab/setup/view';
export type LabPlatformId = 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter';
export type HeroPlatform = 'all' | LabPlatformId;

export type LayerId = 'measure' | 'radar' | 'ledger' | 'gen' | 'ask' | 'retention' | 'comments';
export type LayerState = 'live' | 'not_built' | 'needs_key' | 'off';

/** Every page section carries one. Components switch on `kind` and never decide it. */
export type SectionState = {
  kind: 'ready' | 'empty' | 'thin' | 'not_built' | 'needs_key' | 'off' | 'error';
  /** Sentence shown instead of (empty, not_built, needs_key, off, error) or above (thin) the content. */
  message: string | null;
  /** One action, or null. href is a URL (sheet params allowed). */
  action: { label: string; href: string } | null;
};

export type LabParams = {
  sample: boolean;
  /** after SHEET_PRECEDENCE */
  sheet: { kind: SheetKind; id: string } | null;
  st: string | null;
  ver: number | null;
  period: 'w' | 'm';
  /** 0..-12 */
  offset: number;
  hp: HeroPlatform;
  seg: 'brief' | 'ask';
  platform: LabPlatformId | null;
  format: string | null;
  quadrant: 'ideal' | 'loyal' | 'clickbait' | 'dud' | null;
  window: 7 | 30 | 90;
  dual: boolean;
  mine: boolean;
  /** a tracked creator's lab source id (Breakouts, from the Today creator network) */
  creator: string | null;
  eventClass: LabEventClass | null;
  windowState: LabWindowState | null;
  /** a section 06 predictor id */
  predictor: string | null;
  newIdea: boolean;
  /** ?focus=add in Setup sources */
  focus: 'add' | null;
};

/** The age-matched read of one post. 01 owns the type; 04's ageMatchedView builds it. */
export type AgeMatchedView = {
  state: 'judged' | 'too_new' | 'no_baseline' | 'not_built';
  /** largest of 6, 24, 72, 168 that is <= age in hours */
  atH: 6 | 24 | 72 | 168 | null;
  /** "at 24h", "at 7d" */
  atLabel: string | null;
  ratio: number | null;
  /** "2.3x" or null */
  ratioText: string | null;
  /** 90% interval */
  lo: number | null;
  hi: number | null;
  /** "1.6x to 3.1x" */
  rangeText: string | null;
  /** baseline posts at that age */
  n: number;
  /** "2.3x" | "too new" | "not enough yet" | "not live yet" */
  text: string;
  /** next checkpoint, for "next read at 24h" */
  nextAtH: 24 | 72 | 168 | null;
};

export type DotMatrixData = {
  /** two column groups, oldest first: previous period then current period */
  prev: (number | null)[];
  curr: (number | null)[];
  /** "last 30d" */
  prevLabel: string;
  /** "this 30d" */
  currLabel: string;
  /** values are clipped at scaleMax for drawing */
  scaleMax: number;
};

export type HeroMetricView = {
  id: 'your_normal' | 'breakouts';
  /** "Your posts vs your normal" | "Breakouts in your niche" */
  label: string;
  /** text "1.4x" | "12" */
  value: Measured;
  delta: { value: number | null; text: string | null; tone: 'up' | 'down' | 'flat' | null };
  dots: DotMatrixData;
  /** "n 41" */
  nText: string;
  /** arrow button */
  href: string;
  /** "of 214 tracked posts" */
  sub: string | null;
};
