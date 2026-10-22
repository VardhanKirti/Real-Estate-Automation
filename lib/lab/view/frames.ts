/**
 * Frame fixtures for the frames gate (02 section 16). Self-contained: imports only shared component prop
 * types and lib/lab/motion.ts. Every value here is fictional sample data, flagged on the page as
 * "Sample data". Strings stand in for what section 01's formatters will print (C7); nothing here formats.
 */
import type { ActionPillProps, HeroMetricProps, NarrativeCardProps, Period, PlusMenuItem, TileProps } from '@/components/lab/v2/shared';
import { LAB_DUR } from '@/lib/lab/motion';

export const FRAME_STATES = ['default', 'window-open', 'window-closing', 'window-none', 'not-configured', 'components'] as const;
export type FrameState = (typeof FRAME_STATES)[number];

export function isFrameState(s: string): s is FrameState {
  return (FRAME_STATES as readonly string[]).includes(s);
}

/** The sheet mid frame pauses at half the open duration (16.2), read from motion, never hard-coded. */
export const FRAME_SHEET_MID_MS = LAB_DUR.m / 2;

/** The fixed clock every frame renders at, so captures are reproducible. */
export const FRAME_NOW = '2026-10-11T12:00:00.000Z';

export type FrameTab = { id: string; label: string; href: string; active: boolean };
export type FrameIdeaRow = { id: string; title: string; windowText: string; groundedText: string; action: ActionPillProps };
export type FrameStat = { id: string; label: string; valueText: string; unit?: 'x' | '$' | null; foot?: string };
export type FramePostSheet = {
  id: string;
  title: string;
  caption: string;
  hook: string;
  readText: string;
  rangeText: string;
  nText: string;
  reads: string[];
  viz: TileProps['viz'];
  why: string;
};

export type FrameToday = {
  heroes: [HeroMetricProps, HeroMetricProps];
  brief: NarrativeCardProps;
  window: NarrativeCardProps;
  yourPosts: TileProps[];
  launchRadar: TileProps[];
  nextToMake: FrameIdeaRow[];
  pipeline: { stats: FrameStat[]; spend: { text: string; spent: number; cap: number; foot: string }; lastRunText: string };
  ledgerLine: string;
  notConfigured: boolean;
  /** Frame chrome (01 section 4), so the page reads as the shipped Today. */
  tabs: FrameTab[];
  quickActions: ActionPillProps[];
  createMenu: PlusMenuItem[];
  segmented: { id: 'brief' | 'ask'; label: string; countText?: string }[];
  periods: Period[];
  postSheet: FramePostSheet;
};

const HERO1_PREV = [0.9, 1.1, 1.0, 1.3, 0.8, 1.2, 1.0, 1.1, 1.4, 1.2];
const HERO1_CUR = [1.3, 1.6, 1.2, 1.9, 1.5, 1.1, 1.4, 1.7, 1.3, 1.6];
const HERO2_PREV = [2, 3, 1, 4, 2, 2, 1];
const HERO2_CUR = [1, 2, 0, 3, 2, 1, 3];

const BAND = (lo: number, mid: number, hi: number) => [
  { h: 1, lo: lo * 0.08, mid: mid * 0.08, hi: hi * 0.08 },
  { h: 6, lo: lo * 0.4, mid: mid * 0.4, hi: hi * 0.4 },
  { h: 24, lo, mid, hi },
  { h: 72, lo: lo * 1.6, mid: mid * 1.6, hi: hi * 1.6 },
];

const MINUS = '−';

function heroes(notConfigured: boolean): [HeroMetricProps, HeroMetricProps] {
  return [
    {
      id: 'normal-ratio',
      label: 'Your posts vs your normal',
      value: 1.4,
      valueText: '1.4x',
      format: 'ratio',
      n: 41,
      nText: 'n 41',
      delta: { text: '+18%', dir: 'up' },
      deltaWords: 'up 18 percent',
      groups: [
        { id: 'prev', label: 'last 30d', values: HERO1_PREV, emphasis: 'prev' },
        { id: 'cur', label: 'this 30d', values: HERO1_CUR, emphasis: 'current' },
      ],
      href: '/lab/breakouts?mine=1',
      state: notConfigured ? 'not-configured' : 'sample',
      setupHref: '?setup=keys',
    },
    {
      id: 'breakouts',
      label: 'Breakouts in your niche',
      value: 12,
      valueText: '12',
      format: 'count',
      n: 12,
      nText: 'n 12',
      delta: { text: `${MINUS}3`, dir: 'down' },
      deltaWords: 'down 3',
      groups: [
        { id: 'prev', label: 'last wk', values: HERO2_PREV, emphasis: 'prev' },
        { id: 'cur', label: 'this wk', values: HERO2_CUR, emphasis: 'current' },
      ],
      href: '/lab/breakouts?window=7',
      state: notConfigured ? 'not-configured' : 'sample',
      setupHref: '?setup=keys',
    },
  ];
}

