'use client';
/**
 * Today (`/lab`) under Bennett Legacy (founderos-ui pages/lab.md section 1): the posting window as a
 * BigStat with its state chip, the Radar tile as a DotMatrix of live signals, the idea of the day as the
 * page's one InsightCard, the ledger line as a mono sentence, the creator network and the breakout chart
 * in Monolith ink, your numbers with the platform pager, then Brief or Ask, the period scrubber, ideas as
 * SlabCards, your posts and launch radar, Pipeline and Ledger. Reads TodayPageView only.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { BigStat, Chip, DotMatrix, InsightCard, StepLine, VolumeMeter, type Tone } from '@/components/legacy';
import { ChartVisual, NetworkVisual } from '@/components/lab/v2/shared/HeroGraphs';
import { HERO_GRAPH_COPY } from '@/lib/lab/view/hero-graphs';
import type { HeroMetricView, HeroPlatform } from '@/lib/lab/view/shared';
import type { IdeaRowView, PostTileView, TodayPageView } from '@/lib/lab/view/today';
import type { RadarTile } from '@/lib/lab/radar/view';
import { fmtCount, fmtPct } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { tenColumns, waveBuckets } from '../classic/adapt';
import { store, useReplaceParams, useRunProgress } from '../classic/hooks';
import { LEGACY_LAB as L } from './copy';
import { LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Btn, Card, ChipButton, LState, cx, shows, withSample } from './parts';
import { RunPanel } from './RunControl';
import { AgeCurve, Strand } from './viz';

/* ── row A: window, radar, idea of the day ─────────────────────────────── */

function WindowCard({ v }: { v: TodayPageView }) {
  const router = useRouter();
  const { post, busy } = useLabPost();
  const w = v.window;
  const card = w.card;
  const live = w.layer === 'live' && card;
  const make = async () => {
    if (!w.makeAngle || !card || (card.kind !== 'open' && card.kind !== 'closing')) return;
    const r = await post('/api/lab/ideas', { action: 'from_event', eventId: card.eventId, angle: w.makeAngle }, { key: 'make', refresh: false });
    if (r.ok && typeof r.data.href === 'string') router.push(r.data.href);
  };
  const open = live && (card.kind === 'open' || card.kind === 'closing') ? card : null;
  const tone: Tone | undefined = open ? (open.kind === 'open' ? 'ok' : 'warn') : undefined;
  return (
    <Card id="lab-window" title={L.postingWindow} sub={HERO_GRAPH_COPY.windowTag} i={1} className="l-lab-window" tools={w.href ? <Btn href={withSample(w.href, v.frame.mode.sample)} aria-label={L.open}><ArrowUpRight size={12} strokeWidth={1.8} aria-hidden /></Btn> : undefined}>
      {open ? (
        <BigStat display={fmtPct(Math.max(0, 1 - open.progress))} chips={[{ tone, text: open.kind === 'open' ? L.windowOpen : L.windowClosing }]} caption={open.sentence} />
      ) : (
        <>
          <div className="l-chip-row"><Chip>{L.windowNone}</Chip></div>
          <p className="l-lab-lead">{live ? card.sentence : w.message}</p>
        </>
      )}
      {open && <VolumeMeter label={L.windowOpen} frac={Math.max(0, 1 - open.progress)} display={fmtPct(Math.max(0, 1 - open.progress))} compact hue={open.kind === 'open' ? 'var(--l-text)' : 'var(--l-warn)'} />}
      {w.meta && <p className="l-caption">{w.meta}</p>}
      <div className="l-lab-actrow">
        {open && <Btn primary disabled={!!v.frame.readOnly} title={v.frame.readOnly ?? undefined} busy={busy === 'make'} onClick={() => void make()} data-lab-shared="window">{busy === 'make' ? C.today.making : open.action.label}</Btn>}
        {live && card.kind === 'never_run' && <Btn primary onClick={() => window.dispatchEvent(new CustomEvent('lab:run'))}>{C.runNow}</Btn>}
      </div>
    </Card>
  );
}

