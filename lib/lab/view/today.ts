/**
 * Today (`/lab`) page model (01 7.2) and its builder. Wraps 04's hero maths, 05's WindowCardView
 * and RadarTile, and 06's ledgerLine unchanged.
 */
import type { LabPlatform } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import type { ChecklistView } from '@/lib/lab/setup/checklist';
import { FEATURE_LABEL } from '@/lib/lab/distill';
import { familyLabel, humanize, ideaCardsFor, ladderView } from '@/lib/lab/view/legacy';
import { heroBreakouts, heroNormal } from '@/lib/lab/measure/view';
import { eventSheetView, radarTiles, windowCardView } from '@/lib/lab/radar/view';
import { ledgerLine } from '@/lib/lab/ledger/view';
import { testMark } from '@/lib/lab/ledger/tests';
import { lineCapFor, lineSpend } from '@/lib/lab/spend';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtAge, fmtCount, fmtDelta, fmtRange, fmtRatio, fmtSigned, fmtUsd, nText } from '@/lib/lab/view/format';
import { periodFor } from '@/lib/lab/view/period';
import { postTile, readOf } from '@/lib/lab/view/posts';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { StrandView } from '@/lib/lab/view/legacy';
import type { AgeMatchedView, HeroMetricView, HeroPlatform, LabPlatformId, SectionState } from '@/lib/lab/view/shared';
import type { Measured } from '@/lib/lab/view/legacy';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { PeriodView } from '@/lib/lab/view/period';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { RadarTile, WindowCardView } from '@/lib/lab/radar/view';
import type { AngleId } from '@/lib/lab/radar/angles';
import type { TestMark } from '@/lib/lab/ledger/tests';
import { emptyHeroGraphs, heroGraphs, type HeroGraphsView } from '@/lib/lab/view/hero-graphs';

export type TodayPageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  period: PeriodView;
  hp: HeroPlatform;
  /** 'all' first, then platforms with posts in 60d, order instagram tiktok youtube linkedin twitter */
  heroPlatforms: { id: HeroPlatform; label: string }[];
  heroes: Record<HeroPlatform, { yourNormal: HeroMetricView; breakouts: HeroMetricView } | undefined>;
  brief: BriefCardView;
  window: TodayWindowView;
  /** The graphs on the two gradient cards: creator network (Brief card) and breakout chart (Window card). Brief and Window become their captions. */
  graphs: HeroGraphsView;
  seg: 'brief' | 'ask';
  askPanel: { state: SectionState; recent: { q: string; href: string }[]; examples: string[] };
  yourPosts: { title: 'Your posts'; description: 'Judged at their age, against your normal'; state: SectionState; tiles: PostTileView[]; total: number; seeAllHref: string };
  /** RadarTile from section 05 radarTiles() */
  launchRadar: { title: 'Launch radar'; description: 'Events with an open window'; state: SectionState; tiles: RadarTile[]; total: number; seeAllHref: '/lab/radar' };
  nextToMake: { title: 'Next to make'; state: SectionState; rows: IdeaRowView[]; total: number; allHref: '/lab/studio' };
  pipeline: PipelineCardView;
  ledgerLine: LedgerLineView;
  /** non-null when mode.state === 'empty' OR any checklist step undone; null in the sample world (its checklist is not this install's) */
  checklist: ChecklistSummaryView | null;
};

export type BriefCardView = {
  state: 'finding' | 'not_enough' | 'not_built' | 'error';
  label: 'Brief';
  /** finding: 7.4; not_enough: LAB_COPY.notEnoughBrief + " The Brief needs 8 breakouts in one format."; not_built: LAB_COPY.layer.measure */
  sentence: string;
  /** "n 24 · 90% 2.9x to 4.6x · confirmed by test (2 of 2)"; last part = section 06 testMark().label */
  meta: string | null;
  /** "/lab/playbook?format=<family>#lift-<feature>-<value>" */
  href: string | null;
  /** section 06 testMark */
  mark: TestMark | null;
};