function windowCard(state: Exclude<FrameState, 'components'>): NarrativeCardProps {
  if (state === 'not-configured') return { kind: 'window', label: 'Window', sentence: null, state: 'not-configured', setupHref: '?setup=keys' };
  if (state === 'window-none') return { kind: 'window', label: 'Window', sentence: 'No open windows.', meta: 'Next check 14:30.', state: 'none', windowT: 1 };
  if (state === 'window-closing') {
    return {
      kind: 'window', label: 'Window', state: 'sample', windowT: 0.7,
      sentence: 'Veo 4 shipped 2d ago. 9 of 14 creators are in. Closing.',
      action: { label: 'Make this', href: '/lab/studio?new=1&event=frame-veo-4' },
      href: '?event=frame-veo-4', hrefLabel: 'Open the Veo 4 launch', sharedId: 'event-frame-veo-4',
    };
  }
  return {
    kind: 'window', label: 'Window', state: 'sample', windowT: 0.15,
    sentence: 'Claude 5 shipped 9h ago. 3 of 14 creators have covered it. Window open.',
    action: { label: 'Make this', href: '/lab/studio?new=1&event=frame-claude-5' },
    href: '?event=frame-claude-5', hrefLabel: 'Open the Claude 5 launch', sharedId: 'event-frame-claude-5',
  };
}

const YOUR_POSTS: TileProps[] = [
  {
    id: 'post-frame-1', title: 'Agent ran my inbox for a week', href: '?post=frame-1', value: 2.3, valueText: '2.3x', valueWords: '2.3 times',
    format: 'ratio', n: 12, nText: 'n 12', foot: 'Reel, at 24h', state: 'ready',
    viz: { kind: 'band', ageH: 24, points: [{ h: 1, v: 900 }, { h: 6, v: 5200 }, { h: 24, v: 21000 }], band: BAND(6000, 9000, 14000) },
  },
  {
    id: 'post-frame-2', title: 'Free tool replaced 3 apps', href: '?post=frame-2', value: 0.8, valueText: '0.8x', valueWords: '0.8 times',
    format: 'ratio', n: 12, nText: 'n 12', foot: 'Short, at 6h', state: 'ready',
    viz: { kind: 'band', ageH: 6, points: [{ h: 1, v: 300 }, { h: 6, v: 1900 }], band: BAND(5200, 6800, 9100) },
  },
  {
    id: 'post-frame-3', title: 'Prompt that fixed my thumbnails', href: '?post=frame-3', value: 1.1, valueText: '1.1x', valueWords: '1.1 times',
    format: 'ratio', n: 12, nText: 'n 12', foot: 'TikTok, at 72h', state: 'ready',
    viz: { kind: 'band', ageH: 72, points: [{ h: 1, v: 700 }, { h: 6, v: 3100 }, { h: 24, v: 9400 }, { h: 72, v: 15100 }], band: BAND(7000, 9200, 12500) },
  },
  {
    id: 'post-frame-4', title: '40 automations, 1 lesson', href: '?post=frame-4', value: null, valueText: null,
    format: 'ratio', n: 12, nText: 'n 12', foot: 'LinkedIn, posted 2h ago', state: 'too-new', viz: null,
  },
];

const RADAR: TileProps[] = [
  {
    id: 'event-frame-claude-5-tile', title: 'Claude 5', href: '?event=frame-claude-5', value: 9, valueText: '9h', valueWords: '9 hours',
    format: 'hours', n: 14, nText: 'n 14', foot: '3 of 14 in, wave 1', state: 'ready',
    viz: { kind: 'wave', buckets: [0, 1, 2, 3], nowIndex: 3, window: 'open' },
  },
  {
    id: 'event-frame-veo-4-tile', title: 'Veo 4', href: '?event=frame-veo-4', value: 50, valueText: '2d', valueWords: '2 days',
    format: 'hours', n: 14, nText: 'n 14', foot: '9 of 14 in, closing', state: 'ready',
    viz: { kind: 'wave', buckets: [0, 1, 3, 5, 6, 7, 8, 8, 9], nowIndex: 8, window: 'closing' },
  },
  {
    id: 'event-frame-mcp-tile', title: 'MCP registry', href: '?event=frame-mcp', value: 120, valueText: '5d', valueWords: '5 days',
    format: 'hours', n: 14, nText: 'n 14', foot: '11 of 14 in, wave 2', state: 'ready',
    viz: { kind: 'wave', buckets: [0, 2, 4, 5, 5, 5, 6, 8, 9, 10, 10, 11, 11, 11], nowIndex: 13, window: 'closing' },
  },
];

const POST_SHEET: FramePostSheet = {
  id: 'frame-1',
  title: 'Post',
  caption: 'Reel, 1d old, sample',
  hook: 'I let an agent run my inbox for a week. Here is what it got wrong.',
  readText: '2.3x',
  rangeText: '90% 1.6x to 3.1x',
  nText: 'n 12',
  reads: ['6h 1.1x', '24h 2.3x', '72h pending', '7d pending'],
  viz: { kind: 'band', ageH: 24, points: [{ h: 1, v: 900 }, { h: 6, v: 5200 }, { h: 24, v: 21000 }], band: BAND(6000, 9000, 14000) },
  why: 'Carries two lifts the Playbook shows: a results first hook and a demo inside 3 seconds.',
};