function RadarTileCard({ v }: { v: TodayPageView }) {
  const lr = v.launchRadar;
  const tiles = lr.tiles.slice(0, 8);
  const cols = tiles.map((t) => ({ label: t.name.length > 9 ? `${t.name.slice(0, 8)}.` : t.name, count: t.series.length ? t.series[t.series.length - 1].creators : 0 }));
  const uniq = cols.map((c, i) => ({ ...c, label: cols.findIndex((x) => x.label === c.label) === i ? c.label : `${c.label}${i}` }));
  return (
    <Card id="lab-radar-tile" title={L.radarTile} sub={shows(lr.state) ? `${fmtCount(lr.total)} ${L.radarSignals}` : L.radarTileSub} i={2} tools={<Btn href={withSample(lr.seeAllHref, v.frame.mode.sample)}>{C.seeAll}</Btn>}>
      <LState state={lr.state} compact />
      {shows(lr.state) && uniq.length > 0 && (
        <>
          <div className="l-lab-dm">
            <DotMatrix cols={uniq} />
          </div>
          <p className="l-caption">{L.radarTileSub}</p>
        </>
      )}
    </Card>
  );
}

function IdeaOfDay({ v }: { v: TodayPageView }) {
  const r = v.nextToMake.rows[0] ?? null;
  if (!r || !shows(v.nextToMake.state)) {
    return (
      <Card id="lab-idea-day" title={L.ideaOfDay} i={3}>
        {v.nextToMake.state.kind === 'ready' ? <p className="l-lab-lead">{L.ideaOfDayNone}</p> : <LState state={v.nextToMake.state} compact />}
      </Card>
    );
  }
  return (
    <Link href={withSample(r.href, v.frame.mode.sample)} className="l-lab-insight-link" data-lab-shared={`idea-day-${r.id}`} aria-label={`${L.ideaOfDay}: ${r.title}`}>
      <InsightCard
        badge={L.ideaOfDay}
        display={fmtCount(r.groundedN)}
        headline={r.title}
        body={[r.windowText, r.groundedText].filter(Boolean).join(' · ')}
        frac={Math.min(1, r.groundedN / 8)}
        i={3}
      />
    </Link>
  );
}

/* ── row B: the two graphs in Monolith ink ───────────────────────────────── */

function NetworkCard({ v }: { v: TodayPageView }) {
  const b = v.brief;
  return (
    <Card id="lab-network" title={L.creatorNetwork} sub={HERO_GRAPH_COPY.briefTag} i={4} className="l-lab-graphcard">
      <div className="l-lab-graph" data-kind="network">
        <NetworkVisual view={v.graphs.network} />
      </div>
      <p className="l-lab-lead">{b.sentence}</p>
      {b.meta && <p className="l-caption">{b.meta}</p>}
      {b.href && <span className="l-lab-actrow"><Btn href={withSample(b.href, v.frame.mode.sample)} data-lab-shared="brief">{C.today.briefLink}</Btn></span>}
    </Card>
  );
}

function ChartCard({ v }: { v: TodayPageView }) {
  const c = v.graphs.chart;
  const ready = c.state.kind === 'ready' && c.points.length > 0;
  return (
    <Card id="lab-chart" title={L.breakoutChart} sub={HERO_GRAPH_COPY.windowTag} i={5} className="l-lab-graphcard">
      {ready && <BigStat value={c.thisWeek} size={30} unit={L.thisWeek} chips={[{ text: fill(L.lastWeek, { n: fmtCount(c.lastWeek) }) }]} />}
      <div className="l-lab-graph" data-kind="chart">
        <ChartVisual view={c} />
      </div>
      {ready && <p className="l-caption">{c.summary}</p>}
    </Card>
  );
}

/* ── row C: your numbers with the platform pager ─────────────────────────── */

function HeroDots({ h }: { h: HeroMetricView }) {
  const prev = tenColumns(h.dots.prev);
  const curr = tenColumns(h.dots.curr);
  const max = Math.max(1e-6, ...[...prev, ...curr].map((x) => (x === null ? 0 : Math.min(x, h.dots.scaleMax))));
  const col = (x: number | null, k: string, now: boolean) => {
    const dots = x === null ? 0 : Math.max(1, Math.round((Math.min(x, h.dots.scaleMax) / max) * 5));
    return (
      <span key={k} className="l-lab-hdot-col" data-now={now ? '' : undefined}>
        {Array.from({ length: 5 }, (_, i) => <span key={i} data-on={i < dots ? '' : undefined} />)}
      </span>
    );
  };
  return (
    <div data-l="DotMatrix" className="l-lab-hdots" aria-hidden="true">
      <span className="l-lab-hdot-group">{prev.map((x, i) => col(x, `p${i}`, false))}</span>
      <span className="l-lab-hdot-group">{curr.map((x, i) => col(x, `c${i}`, true))}</span>
      <span className="l-lab-hdot-label">{h.dots.prevLabel}</span>
      <span className="l-lab-hdot-label">{h.dots.currLabel}</span>
    </div>
  );
}