/** Wraps section 05's WindowCardView. The only time-left value is 05's `progress`. */
export type TodayWindowView = {
  layer: 'live' | 'not_built' | 'error';
  label: 'Window';
  /** section 05 windowCardView(store, now); null when layer is not 'live' */
  card: WindowCardView | null;
  /** not_built: LAB_COPY.layer.radar; error: section error copy (4.7) */
  message: string | null;
  /** "First wave so far: 1.9x your normal (n 3)" or null (7.5) */
  meta: string | null;
  /** section 05 recommendAngle(event).angle for the card's event; null only when there is no open or closing card */
  makeAngle: AngleId | null;
  /** "?event=<card.eventId>" for open and closing */
  href: string | null;
};

export type PostTileView = {
  postId: string;
  /** "?post=<id>" */
  href: string;
  platform: LabPlatformId;
  /** "Reel" (instagram), "TikTok", "Short" (youtube, duration <= 180s) | "YouTube", "LinkedIn", "X" */
  platformLabel: string;
  /** hook text, first 48 chars at a word boundary */
  title: string;
  postedAt: string;
  /** fmtAge */
  ageText: string;
  read: AgeMatchedView;
  /** band = owner's normal 25th-75th pct at age h */
  curve: { points: { h: number; views: number }[]; band: { h: number; lo: number; hi: number }[] } | null;
  /** "at 24h" | "too new, next read at 6h" | "24h left" etc (7.6) */
  footer: string;
  isNew: boolean;
};

export type IdeaRowView = {
  id: string;
  /** "/lab/studio?idea=<id>" */
  href: string;
  title: string;
  strand: StrandView | null;
  /** event window if event-linked, else v1 trend timing */
  windowState: 'early' | 'open' | 'closing' | 'closed' | null;
  /** "window open" | "early" | "closing" | null */
  windowText: string | null;
  groundedN: number;
  /** "grounded in 4" */
  groundedText: string;
  scriptId: string | null;
  action: { label: 'Write script' | 'Open script'; kind: 'write_script' | 'open_script' };
};

export type PipelineCardView = {
  state: SectionState;
  /** posts read in period; text "441" */
  scraped: Measured;
  transcribed: Measured;
  dissected: Measured;
  /** "$8.20 of $46" ; near >= 0.8, over >= 1 */
  spend: { text: string; pct: number | null; tone: 'ok' | 'near' | 'over' };
  /** "Last run 2h ago, ok" | "Last run failed 3h ago" | "No runs yet" */
  lastRunText: string;
  href: '?setup=spend';
};

export type LedgerLineView = {
  /** not_built until layers.ledger live */
  state: SectionState;
  /** section 06 ledgerLine(store, now), verbatim (7.7) */
  sentence: string;
  href: '/lab/ledger';
};

/** From section 08 ChecklistView: done = requiredDone, total = requiredTotal, next = first required 'todo' step. */
export type ChecklistSummaryView = { done: number; total: number; next: { label: string; href: string } | null; href: '?setup=checklist' };

/* ── builder (01 7) ───────────────────────────────────────────────────── */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PLATFORM_ORDER: LabPlatformId[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'];
const PLATFORM_NAME: Record<LabPlatformId, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };
const FEATURE_NOUN_ALIAS: Record<string, string> = { emotional_trigger: 'trigger', hook_channel: 'channel', structure_type: 'structure', cta_type: 'cta' };

export type HeroRow = { postedAt: string; ratio: number | null; platform: LabPlatform; owned: boolean; isBreakout: boolean; judged: boolean };

function heroRows(store: LabStore, now: Date, measureLive: boolean): HeroRow[] {
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const out: HeroRow[] = [];
  const from = now.getTime() - 60 * DAY;
  for (const p of store.posts.all()) {
    if (!p.postedAt || Date.parse(p.postedAt) < from) continue;
    const m = measures.get(p.id) ?? null;
    let ratio: number | null = null;
    let judged = false;
    if (measureLive) {
      const read = readOf(m, p, now);
      judged = read.state === 'judged';
      ratio = judged ? read.ratio : null;
    } else {
      const l = ladderView(m);
      judged = l.enough;
      ratio = l.ratio;
    }
    out.push({ postedAt: p.postedAt, ratio, platform: p.platform, owned: p.isOwned, isBreakout: Boolean(m?.isBreakout), judged });
  }
  return out;
}

