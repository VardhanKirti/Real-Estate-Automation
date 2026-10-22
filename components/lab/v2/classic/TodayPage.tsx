'use client';
/**
 * Today (`/lab`), Classic tree (01 7). Same composition as the approved frames (today--c-console--*):
 * heroes and two narrative cards, the Brief / Ask segment and the period scrubber, Your posts and Launch
 * radar rows, Next to make, Pipeline and Ledger. Reads TodayPageView only.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ActionPill, CapViz, Glass, HeroPair, NarrativeCard, PeriodScrubber, Segmented, Tile, TileRow, type HeroPage } from '@/components/lab/v2/shared';
import { HERO_GRAPH_COPY } from '@/lib/lab/view/hero-graphs';
import { ChartVisual, NetworkVisual } from '@/components/lab/v2/shared/HeroGraphs';
import { useLabCountUp } from '@/components/lab/v2/shared/motion/useCountUp';
import { useLabIntro } from '@/components/lab/v2/shared/motion/useLabIntro';
import { useWindowPulse } from '@/components/lab/v2/shared/motion/useWindowPulse';
import type { TodayPageView } from '@/lib/lab/view/today';
import { heroPageId, heroPages, heroPlatformOf, postTileProps, radarTileProps } from './adapt';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { useReplaceParams, useRunProgress, store } from './hooks';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { StateLine, shows } from './parts';
import { RunPanel } from './progress/RunPanel';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

function BriefCard({ v, paused }: { v: TodayPageView; paused: boolean }) {
  const b = v.brief;
  const state = b.state === 'finding' ? 'ready' : b.state === 'not_enough' ? 'thin' : 'none';
  return (
    <NarrativeCard
      kind="brief"
      label={v.graphs.network.label}
      visual={<NetworkVisual view={v.graphs.network} />}
      captionTag={HERO_GRAPH_COPY.briefTag}
      sentence={b.sentence}
      meta={b.meta ?? (b.state === 'finding' ? undefined : '')}
      href={b.href ?? undefined}
      hrefLabel={C.today.briefLink}
      sharedId="brief"
      state={state}
      paused={paused}
    />
  );
}

function WindowCard({ v, paused, introPlaying }: { v: TodayPageView; paused: boolean; introPlaying: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const w = v.window;
  const card = w.card;
  // 03.6.3: the once-per-event ring, on a wrapper that stays mounted whichever state the card is in.
  useWindowPulse(wrap, card && (card.kind === 'open' || card.kind === 'closing') ? card.eventId : null, introPlaying);
  return <div ref={wrap} className="lab2c-cardwrap"><WindowCardBody v={v} paused={paused} /></div>;
}

function WindowCardBody({ v, paused }: { v: TodayPageView; paused: boolean }) {
  const router = useRouter();
  const { post, busy } = useLabPost();
  const w = v.window;
  const card = w.card;
  const vis = { label: v.graphs.chart.label, visual: <ChartVisual view={v.graphs.chart} />, captionTag: HERO_GRAPH_COPY.windowTag };
  if (w.layer !== 'live' || !card) {
    return <NarrativeCard kind="window" {...vis} sentence={w.message} state="none" paused={paused} />;
  }
  if (card.kind === 'none') return <NarrativeCard kind="window" {...vis} sentence={card.sentence} state="none" paused={paused} />;
  if (card.kind === 'never_run') {
    return (
      <NarrativeCard
        paused={paused}
        kind="window"
        {...vis}
        sentence={card.sentence}
        windowT={1}
        state="ready"
        action={{ label: C.runNow, onClick: () => window.dispatchEvent(new CustomEvent('lab:run')) }}
      />
    );
  }
  const make = async () => {
    if (!w.makeAngle) return;
    const r = await post('/api/lab/ideas', { action: 'from_event', eventId: card.eventId, angle: w.makeAngle }, { key: 'make', refresh: false });
    if (r.ok && typeof r.data.href === 'string') router.push(r.data.href);
  };
  return (
    <NarrativeCard
      kind="window"
      {...vis}
      sentence={card.sentence}
      meta={w.meta ?? undefined}
      windowT={card.progress}
      href={w.href ?? undefined}
      sharedId="window"
      state="ready"
      paused={paused}
      action={{ label: busy === 'make' ? C.today.making : card.action.label, onClick: v.frame.readOnly ? undefined : () => void make() }}
    />
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
  return (
    <Glass as="section" tone="strong" radius="tile" priority={2} className="lab2c-ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="lab2c-panel-title" data-lab-ink="">{C.today.askTitle}</h2>
      <StateLine state={v.askPanel.state} />
      <form className="lab2c-ask-form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="lab2c-input lab2c-ask-input" value={q} disabled={off} maxLength={300} placeholder={C.today.askPlaceholder} aria-label={C.today.askPlaceholder} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="lab2c-btn lab2c-btn-primary" aria-disabled={off || !q.trim() ? 'true' : undefined}>{C.today.askSubmit}</button>
      </form>
      {!off && (
        <div className="lab2c-ask-chips">
          <span className="lab2c-muted" data-lab-ink="">{C.today.askExamples}</span>
          {v.askPanel.examples.map((e) => (
            <button key={e} type="button" className="lab2c-fchip" onClick={() => ask(e)} data-lab-ink="">{e}</button>
          ))}
        </div>
      )}
      {!off && recent.length > 0 && (
        <div className="lab2c-ask-chips">
          <span className="lab2c-muted" data-lab-ink="">{C.today.askRecent}</span>
          {recent.map((e) => (
            <button key={e} type="button" className="lab2c-fchip" onClick={() => ask(e)} data-lab-ink="">{e}</button>
          ))}
        </div>
      )}
    </Glass>
  );
}

function NextToMake({ v }: { v: TodayPageView }) {
  const { post, busy } = useLabPost();
  const n = v.nextToMake;
  const open = (scriptId: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set('script', scriptId);
    openSheetHref(u.pathname + u.search);
  };
  const write = async (id: string) => {
    const r = await post('/api/lab/ideas', { id, action: 'write_script' }, { key: `w-${id}`, refresh: false });
    if (r.ok && typeof r.data.scriptId === 'string') open(r.data.scriptId);
  };
  return (
    <section className="lab2-today-section" aria-labelledby="next-title">
      <header className="lab2-row-head">
        <span className="lab2-row-text">
          <h2 id="next-title" className="lab2-row-title" data-lab-ink="">{n.title}</h2>
          <span className="lab2-row-desc" data-lab-ink="">{C.today.nextDesc}</span>
        </span>
        <Link href={n.allHref + (v.frame.mode.sample ? '?sample=1' : '')} className="lab2-pill lab2-seeall" data-lab-ink="">{C.today.allIdeas}</Link>
      </header>
      <StateLine state={n.state} />
      {shows(n.state) && (
        <div className="lab2-list">
          {n.rows.map((r) => (
            <Glass key={r.id} tone="strong" radius="chip" priority={3} className="lab2-listrow lab2c-listrow">
              <Link href={r.href + (v.frame.mode.sample ? '&sample=1' : '')} className="lab2-listrow-title lab2c-rowlink" data-lab-ink="">{r.title}</Link>
              <span className="lab2-listrow-meta" data-lab-ink="">{r.windowText ?? ''}</span>
              <span className="lab2-listrow-meta" data-lab-ink="">{r.groundedText}</span>
              {r.action.kind === 'open_script' && r.scriptId ? (
                <ActionPill label={r.action.label} icon="play" href={`?script=${r.scriptId}`} sharedId={`idea-${r.id}`} />
              ) : (
                <ActionPill
                  label={busy === `w-${r.id}` ? C.today.writing : r.action.label}
                  busy={busy === `w-${r.id}`}
                  disabled={!!v.frame.readOnly}
                  disabledReason={v.frame.readOnly ?? undefined}
                  onClick={() => void write(r.id)}
                  sharedId={`idea-${r.id}`}
                />
              )}
            </Glass>
          ))}
        </div>
      )}
    </section>
  );
}

function Pipeline({ v }: { v: TodayPageView }) {
  const p = v.pipeline;
  const batch = useRunProgress(v.frame.run.activeBatch);
  const [amount, cap] = p.spend.text.split(' of ');
  const stat = (m: typeof p.scraped, label: string) => (
    <span className="lab2-stat">
      <span className="lab2-stat-num" data-lab-ink="">{m.enough && m.text ? m.text : C.notEnough}</span>
      <span className="lab2-stat-label" data-lab-ink="">{label}</span>
    </span>
  );
  return (
    <Glass as="section" tone="strong" radius="tile" priority={3} className="lab2-card" aria-labelledby="pipe-title">
      <header className="lab2-card-head">
        <h2 id="pipe-title" className="lab2-card-title" data-lab-ink="">{C.today.pipeline}</h2>
        <Link href={p.href} className="lab2-pill lab2-seeall" data-lab-ink="" data-lab-shared="pipeline" scroll={false}>{C.today.pipelineLink}</Link>
      </header>
      <StateLine state={p.state} />
      {batch ? (
        <RunPanel batch={batch} form="card" readOnly={v.frame.readOnly} />
      ) : shows(p.state) ? (
        <>
          <div className="lab2-stats">
            {stat(p.scraped, C.today.scraped)}
            {stat(p.transcribed, C.today.transcribed)}
            {stat(p.dissected, C.today.dissected)}
            <span className="lab2-stat">
              <span className="lab2-stat-cap">
                <span className="lab2-stat-num" data-lab-ink="">
                  {amount.startsWith('$') ? <><sup style={{ marginLeft: 0, marginRight: 2 }}>$</sup>{amount.slice(1)}</> : amount}
                </span>
                {p.spend.pct !== null && <CapViz spent={p.spend.pct} cap={1} />}
              </span>
              <span className="lab2-stat-label" data-lab-ink="">{cap ? fill(C.today.spendOf, { cap }) : C.today.spend}</span>
            </span>
          </div>
          <span className="lab2-card-cap" data-lab-ink="">{p.lastRunText}</span>
        </>
      ) : null}
    </Glass>
  );
}

function LedgerCard({ v }: { v: TodayPageView }) {
  const l = v.ledgerLine;
  return (
    <Glass as="section" tone="strong" radius="tile" priority={3} className="lab2-card" aria-labelledby="ledger-title">
      <header className="lab2-card-head">
        <h2 id="ledger-title" className="lab2-card-title" data-lab-ink="">{C.today.ledger}</h2>
        <Link href={l.href + (v.frame.mode.sample ? '?sample=1' : '')} className="lab2-pill lab2-seeall" data-lab-ink="">{C.today.ledgerLink}</Link>
      </header>
      {shows(l.state) ? <p className="lab2-card-text" data-lab-ink="">{l.sentence}</p> : <StateLine state={l.state} />}
      <span className="lab2-card-cap" data-lab-ink="">{C.today.ledgerCap}</span>
    </Glass>
  );
}

function Checklist({ v }: { v: TodayPageView }) {
  const c = v.checklist!;
  return (
    <Glass as="section" tone="strong" radius="narrative" priority={2} className="lab2-empty lab2c-checklist" aria-labelledby="cl-title">
      <h2 id="cl-title" className="lab2-empty-title" data-lab-ink="">{C.today.checklistTitle}</h2>
      <p className="lab2-empty-text" data-lab-ink="">{fill(C.today.checklistDone, { done: c.done, total: c.total })}</p>
      <span className="lab2-empty-actions">
        {c.next && <Link href={c.next.href} className="lab2c-btn lab2c-btn-primary" scroll={false}>{c.next.label}</Link>}
        <Link href={c.href} className="lab2-textlink" data-lab-ink="" scroll={false}>{C.setup}</Link>
      </span>
    </Glass>
  );
}

/** On a working install the checklist is a reminder, not the page: one slim row above the tile rows (the empty install keeps the full card). */
function ChecklistBar({ v }: { v: TodayPageView }) {
  const c = v.checklist!;
  return (
    <Glass as="section" tone="strong" radius="chip" priority={3} className="lab2c-checklist-bar" aria-labelledby="clb-title">
      <h2 id="clb-title" className="lab2c-checklist-bar-title" data-lab-ink="">{C.today.checklistTitle}</h2>
      <span className="lab2c-muted" data-lab-ink="">{fill(C.today.checklistDone, { done: c.done, total: c.total })}</span>
      <span className="lab2c-checklist-bar-actions">
        {c.next && <Link href={c.next.href} className="lab2c-btn lab2c-btn-primary" scroll={false}>{c.next.label}</Link>}
        <Link href={c.href} className="lab2-pill lab2-seeall" data-lab-ink="" scroll={false}>{C.setup}</Link>
      </span>
    </Glass>
  );
}