function Hero({ h }: { h: HeroMetricView }) {
  const tone: Tone | undefined = h.delta.tone === 'up' ? 'ok' : h.delta.tone === 'down' ? 'err' : undefined;
  return (
    <div data-l="LabHero" className="l-lab-hero">
      <span className="l-micro">{h.label}</span>
      <BigStat
        display={h.value.enough && h.value.text ? h.value.text : C.notEnough}
        chips={h.value.enough && h.delta.text ? [{ tone, text: h.delta.text }] : []}
        caption={[h.sub, h.nText].filter(Boolean).join(' · ')}
      />
      <HeroDots h={h} />
      <Link href={h.href} className="l-link">{C.open}</Link>
    </div>
  );
}

function Heroes({ v }: { v: TodayPageView }) {
  const replace = useReplaceParams();
  const [hp, setHp] = useState<HeroPlatform>(v.hp);
  useEffect(() => setHp(v.hp), [v.hp]);
  const cur = v.heroes[hp] ?? v.heroes.all;
  if (!cur) return null;
  const idx = v.heroPlatforms.findIndex((p) => p.id === hp);
  const step = (d: number) => {
    const next = v.heroPlatforms[(idx + d + v.heroPlatforms.length) % v.heroPlatforms.length];
    if (!next) return;
    setHp(next.id);
    replace({ hp: next.id === 'all' ? null : next.id }, { rerender: false });
  };
  return (
    <Card
      id="lab-heroes"
      title={L.heroes}
      i={6}
      tools={
        v.heroPlatforms.length > 1 ? (
          <span data-l="LabPager" className="l-lab-pager" role="group" aria-label={L.platform}>
            <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" aria-label={C.aria.prevPlatform} onClick={() => step(-1)}><ChevronLeft size={12} strokeWidth={1.8} aria-hidden /></button>
            <span className="l-lab-pager-chips">
              {v.heroPlatforms.map((p) => (
                <ChipButton key={p.id} on={p.id === hp} onClick={() => { setHp(p.id); replace({ hp: p.id === 'all' ? null : p.id }, { rerender: false }); }}>{p.label}</ChipButton>
              ))}
            </span>
            <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" aria-label={C.aria.nextPlatform} onClick={() => step(1)}><ChevronRight size={12} strokeWidth={1.8} aria-hidden /></button>
          </span>
        ) : undefined
      }
    >
      <div className="l-lab-heroes" aria-label={C.aria.heroes}>
        <Hero h={cur.yourNormal} />
        <Hero h={cur.breakouts} />
      </div>
    </Card>
  );
}

/* ── the bar: Brief or Ask, and the period scrubber ──────────────────────── */

function Scrubber({ v }: { v: TodayPageView }) {
  const replace = useReplaceParams();
  const [off, setOff] = useState(v.period.offset);
  const timer = useRef<number | null>(null);
  useEffect(() => setOff(v.period.offset), [v.period.offset]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const go = (o: number) => {
    const n = Math.max(-12, Math.min(0, o));
    setOff(n);
    if (timer.current) window.clearTimeout(timer.current);
    // The scrubber moves at once (03.7.1); the server view follows one request after the keys settle.
    timer.current = window.setTimeout(() => replace({ offset: n === 0 ? null : String(n) }), 250);
  };
  // 01 22.1: [ and ] step the period scrubber.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.closest('[role="dialog"]'))) return;
      if (e.key === '[') go(off - 1);
      if (e.key === ']') go(off + 1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off]);
  const label = v.period.ticks.find((t) => t.offset === off)?.label ?? v.period.label;
  return (
    <div data-l="LabScrubber" className="l-lab-scrubber" role="group" aria-label={C.aria.periodBelow}>
      <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" aria-label={C.aria.prevPeriod} disabled={off <= -12} onClick={() => go(off - 1)}><ChevronLeft size={12} strokeWidth={1.8} aria-hidden /></button>
      <span className="l-lab-scrub-ticks">
        {v.period.ticks.map((t) => (
          <button key={t.offset} type="button" className="l-lab-scrub-tick" data-on={t.offset === off ? '' : undefined} aria-label={t.label} aria-pressed={t.offset === off} title={t.label} onClick={() => go(t.offset)} />
        ))}
      </span>
      <span className="l-lab-scrub-label" aria-live="polite">{label}</span>
      <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" aria-label={C.aria.nextPeriod} disabled={off >= 0} onClick={() => go(off + 1)}><ChevronRight size={12} strokeWidth={1.8} aria-hidden /></button>
    </div>
  );
}