const PERIODS: Period[] = [
  { id: 'w-3', label: '3 weeks ago', from: '2026-09-14', to: '2026-09-20' },
  { id: 'w-2', label: '2 weeks ago', from: '2026-09-21', to: '2026-09-27' },
  { id: 'w-1', label: 'Last week', from: '2026-09-28', to: '2026-10-04' },
  { id: 'w-0', label: 'This week', from: '2026-10-05', to: '2026-10-11' },
];

const TABS = (sample: string): FrameTab[] => [
  { id: 'today', label: 'Today', href: `/lab${sample}`, active: true },
  { id: 'radar', label: 'Radar', href: `/lab/radar${sample}`, active: false },
  { id: 'breakouts', label: 'Breakouts', href: `/lab/breakouts${sample}`, active: false },
  { id: 'playbook', label: 'Playbook', href: `/lab/playbook${sample}`, active: false },
  { id: 'studio', label: 'Studio', href: `/lab/studio${sample}`, active: false },
  { id: 'ledger', label: 'Ledger', href: `/lab/ledger${sample}`, active: false },
];

const NEEDS_KEY = 'Paste an Apify key in Setup first.';
const READ_ONLY = 'Sample data is a read-only preview. Connect Apify to work on real data.';

/** The Today composition as shared-component props, in render order (02 section 16.1). */
export function frameToday(state: Exclude<FrameState, 'components'>, now: Date = new Date(FRAME_NOW)): FrameToday {
  void now; // fixtures are fixed; the clock is a parameter so a later lane can vary it
  const nc = state === 'not-configured';
  const disabledReason = nc ? NEEDS_KEY : READ_ONLY;
  return {
    heroes: heroes(nc),
    brief: nc
      ? { kind: 'brief', label: 'Brief', sentence: null, state: 'not-configured', setupHref: '?setup=keys' }
      : {
          kind: 'brief', label: 'Brief', state: 'sample', nText: 'n 24',
          sentence: 'Results-first hooks are pulling 3.7x in tutorials.',
          meta: '90% 2.9x to 4.6x, correlation',
          href: '/lab/playbook?format=tutorial#lift-hook_form-results_first', hrefLabel: 'Open this finding in Playbook',
          sharedId: 'brief-frame',
        },
    window: windowCard(state),
    yourPosts: nc ? [] : YOUR_POSTS,
    launchRadar: nc ? [] : RADAR,
    nextToMake: nc
      ? []
      : [
          { id: 'idea-frame-1', title: 'First look at Claude 5 on three real tasks', windowText: 'window open', groundedText: 'grounded in 4', action: { label: 'Write script', icon: 'plus', disabled: true, disabledReason } },
          { id: 'idea-frame-2', title: 'I spent 10 hours with Veo 4 so you do not have to', windowText: 'closing', groundedText: 'grounded in 3', action: { label: 'Write script', icon: 'plus', disabled: true, disabledReason } },
        ],
    pipeline: {
      stats: [
        { id: 'scraped', label: 'Scraped', valueText: '441' },
        { id: 'transcribed', label: 'Transcribed', valueText: '52' },
        { id: 'dissected', label: 'Dissected', valueText: '38' },
      ],
      spend: { text: '8.20', spent: 8.2, cap: 30, foot: 'of $30 cap' },
      lastRunText: 'Last run 2h ago, ok',
    },
    ledgerLine: 'Predictions this month: 9 graded, pairwise 62% (n 9, at chance until n 20)',
    notConfigured: nc,
    tabs: TABS(nc ? '' : '?sample=1'),
    quickActions: [
      { label: 'Add source', icon: 'plus', href: '?setup=sources&focus=add' },
      { label: 'New idea', icon: 'plus', disabled: true, disabledReason },
      { label: 'Log a test', icon: 'plus', disabled: true, disabledReason },
      { label: 'Run now', icon: 'play', disabled: true, disabledReason },
    ],
    createMenu: [
      { id: 'add_source', label: 'Add source', href: '?setup=sources&focus=add' },
      { id: 'new_idea', label: 'New idea', disabled: true, disabledReason },
      { id: 'generate', label: 'Generate ideas', disabled: true, disabledReason },
      { id: 'log_test', label: 'Log a test', disabled: true, disabledReason },
      { id: 'outside', label: 'Log an outside score', disabled: true, disabledReason },
      { id: 'intel', label: 'Run intel now', disabled: true, disabledReason },
    ],
    segmented: [
      { id: 'brief', label: 'Brief' },
      { id: 'ask', label: 'Ask the Lab' },
    ],
    periods: PERIODS,
    postSheet: POST_SHEET,
  };
}