const SHEET_KEYS = ['post', 'event', 'idea', 'script', 'test', 'setup', 'ask'] as const;

export function TodayPage({ view }: { view: TodayPageView }) {
  return (
    <ClassicCapHost>
      <TodayPageBody view={view} />
    </ClassicCapHost>
  );
}

function TodayPageBody({ view }: { view: TodayPageView }) {
  const replace = useReplaceParams();
  const [seg, setSeg] = useState<'brief' | 'ask'>(view.seg);
  const [hp, setHp] = useState(view.hp);
  const intro = useLabIntro('today');
  const [periodOff, setPeriodOff] = useState(String(view.period.offset));
  const periodTimer = useRef<number | null>(null);
  useEffect(() => setPeriodOff(String(view.period.offset)), [view.period.offset]);
  useEffect(() => () => { if (periodTimer.current) window.clearTimeout(periodTimer.current); }, []);
  const empty = view.frame.mode.state === 'empty';
  // 03.4: the heroes first shown count up from 0 only while the today intro plays; at rest the text is the
  // view's own formatted value (useLabCountUp returns it unchanged when disabled).
  const cur = view.heroes[hp] ?? view.heroes.all;
  const t1 = useLabCountUp(cur?.yourNormal.value.enough ? cur.yourNormal.value.value : null, { kind: 'ratio', durationMs: 560, delayMs: 80, enabled: intro.playing, introT0: intro.t0, from: 0 });
  const t2 = useLabCountUp(cur?.breakouts.value.enough ? cur.breakouts.value.value : null, { kind: 'count', durationMs: 520, delayMs: 120, enabled: intro.playing, introT0: intro.t0, from: 0 });
  const pages = heroPages(view, intro.playing ? { platform: hp, yourNormal: t1 || null, breakouts: t2 || null } : null);
  // Drift pauses under any open sheet (03.6.1), including one opened on the client with pushState.
  const sp = useSearchParams();
  const sheetOpen = SHEET_KEYS.some((k) => !!sp?.get(k));

  // 01 22.1: [ and ] step the period scrubber.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.closest('[role="dialog"]'))) return;
      if (e.key === '[' && view.period.prevHref) replace({ offset: String(view.period.offset - 1) });
      if (e.key === ']' && view.period.nextHref) replace({ offset: view.period.offset + 1 === 0 ? null : String(view.period.offset + 1) });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [view.period, replace]);

  const periods = view.period.ticks.map((t) => ({ id: String(t.offset), label: t.label, from: '', to: '' }));
  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      <div className="lab2-today-top lab2c-today-top">
        <div className="lab2-today-heroes">
          {pages.length > 0 && (
            <HeroPair
              pages={pages}
              page={heroPageId(hp)}
              onPage={(id: HeroPage['id']) => { const p = heroPlatformOf(id); setHp(p); replace({ hp: p === 'all' ? null : p }, { rerender: false }); }}
            />
          )}
        </div>
        <div className="lab2-today-cards">
          <BriefCard v={view} paused={sheetOpen} />
          <WindowCard v={view} paused={sheetOpen} introPlaying={intro.playing} />
        </div>
      </div>

      {empty && view.checklist ? (
        <Checklist v={view} />
      ) : (
        <>
          <div className="lab2-today-bar">
            <Segmented
              label={C.aria.todayView}
              options={[{ id: 'brief', label: C.today.seg.brief }, { id: 'ask', label: C.today.seg.ask }]}
              value={seg}
              onChange={(id) => { setSeg(id); replace({ seg: id === 'brief' ? null : id }, { rerender: false }); }}
              controls="lab2c-today-lower"
            />
            <PeriodScrubber
              periods={periods}
              value={periodOff}
              onChange={(id) => {
                // The scrubber moves at once (03.7.1); the server view follows one request after the keys settle.
                setPeriodOff(id);
                if (periodTimer.current) window.clearTimeout(periodTimer.current);
                periodTimer.current = window.setTimeout(() => replace({ offset: id === '0' ? null : id }), 250);
              }}
              label={C.aria.periodBelow}
            />
          </div>

          <div id="lab2c-today-lower" role="tabpanel">
            {seg === 'ask' ? (
              <AskPanel v={view} />
            ) : (
              <>
                {view.checklist && <div className="lab2c-gap"><ChecklistBar v={view} /></div>}
                <div className="lab2-today-rows">
                  <TileRow id="your-posts" title={view.yourPosts.title} description={view.yourPosts.description} seeAllHref={view.yourPosts.seeAllHref + (view.frame.mode.sample ? '&sample=1' : '')} seeAllLabel={C.seeAll} emptyText={view.yourPosts.state.message ?? undefined}>
                    {shows(view.yourPosts.state) ? view.yourPosts.tiles.map((t) => <Tile key={t.postId} {...postTileProps(t)} />) : undefined}
                  </TileRow>
                  <TileRow id="launch-radar" title={view.launchRadar.title} description={view.launchRadar.description} seeAllHref={view.launchRadar.seeAllHref + (view.frame.mode.sample ? '?sample=1' : '')} seeAllLabel={C.seeAll} emptyText={view.launchRadar.state.message ?? undefined}>
                    {shows(view.launchRadar.state) ? view.launchRadar.tiles.map((t) => <Tile key={t.eventId} {...radarTileProps(t)} />) : undefined}
                  </TileRow>
                </div>
                <NextToMake v={view} />
                <div className="lab2-today-foot">
                  <Pipeline v={view} />
                  <LedgerCard v={view} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Frame>
  );
}