function AskPanel({ v }: { v: TodayPageView }) {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try { setRecent((JSON.parse(store.get('lab.ask.recent') ?? '[]') as string[]).slice(0, 5)); } catch { setRecent([]); }
  }, []);
  const ask = (text: string) => {
    const t = text.trim().slice(0, 300);
    if (!t) return;
    store.set('lab.ask.recent', JSON.stringify([t, ...recent.filter((r) => r !== t)].slice(0, 5)));
    const u = new URL(window.location.href);
    u.searchParams.set('ask', t);
    openSheetHref(u.pathname + u.search);
  };
  const off = v.askPanel.state.kind !== 'ready' && v.askPanel.state.kind !== 'thin';
  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };
  return (
    <Card id="ask" title={C.today.askTitle} i={1} className="l-lab-askcard">
      <LState state={v.askPanel.state} />
      <form data-l="LabComposer" className="l-lab-composer" data-disabled={off ? '' : undefined} onSubmit={submit}>
        <span aria-hidden className="l-lab-prompt">{'>'}</span>
        <input value={q} disabled={off} maxLength={300} placeholder={C.today.askPlaceholder} aria-label={C.today.askPlaceholder} onChange={(e) => setQ(e.target.value)} />
        <span aria-hidden className="l-lab-caret">▌</span>
        <Btn primary type="submit" disabled={off || !q.trim()}>{C.today.askSubmit}</Btn>
      </form>
      {!off && (
        <div className="l-chip-row l-lab-gap">
          <span className="l-micro">{C.today.askExamples}</span>
          {v.askPanel.examples.map((e) => <ChipButton key={e} on={false} onClick={() => ask(e)}>{e}</ChipButton>)}
        </div>
      )}
      {!off && recent.length > 0 && (
        <div className="l-chip-row l-lab-gap">
          <span className="l-micro">{C.today.askRecent}</span>
          {recent.map((e) => <ChipButton key={e} on={false} onClick={() => ask(e)}>{e}</ChipButton>)}
        </div>
      )}
    </Card>
  );
}

/* ── lower: ideas, posts, launches, pipeline, ledger ─────────────────────── */

function IdeaCard({ r, v, i }: { r: IdeaRowView; v: TodayPageView; i: number }) {
  const { post, busy } = useLabPost();
  const openScript = (scriptId: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set('script', scriptId);
    openSheetHref(u.pathname + u.search);
  };
  const write = async () => {
    const res = await post('/api/lab/ideas', { id: r.id, action: 'write_script' }, { key: `w-${r.id}`, refresh: false });
    if (res.ok && typeof res.data.scriptId === 'string') openScript(res.data.scriptId);
  };
  return (
    <section data-l="SlabCard" className="l-rise l-rise-card l-card l-lab-ideacard" style={{ ['--l-rise-i' as string]: i }}>
      <Link href={withSample(r.href, v.frame.mode.sample)} className="l-lab-ideacard-title">{r.title}</Link>
      <span className="l-chip-row">
        {r.windowText && <Chip tone={r.windowState === 'open' ? 'ok' : r.windowState === 'closing' ? 'warn' : undefined}>{r.windowText}</Chip>}
        <span className="l-muted">{r.groundedText}</span>
      </span>
      {r.strand && <Strand strand={r.strand} label={r.title} />}
      <span className="l-lab-actrow">
        <Btn href={withSample(r.href, v.frame.mode.sample)}>{L.open}</Btn>
        {r.action.kind === 'open_script' && r.scriptId ? (
          <Btn primary href={`?script=${r.scriptId}`} data-lab-shared={`idea-${r.id}`}>{r.action.label}</Btn>
        ) : (
          <Btn primary busy={busy === `w-${r.id}`} disabled={!!v.frame.readOnly} title={v.frame.readOnly ?? undefined} onClick={() => void write()} data-lab-shared={`idea-${r.id}`}>{busy === `w-${r.id}` ? C.today.writing : r.action.label}</Btn>
        )}
      </span>
    </section>
  );
}