const iso = (t: number) => new Date(t).toISOString();
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

function dailyBuckets(rows: HeroRow[], fromMs: number, days: number, reduce: (rs: HeroRow[]) => number | null): (number | null)[] {
  const out: (number | null)[] = [];
  for (let d = 0; d < days; d++) {
    const a = fromMs + d * DAY;
    const b = a + DAY;
    const inDay = rows.filter((r) => {
      const t = Date.parse(r.postedAt);
      return t >= a && t < b;
    });
    out.push(reduce(inDay));
  }
  return out;
}

const onHp = (p: LabPlatform, hp: HeroPlatform) => hp === 'all' || p === hp;

export function heroesFor(rows: HeroRow[], hp: HeroPlatform, now: Date, measureLive: boolean, sample: boolean): { yourNormal: HeroMetricView; breakouts: HeroMetricView } {
  const t = now.getTime();
  const c = LAB_COPY.today;
  const owned = rows.filter((r) => r.owned && onHp(r.platform, hp));
  const p1 = { from: iso(t - 30 * DAY), to: iso(t), prevFrom: iso(t - 60 * DAY) };
  const h1 = heroNormal(owned.map((r) => ({ postedAt: r.postedAt, ratio: r.ratio, platform: r.platform })), p1, hp);
  const deltaPct = h1.value !== null && h1.prev !== null && h1.prev > 0 ? Math.round((h1.value / h1.prev - 1) * 100) : null;
  const tone = (v: number | null) => (v === null ? null : v > 2 ? 'up' : v < -2 ? 'down' : 'flat') as 'up' | 'down' | 'flat' | null;
  const ratiosDay = (rs: HeroRow[]) => median(rs.filter((r) => r.ratio !== null).map((r) => r.ratio as number));
  const prev1 = dailyBuckets(owned, t - 60 * DAY, 30, ratiosDay);
  const curr1 = dailyBuckets(owned, t - 30 * DAY, 30, ratiosDay);
  const max1 = Math.max(0, ...[...prev1, ...curr1].filter((x): x is number => x !== null));
  const yourNormal: HeroMetricView = {
    id: 'your_normal',
    label: measureLive ? c.yourNormal : `${c.yourNormal}${c.notAgeMatchedSuffix}`,
    value: { value: h1.enough ? h1.value : null, n: h1.n, enough: h1.enough && h1.value !== null, text: h1.enough && h1.value !== null ? fmtRatio(h1.value) : null },
    delta: measureLive && deltaPct !== null ? { value: deltaPct, text: fmtDelta(deltaPct), tone: tone(deltaPct) } : { value: null, text: null, tone: null },
    dots: { prev: prev1, curr: curr1, prevLabel: c.last30, currLabel: c.this30, scaleMax: Math.min(10, Math.max(3, max1)) },
    nText: nText(h1.n),
    href: withSample('/lab/breakouts?mine=1', sample),
    sub: null,
  };
  const tracked = rows.filter((r) => !r.owned && r.judged && onHp(r.platform, hp));
  const p2 = { from: iso(t - 7 * DAY), to: iso(t), prevFrom: iso(t - 14 * DAY) };
  const h2 = heroBreakouts(tracked.map((r) => ({ postedAt: r.postedAt, isBreakout: r.isBreakout, owned: false, platform: r.platform })), p2, hp);
  const enough2 = h2.judged >= 5;
  const countDay = (rs: HeroRow[]) => rs.filter((r) => r.isBreakout).length;
  const prev2 = dailyBuckets(tracked, t - 14 * DAY, 7, countDay);
  const curr2 = dailyBuckets(tracked, t - 7 * DAY, 7, countDay);
  const max2 = Math.max(0, ...[...prev2, ...curr2].filter((x): x is number => x !== null));
  const d2 = h2.value - h2.prev;
  const breakouts: HeroMetricView = {
    id: 'breakouts',
    label: measureLive ? c.breakouts : `${c.breakouts}${c.notAgeMatchedSuffix}`,
    value: { value: enough2 ? h2.value : null, n: h2.judged, enough: enough2, text: enough2 ? String(h2.value) : null },
    delta: measureLive && enough2 ? { value: d2, text: fmtSigned(d2), tone: d2 > 0 ? 'up' : d2 < 0 ? 'down' : 'flat' } : { value: null, text: null, tone: null },
    dots: { prev: prev2, curr: curr2, prevLabel: c.lastWk, currLabel: c.thisWk, scaleMax: Math.min(10, Math.max(3, max2)) },
    nText: nText(h2.judged),
    href: withSample('/lab/breakouts?window=7', sample),
    sub: fill(c.ofTracked, { n: h2.judged }),
  };
  return { yourNormal, breakouts };
}

/** 01 7.4 Brief candidates: shown lifts across every family, contradicted ones dropped, confirmed first, then lo desc, top 5. */
export function briefCandidates(store: LabStore): { family: string; feature: string; value: string; lift: number; lo: number; hi: number; n: number; mark: TestMark; markLabel: string }[] {
  const out: ReturnType<typeof briefCandidates> = [];
  for (const p of store.profiles.latest()) {
    for (const f of p.features) {
      if (!f.shown || f.lift === null || f.lo === null || f.hi === null || !(f.lo > 1)) continue;
      const tm = testMark(store, `${f.feature}:${f.value}`, 1);
      if (tm.mark === 'contradicted') continue;
      out.push({ family: p.formatFamily, feature: f.feature, value: f.value, lift: f.lift, lo: f.lo, hi: f.hi, n: f.n, mark: tm.mark, markLabel: tm.label });
    }
  }
  out.sort((a, b) => Number(b.mark === 'confirmed') - Number(a.mark === 'confirmed') || b.lo - a.lo || a.feature.localeCompare(b.feature) || a.value.localeCompare(b.value));
  return out.slice(0, 5);
}

/** Days since 1970-01-01 in local time: the Brief's pick rotates at local midnight. */
export function localDayIndex(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY);
}

export function briefCard(store: LabStore, now: Date, measureLive: boolean, sample: boolean): BriefCardView {
  const c = LAB_COPY.today;
  if (!measureLive) return { state: 'not_built', label: 'Brief', sentence: LAB_COPY.layer.measure, meta: null, href: null, mark: null };
  const cands = briefCandidates(store);
  if (!cands.length) return { state: 'not_enough', label: 'Brief', sentence: c.briefNotEnough, meta: null, href: withSample('/lab/playbook', sample), mark: null };
  const pick = cands[localDayIndex(now) % cands.length];
  const nounKey = FEATURE_NOUN_ALIAS[pick.feature] ?? pick.feature;
  const noun = LAB_COPY.featureNoun[nounKey] ?? (FEATURE_LABEL[pick.feature] ?? humanize(pick.feature)).toLowerCase();
  return {
    state: 'finding',
    label: 'Brief',
    sentence: fill(c.briefSentence, { value: humanize(pick.value), noun, lift: fmtRatio(pick.lift), family: familyLabel(pick.family) }),
    meta: `${nText(pick.n)} · 90% ${fmtRange(pick.lo, pick.hi)} · ${pick.markLabel}`,
    href: withSample(`/lab/playbook?format=${encodeURIComponent(pick.family)}`, sample) + `#lift-${pick.feature}-${pick.value}`,
    mark: pick.mark,
  };
}