function PostTile({ t, i }: { t: PostTileView; i: number }) {
  const judged = t.read.state === 'judged';
  return (
    <Link href={t.href} scroll={false} data-l="SlabCard" data-lab-card="post" className="l-rise l-rise-card l-card l-lab-tile" style={{ ['--l-rise-i' as string]: i }} data-lab-shared={`post-${t.postId}`} aria-label={`${t.title}, ${t.read.text}`}>
      <span className="l-lab-tile-top">
        <span className="l-micro">{t.platformLabel}</span>
        {t.isNew && <Chip tone="accent">{t.ageText}</Chip>}
      </span>
      <span className="l-lab-tile-title">{t.title}</span>
      <span className="l-lab-tile-num" data-dim={judged ? undefined : ''}>{t.read.text}</span>
      {t.curve && t.curve.points.length >= 2 && <AgeCurve curve={t.curve} mini />}
      <span className="l-lab-tile-foot">{`n ${t.read.n} · ${t.footer}`}</span>
    </Link>
  );
}

function RadarTileItem({ t, i }: { t: RadarTile; i: number }) {
  const buckets = waveBuckets(t.series);
  return (
    <Link href={t.href} scroll={false} data-l="SlabCard" data-lab-card="event" className="l-rise l-rise-card l-card l-lab-tile" style={{ ['--l-rise-i' as string]: i }} data-lab-shared={`event-${t.eventId}`} aria-label={`${t.name}, ${t.stateLabel}, ${t.ageLabel}`}>
      <span className="l-lab-tile-top">
        <span className="l-micro">{t.stateLabel}</span>
        <span className="l-muted">{t.ageLabel}</span>
      </span>
      <span className="l-lab-tile-title">{t.name}</span>
      {buckets.length > 1 && <StepLine series={buckets.map((c, k) => ({ label: `${k}`, count: c }))} height={70} empty="" />}
      <span className="l-lab-tile-foot">{`${t.waveLabel} · ${t.coverageLabel}`}</span>
    </Link>
  );
}

function Row({ id, title, desc, href, children, state }: { id: string; title: string; desc: string; href: string; children?: ReactNode; state: TodayPageView['yourPosts']['state'] }) {
  return (
    <section className="l-lab-row" aria-labelledby={`${id}-t`}>
      <header className="l-lab-row-head">
        <span className="l-lab-row-titles">
          <h2 id={`${id}-t`} className="l-lab-row-title">{title}</h2>
          <span className="l-muted">{desc}</span>
        </span>
        <Btn href={href}>{C.seeAll}</Btn>
      </header>
      <LState state={state} />
      {shows(state) && <div className="l-lab-tiles">{children}</div>}
    </section>
  );
}

function Pipeline({ v }: { v: TodayPageView }) {
  const p = v.pipeline;
  const batch = useRunProgress(v.frame.run.activeBatch);
  const [amount, cap] = p.spend.text.split(' of ');
  const cell = (m: typeof p.scraped, label: string) => (
    <div><dt>{label}</dt><dd>{m.enough && m.text ? m.text : C.notEnough}</dd></div>
  );
  return (
    <Card id="pipe" title={C.today.pipeline} i={2} tools={<Btn href={p.href} data-lab-shared="pipeline">{C.today.pipelineLink}</Btn>}>
      <LState state={p.state} compact />
      {batch ? (
        <RunPanel batch={batch} form="card" readOnly={v.frame.readOnly} />
      ) : shows(p.state) ? (
        <>
          <dl className="l-strip l-lab-strip">
            {cell(p.scraped, C.today.scraped)}
            {cell(p.transcribed, C.today.transcribed)}
            {cell(p.dissected, C.today.dissected)}
            <div><dt>{cap ? fill(C.today.spendOf, { cap }) : C.today.spend}</dt><dd>{amount}</dd></div>
          </dl>
          {p.spend.pct !== null && (
            <VolumeMeter label={C.today.spend} frac={Math.max(0, Math.min(1, p.spend.pct))} display={p.spend.text} compact hue={p.spend.tone === 'over' ? 'var(--l-err)' : p.spend.tone === 'near' ? 'var(--l-warn)' : 'var(--l-text)'} />
          )}
          <p className="l-caption">{p.lastRunText}</p>
        </>
      ) : null}
    </Card>
  );
}

function LedgerCard({ v }: { v: TodayPageView }) {
  const l = v.ledgerLine;
  return (
    <Card id="ledger" title={C.today.ledger} i={3} tools={<Btn href={withSample(l.href, v.frame.mode.sample)}>{C.today.ledgerLink}</Btn>}>
      {shows(l.state) ? <p className="l-lab-lead">{l.sentence}</p> : <LState state={l.state} compact />}
      <p className="l-caption">{C.today.ledgerCap}</p>
    </Card>
  );
}