export function windowView(store: LabStore, now: Date, radarLive: boolean, opts: { sample: boolean; dry: boolean }): TodayWindowView {
  if (!radarLive) return { layer: 'not_built', label: 'Window', card: null, message: LAB_COPY.layer.radar, meta: null, makeAngle: null, href: null };
  const card = windowCardView(store, now, opts);
  if (card.kind !== 'open' && card.kind !== 'closing') return { layer: 'live', label: 'Window', card, message: null, meta: null, makeAngle: null, href: null };
  const ev = eventSheetView(store, card.eventId, now, opts);
  const first = (ev?.posts ?? []).filter((p) => p.wavePosition === 'first' && p.ratio !== null && !p.isOwned).map((p) => p.ratio as number);
  const m = median(first);
  return {
    layer: 'live',
    label: 'Window',
    card,
    message: null,
    meta: m !== null && first.length >= 1 ? fill(LAB_COPY.today.windowMeta, { ratio: fmtRatio(m), k: first.length }) : null,
    makeAngle: ev?.recommendedAngle ?? 'first_look',
    href: withSample(`?event=${encodeURIComponent(card.eventId)}`, opts.sample),
  };
}

function ideaWindow(store: LabStore, eventId: string | null, timing: string | null): IdeaRowView['windowState'] {
  if (eventId) {
    const e = store.events.get(eventId);
    if (e?.windowState) return e.windowState;
  }
  return timing === 'early' || timing === 'open' || timing === 'closing' || timing === 'closed' ? timing : null;
}

export function windowTextOf(ws: IdeaRowView['windowState']): string | null {
  const c = LAB_COPY.today;
  return ws === 'open' ? c.windowOpen : ws === 'early' ? c.windowEarly : ws === 'closing' ? c.windowClosing : ws === 'closed' ? c.windowClosed : null;
}

export function ideaRows(store: LabStore, now: Date, sample: boolean, max = 3): { rows: IdeaRowView[]; total: number } {
  const ideas = store.ideas.all('open');
  const cards = ideaCardsFor(store, ideas, { now });
  const byId = new Map(ideas.map((i) => [i.id, i]));
  const rows = cards.map((card): IdeaRowView & { fit: number; openEvent: boolean } => {
    const idea = byId.get(card.id);
    const ws = ideaWindow(store, idea?.eventId ?? null, card.timing);
    return {
      id: card.id,
      href: withSample(`/lab/studio?idea=${encodeURIComponent(card.id)}`, sample),
      title: card.title,
      strand: card.strand,
      windowState: ws,
      windowText: windowTextOf(ws),
      groundedN: card.evidence.length,
      groundedText: fill(LAB_COPY.today.grounded, { n: card.evidence.length }),
      scriptId: card.scriptId,
      action: card.scriptId ? { label: 'Open script', kind: 'open_script' } : { label: 'Write script', kind: 'write_script' },
      fit: card.fit,
      openEvent: Boolean(idea?.eventId) && (ws === 'open' || ws === 'closing'),
    };
  });
  rows.sort((a, b) => Number(b.openEvent) - Number(a.openEvent) || b.fit - a.fit);
  return { rows: rows.slice(0, max).map(({ fit: _f, openEvent: _o, ...r }) => r), total: rows.length };
}