function Checklist({ v, slim }: { v: TodayPageView; slim?: boolean }) {
  const c = v.checklist!;
  return (
    <section data-l="SlabCard" className={cx('l-card l-lab-checklist', slim && 'is-slim')} aria-labelledby="cl-title">
      <span className="l-lab-checklist-text">
        <h2 id="cl-title" className="l-card-title">{C.today.checklistTitle}</h2>
        <span className="l-muted">{fill(C.today.checklistDone, { done: c.done, total: c.total })}</span>
      </span>
      <span className="l-lab-actrow">
        {c.next && <Btn primary href={c.next.href}>{c.next.label}</Btn>}
        <Btn href={c.href}>{C.setup}</Btn>
      </span>
    </section>
  );
}

const SHEET_KEYS = ['post', 'event', 'idea', 'script', 'test', 'setup', 'ask'] as const;

export function TodayPage({ view }: { view: TodayPageView }) {
  return (
    <LegacyCapHost>
      <TodayBody view={view} />
    </LegacyCapHost>
  );
}

function TodayBody({ view }: { view: TodayPageView }) {
  const replace = useReplaceParams();
  const [seg, setSeg] = useState<'brief' | 'ask'>(view.seg);
  const sp = useSearchParams();
  const sheetOpen = SHEET_KEYS.some((k) => !!sp?.get(k));
  const empty = view.frame.mode.state === 'empty';
  const sample = view.frame.mode.sample;
  const l = view.ledgerLine;
  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      <div className="l-lab-today" data-sheet-open={sheetOpen ? '' : undefined}>
        <div className="l-lab-grid3">
          <WindowCard v={view} />
          <RadarTileCard v={view} />
          <IdeaOfDay v={view} />
        </div>
        <p data-l="LabLedgerLine" className="l-lab-ledgerline">
          <span className="l-lab-prompt" aria-hidden>{'//'}</span>
          {shows(l.state) ? l.sentence : l.state.message}
        </p>
        <div className="l-lab-grid2">
          <NetworkCard v={view} />
          <ChartCard v={view} />
        </div>
        <Heroes v={view} />

        {empty && view.checklist ? (
          <Checklist v={view} />
        ) : (
          <>
            <div data-l="LabBar" className="l-lab-bar">
              <span className="l-chip-row" role="tablist" aria-label={C.aria.todayView}>
                {(['brief', 'ask'] as const).map((id) => (
                  <ChipButton key={id} role="tab" on={seg === id} aria-selected={seg === id} aria-controls="l-lab-today-lower" onClick={() => { setSeg(id); replace({ seg: id === 'brief' ? null : id }, { rerender: false }); }}>
                    {C.today.seg[id]}
                  </ChipButton>
                ))}
              </span>
              <Scrubber v={view} />
            </div>
            <div id="l-lab-today-lower" role="tabpanel" className="l-stack">
              {seg === 'ask' ? (
                <AskPanel v={view} />
              ) : (
                <>
                  {view.checklist && <Checklist v={view} slim />}
                  <section className="l-lab-row" aria-labelledby="next-t">
                    <header className="l-lab-row-head">
                      <span className="l-lab-row-titles">
                        <h2 id="next-t" className="l-lab-row-title">{view.nextToMake.title}</h2>
                        <span className="l-muted">{C.today.nextDesc}</span>
                      </span>
                      <Btn href={withSample(view.nextToMake.allHref, sample)}>{C.today.allIdeas}</Btn>
                    </header>
                    <LState state={view.nextToMake.state} />
                    {shows(view.nextToMake.state) && (
                      <div className="l-lab-grid3">
                        {view.nextToMake.rows.slice(0, 6).map((r, i) => <IdeaCard key={r.id} r={r} v={view} i={i + 1} />)}
                      </div>
                    )}
                  </section>
                  <Row id="your-posts" title={view.yourPosts.title} desc={view.yourPosts.description} href={withSample(view.yourPosts.seeAllHref, sample)} state={view.yourPosts.state}>
                    {view.yourPosts.tiles.map((t, i) => <PostTile key={t.postId} t={t} i={i + 1} />)}
                  </Row>
                  <Row id="launch-radar" title={view.launchRadar.title} desc={view.launchRadar.description} href={withSample(view.launchRadar.seeAllHref, sample)} state={view.launchRadar.state}>
                    {view.launchRadar.tiles.map((t, i) => <RadarTileItem key={t.eventId} t={t} i={i + 1} />)}
                  </Row>
                  <div className="l-lab-grid2">
                    <Pipeline v={view} />
                    <LedgerCard v={view} />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}