export function pipelineCard(store: LabStore, from: number, to: number, now: Date, env: Record<string, string | undefined>): PipelineCardView {
  const c = LAB_COPY.today;
  const runs = store.runs.recent(1000);
  const inPeriod = runs.filter((r) => r.finishedAt && Date.parse(r.finishedAt) >= from && Date.parse(r.finishedAt) < to && r.status === 'succeeded');
  const sum = (kind: string) => inPeriod.filter((r) => r.kind === kind).reduce((a, r) => a + (r.items ?? 0), 0);
  const count = (v: number): Measured => ({ value: v, n: v, enough: true, text: fmtCount(v) });
  const spent = lineSpend(store, 'apify.sync', now);
  const cap = lineCapFor('apify.sync', env);
  const pct = cap ? spent / cap : null;
  const last = runs[0];
  const ago = (iso: string) => fmtAge((now.getTime() - Date.parse(iso)) / HOUR);
  const lastRunText = !last ? c.noRuns
    : last.status === 'running' || last.status === 'queued' ? fill(c.lastRunRunning, { age: ago(last.startedAt) })
    : last.status === 'succeeded' ? fill(c.lastRunOk, { age: ago(last.finishedAt ?? last.startedAt) })
    : fill(c.lastRunFailed, { age: ago(last.finishedAt ?? last.startedAt) });
  return {
    state: runs.length ? READY : state('empty', c.noRuns),
    scraped: count(sum('scrape')),
    transcribed: count(sum('transcribe')),
    dissected: count(sum('dissect')),
    spend: { text: cap === null ? fmtUsd(spent) : fill(c.spendOf, { spent: fmtUsd(spent), cap: fmtUsd(cap) }), pct, tone: pct === null ? 'ok' : pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok' },
    lastRunText,
    href: '?setup=spend',
  };
}

export function checklistSummary(cl: ChecklistView, sample: boolean): ChecklistSummaryView {
  const next = cl.steps.find((s) => s.required && s.state === 'todo') ?? null;
  return { done: cl.requiredDone, total: cl.requiredTotal, next: next ? { label: next.title, href: withSample(next.href, sample) } : null, href: '?setup=checklist' };
}

export type TodayInputs = { frame: LabFrameView; sheet: SheetPayload | null; env: Record<string, string | undefined>; checklist: ChecklistView | null };

export function buildToday(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: TodayInputs): TodayPageView {
  const { frame } = inp;
  const sample = Boolean(flags.sample);
  const S = (h: string) => withSample(h, sample);
  const layers = frame.layers;
  const measureLive = layers.measure === 'live';
  const c = LAB_COPY.today;
  const keep = (extra: Record<string, string | number>) => {
    const q = new URLSearchParams();
    if (params.hp !== 'all') q.set('hp', params.hp);
    if (params.seg !== 'brief') q.set('seg', params.seg);
    for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
    if (sample) q.set('sample', '1');
    return `/lab?${q.toString()}`;
  };
  const period = periodFor(params.period, params.offset, now, (u, o) => keep({ period: u, offset: o }));
  const notConfigured = frame.mode.state === 'not_configured';
  const empty = frame.mode.state === 'empty';
  const emptyState = state('empty');

  const base: TodayPageView = {
    frame,
    sheet: inp.sheet,
    period,
    hp: params.hp,
    heroPlatforms: [{ id: 'all', label: c.allPlatforms }],
    heroes: {} as TodayPageView['heroes'],
    brief: { state: 'not_enough', label: 'Brief', sentence: c.briefNotEnough, meta: null, href: null, mark: null },
    window: { layer: 'live', label: 'Window', card: null, message: null, meta: null, makeAngle: null, href: null },
    graphs: emptyHeroGraphs(),
    seg: params.seg,
    askPanel: { state: layers.ask === 'live' ? READY : state('not_built', LAB_COPY.layer.ask), recent: [], examples: [...c.askExamples] },
    yourPosts: { title: 'Your posts', description: 'Judged at their age, against your normal', state: emptyState, tiles: [], total: 0, seeAllHref: S('/lab/breakouts?mine=1&window=30') },
    launchRadar: { title: 'Launch radar', description: 'Events with an open window', state: emptyState, tiles: [], total: 0, seeAllHref: '/lab/radar' },
    nextToMake: { title: 'Next to make', state: emptyState, rows: [], total: 0, allHref: '/lab/studio' },
    pipeline: { state: emptyState, scraped: { value: 0, n: 0, enough: true, text: '0' }, transcribed: { value: 0, n: 0, enough: true, text: '0' }, dissected: { value: 0, n: 0, enough: true, text: '0' }, spend: { text: fmtUsd(0), pct: null, tone: 'ok' }, lastRunText: c.noRuns, href: '?setup=spend' },
    ledgerLine: { state: layers.ledger === 'live' ? READY : state('not_built', LAB_COPY.layer.ledger), sentence: layers.ledger === 'live' ? '' : LAB_COPY.layer.ledger, href: '/lab/ledger' },
    checklist: null,
  };
  if (notConfigured) {
    base.heroPlatforms = [];
    base.brief = { state: 'not_enough', label: 'Brief', sentence: '', meta: null, href: null, mark: null };
    base.window = { layer: 'live', label: 'Window', card: null, message: null, meta: null, makeAngle: null, href: null };
    return base;
  }

  const P = 'today';
  // heroes
  section(P, 'heroes', () => {
    const rows = heroRows(store, now, measureLive);
    const present = new Set(rows.map((r) => r.platform));
    base.heroPlatforms = [{ id: 'all', label: c.allPlatforms }, ...PLATFORM_ORDER.filter((p) => present.has(p)).map((p) => ({ id: p as HeroPlatform, label: PLATFORM_NAME[p] }))];
    for (const hp of base.heroPlatforms) base.heroes[hp.id] = heroesFor(rows, hp.id, now, measureLive, sample);
    if (!base.heroes[base.hp]) base.hp = 'all';
  }, () => undefined);

  base.brief = section(P, 'brief', () => briefCard(store, now, measureLive, sample), (s) => ({ state: 'error', label: 'Brief', sentence: s.message ?? '', meta: null, href: null, mark: null }));
  base.graphs = section(P, 'graphs', () => heroGraphs(store, now, sample), (s) => emptyHeroGraphs(s));
  base.window = section(P, 'window', () => windowView(store, now, layers.radar === 'live', { sample, dry: Boolean(flags.dry) }), (s) => ({ layer: 'error', label: 'Window', card: null, message: s.message, meta: null, makeAngle: null, href: null }));

  if (!sample && inp.checklist && (empty || !inp.checklist.complete)) base.checklist = checklistSummary(inp.checklist, sample);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  // Your posts (period scoped)
  base.yourPosts = section(P, 'yourPosts', () => {
    const owned = store.posts.all().filter((p) => p.isOwned && p.postedAt && Date.parse(p.postedAt) >= from && Date.parse(p.postedAt) < to).sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
    const ownedSources = store.sources.all('owned').filter((s) => s.status === 'active').length;
    const hooks = new Map(store.dissections.all().map((d) => [d.postId, d.hookText]));
    const tiles = owned.slice(0, 12).map((p) => postTile(store, p, store.measures.get(p.id), hooks.get(p.id) || p.caption.split('\n')[0], now, now.getTime() - 7 * DAY, sample));
    const st = tiles.length ? READY : state('empty', fill(c.noPosts, { period: period.label.toLowerCase() }), ownedSources === 0 ? { label: c.addAccounts, href: S('?setup=sources&focus=add') } : null);
    return { ...base.yourPosts, state: st, tiles, total: owned.length };
  }, (s) => ({ ...base.yourPosts, state: s }));

  base.launchRadar = section(P, 'launchRadar', () => {
    if (layers.radar !== 'live') return { ...base.launchRadar, state: state('not_built', LAB_COPY.layer.radar) };
    const tiles = radarTiles(store, now, { sample, dry: Boolean(flags.dry) }).map((t) => ({ ...t, href: withSample(t.href, sample) }));
    return { ...base.launchRadar, state: tiles.length ? READY : state('empty', c.noWindows), tiles, total: tiles.length };
  }, (s) => ({ ...base.launchRadar, state: s }));

  base.nextToMake = section(P, 'nextToMake', () => {
    const { rows, total } = ideaRows(store, now, sample);
    return { ...base.nextToMake, state: rows.length ? READY : state('empty', c.noIdeas, { label: LAB_COPY.frame.generateIdeas, href: S('/lab/studio#generate') }), rows, total };
  }, (s) => ({ ...base.nextToMake, state: s }));

  base.pipeline = section(P, 'pipeline', () => pipelineCard(store, from, to, now, inp.env), (s) => ({ ...base.pipeline, state: s }));

  base.ledgerLine = section(P, 'ledgerLine', () => (layers.ledger === 'live' ? { state: READY, sentence: ledgerLine(store, now), href: '/lab/ledger' as const } : base.ledgerLine), (s) => ({ state: s, sentence: s.message ?? '', href: '/lab/ledger' as const }));

  // an empty install shows the checklist instead of the lower sections (01 4.5)
  if (empty) {
    base.yourPosts = { ...base.yourPosts, tiles: [] };
  }
  return base;
}
