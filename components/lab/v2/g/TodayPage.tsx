'use client';
/**
 * Today (`/lab`), GladOS tree (01 7). Built from the shared components in the approved frame's order
 * (02 16.1): actions, the hero pair, the Brief and Window cards, the Brief / Ask segment with the period
 * scrubber, Your posts and Launch radar rows, Next to make, then Pipeline and Ledger.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActionPill, CapViz, Glass, HeroPair, NarrativeCard, PeriodScrubber, Segmented, Tile, TileRow, type HeroPage,
} from '@/components/lab/v2/shared';
import { useLabCountUp } from '@/components/lab/v2/shared/motion/useCountUp';
import { useLabIntro } from '@/components/lab/v2/shared/motion/useLabIntro';
import { useWindowPulse } from '@/components/lab/v2/shared/motion/useWindowPulse';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { useLabRun } from '@/components/lab/v2/shared/useLabRun';
import { useToast } from '@/components/g';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { HERO_GRAPH_COPY } from '@/lib/lab/view/hero-graphs';
// Not in the shared index: the graphs open sheets, and /lab-frames imports the index without the sheet router.
import { ChartVisual, NetworkVisual } from '@/components/lab/v2/shared/HeroGraphs';
import type { HeroPlatform } from '@/lib/lab/view/shared';
import type { TodayPageView } from '@/lib/lab/view/today';
import { heroProps, postTileProps, radarTileProps } from './adapt';
import { AskPanel } from './ask/AskBox';
import { GPageShell } from './PageShell';
import { RunProgressPanel } from './RunNow';
import { SectionNote, LabSetupLink } from './bits';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

type HeroId = HeroPage['id'];
const toHeroId = (h: HeroPlatform): HeroId => (h === 'twitter' ? 'x' : h);
const fromHeroId = (h: HeroId): HeroPlatform => (h === 'x' ? 'twitter' : h);

function replaceParam(router: ReturnType<typeof useRouter>, pathname: string, params: URLSearchParams, set: Record<string, string | null>, opts: { server?: boolean } = {}) {
  const q = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(set)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const url = `${pathname}${q.toString() ? `?${q}` : ''}`;
  if (opts.server) router.replace(url, { scroll: false });
  else window.history.replaceState(null, '', url);
}

function Heroes({ view, intro }: { view: TodayPageView; intro: { playing: boolean; t0: number | null } }) {
  const [hp, setHp] = useState<HeroPlatform>(view.hp);
  const params = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const all = view.heroes.all;
  // Count-up runs only when the today intro plays, for the heroes first shown (03.4).
  const cur = view.heroes[hp] ?? all;
  const t1 = useLabCountUp(cur?.yourNormal.value.enough ? cur.yourNormal.value.value : null, { kind: 'ratio', durationMs: 560, delayMs: 80, enabled: intro.playing, introT0: intro.t0, from: 0 });
  const t2 = useLabCountUp(cur?.breakouts.value.enough ? cur.breakouts.value.value : null, { kind: 'count', durationMs: 520, delayMs: 120, enabled: intro.playing, introT0: intro.t0, from: 0 });
  const sample = view.frame.mode.sample;
  const pages: HeroPage[] = view.heroPlatforms
    .filter((p) => view.heroes[p.id])
    .map((p) => {
      const h = view.heroes[p.id]!;
      const isCur = p.id === hp;
      return {
        id: toHeroId(p.id),
        label: p.label,
        heroes: [
          heroProps(h.yourNormal, { sample, valueText: isCur && h.yourNormal.value.enough && t1 ? t1 : undefined }),
          heroProps(h.breakouts, { sample, valueText: isCur && h.breakouts.value.enough && t2 ? t2 : undefined }),
        ],
      };
    });
  if (!pages.length) return null;
  return (
    <HeroPair
      pages={pages}
      page={toHeroId(hp)}
      onPage={(id) => {
        const next = fromHeroId(id);
        setHp(next);
        replaceParam(router, pathname, params, { hp: next === 'all' ? null : next });
      }}
    />
  );
}

function WindowCard({ view, paused, introPlaying }: { view: TodayPageView; paused: boolean; introPlaying: boolean }) {
  const w = view.window;
  const card = w.card;
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const { post, busy } = useLabPost();
  const eventId = card && (card.kind === 'open' || card.kind === 'closing') ? card.eventId : null;
  useWindowPulse(wrap, eventId, introPlaying);
  const chart = <ChartVisual view={view.graphs.chart} />;
  if (w.layer !== 'live' || !card) {
    return (
      <div ref={wrap} className="lab2g-cardwrap">
        <NarrativeCard kind="window" label={view.graphs.chart.label} visual={chart} captionTag={HERO_GRAPH_COPY.windowTag} sentence={w.message} state="none" paused={paused} />
      </div>
    );
  }
  if (card.kind === 'none') {
    return (
      <div ref={wrap} className="lab2g-cardwrap">
        <NarrativeCard kind="window" label={view.graphs.chart.label} visual={chart} captionTag={HERO_GRAPH_COPY.windowTag} sentence={card.sentence} meta={w.meta ?? undefined} state="none" paused={paused} />
      </div>
    );
  }
  if (card.kind === 'never_run') {
    return (
      <div ref={wrap} className="lab2g-cardwrap">
        <NarrativeCard kind="window" label={view.graphs.chart.label} visual={chart} captionTag={HERO_GRAPH_COPY.windowTag} sentence={card.sentence} state="none" paused={paused} setupHref={card.setupHref} />
      </div>
    );
  }
  const make = async () => {
    const r = await post('/api/lab/ideas', { action: 'from_event', eventId: card.eventId, angle: w.makeAngle }, { key: 'make', refresh: false });
    if (r.ok && typeof r.data.href === 'string') {
      toast({ text: r.data.existing ? LAB_UI.ideaExists : fill(LAB_UI.ideaFromEvent, { name: card.sentence.split(' shipped')[0].split(' is ')[0] }), tone: 'ok' });
      router.push(r.data.href);
    }
  };
  return (
    <div ref={wrap} className="lab2g-cardwrap">
      <NarrativeCard
        kind="window"
        label={view.graphs.chart.label}
        visual={chart}
        captionTag={HERO_GRAPH_COPY.windowTag}
        sentence={card.sentence}
        meta={w.meta ?? undefined}
        windowT={card.progress}
        state={view.frame.mode.sample ? 'sample' : 'ready'}
        href={w.href ?? undefined}
        hrefLabel={card.sentence}
        sharedId="window-card"
        action={{ label: busy === 'make' ? LAB_UI.making : LAB_UI.makeThis, onClick: view.frame.readOnly ? () => toast({ text: view.frame.readOnly ?? '', tone: 'info' }) : make }}
        paused={paused}
      />
    </div>
  );
}

function NextToMake({ view }: { view: TodayPageView }) {
  const n = view.nextToMake;
  const { post, busy } = useLabPost();
  const router = useRouter();
  const ro = view.frame.readOnly;
  return (
    <section className="lab2-today-section" aria-labelledby="lab2g-next-title">
      <header className="lab2-row-head">
        <span className="lab2-row-text">
          <h2 id="lab2g-next-title" className="lab2-row-title" data-lab-ink="">{n.title}</h2>
          <span className="lab2-row-desc" data-lab-ink="">{LAB_UI.nextToMakeDesc}</span>
        </span>
        <Link data-g="LabLink" href={n.allHref} className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.allIdeas}</Link>
      </header>
      {n.rows.length === 0 ? (
        <SectionNote state={n.state} />
      ) : (
        <div className="lab2-list">
          {n.rows.map((r) => (
            <Glass key={r.id} tone="strong" radius="chip" priority={3} className="lab2-listrow lab2g-idearow">
              <Link data-g="LabLink" href={r.href} className="lab2-listrow-title lab2g-rowlink" data-lab-ink="">{r.title}</Link>
              {r.windowText ? <span className="lab2-listrow-meta" data-lab-ink="">{r.windowText}</span> : <span />}
              <span className="lab2-listrow-meta" data-lab-ink="">{r.groundedText}</span>
              {r.action.kind === 'open_script' && r.scriptId ? (
                <ActionPill label={r.action.label} href={`?script=${r.scriptId}`} sharedId={`script-${r.scriptId}`} />
              ) : (
                <ActionPill
                  label={busy === `write-${r.id}` ? LAB_UI.writing : r.action.label}
                  busy={busy === `write-${r.id}`}
                  disabled={!!ro}
                  disabledReason={ro ?? undefined}
                  sharedId={`write-${r.id}`}
                  onClick={async () => {
                    const res = await post('/api/lab/ideas', { id: r.id, action: 'write_script' }, { key: `write-${r.id}`, refresh: false });
                    const sid = typeof res.data.scriptId === 'string' ? res.data.scriptId : null;
                    if (res.ok && sid) router.push(`?script=${sid}`, { scroll: false });
                    if (res.status === 503) router.refresh();
                  }}
                />
              )}
            </Glass>
          ))}
        </div>
      )}
    </section>
  );
}

function PipelineCard({ view }: { view: TodayPageView }) {
  const p = view.pipeline;
  const live = useLabRun();
  const running = !!live.batch;
  // Pipeline numbers tick up from the value shown before to each new stored value (03.8, 03.4).
  const scraped = useLabCountUp(p.scraped.value, { kind: 'count', durationMs: 420, enabled: true });
  const transcribed = useLabCountUp(p.transcribed.value, { kind: 'count', durationMs: 420, enabled: true });
  const dissected = useLabCountUp(p.dissected.value, { kind: 'count', durationMs: 420, enabled: true });
  const [spendNum, ...rest] = p.spend.text.split(' of ');
  const capText = rest.length ? `of ${rest.join(' of ')}` : '';
  const stats = [
    { id: 'scraped', label: LAB_UI.scraped, text: scraped || p.scraped.text },
    { id: 'transcribed', label: LAB_UI.transcribed, text: transcribed || p.transcribed.text },
    { id: 'dissected', label: LAB_UI.dissected, text: dissected || p.dissected.text },
  ];
  return (
    <Glass as="section" tone="strong" radius="tile" priority={3} className="lab2-card lab2g-pipe" aria-labelledby="lab2g-pipe-title">
      <header className="lab2-card-head">
        <h2 id="lab2g-pipe-title" className="lab2-card-title" data-lab-ink="">{LAB_UI.pipeline}</h2>
        <Link data-g="LabLink" href={p.href} className="lab2-pill lab2-seeall" data-lab-ink="" data-lab-shared="pipeline">{LAB_UI.spendAndRuns}</Link>
      </header>
      {running ? (
        <RunProgressPanel compact />
      ) : (
        <>
          <div className="lab2-stats">
            {stats.map((s) => (
              <span key={s.id} className="lab2-stat">
                <span className="lab2-stat-num" data-lab-ink="">{s.text}</span>
                <span className="lab2-stat-label" data-lab-ink="">{s.label}</span>
              </span>
            ))}
            <span className="lab2-stat">
              <span className="lab2-stat-cap">
                <span className="lab2-stat-num" data-lab-ink="">
                  <sup className="lab2g-sup-lead">$</sup>
                  {spendNum.replace(/^\$/, '')}
                </span>
                {p.spend.pct !== null && <CapViz spent={p.spend.pct} cap={1} />}
              </span>
              <span className="lab2-stat-label" data-lab-ink="">{fill(LAB_UI.spendLabel, { text: capText || p.spend.text })}</span>
            </span>
          </div>
          <span className="lab2-card-cap" data-lab-ink="">{p.lastRunText}</span>
        </>
      )}
    </Glass>
  );
}

export function TodayBody({ view }: { view: TodayPageView }) {
  const params = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const intro = useLabIntro('today');
  const [seg, setSeg] = useState<'brief' | 'ask'>(view.seg);
  const [periodOff, setPeriodOff] = useState(String(view.period.offset));
  const periodTimer = useRef<number | null>(null);
  useEffect(() => setPeriodOff(String(view.period.offset)), [view.period.offset]);
  useEffect(() => () => { if (periodTimer.current) window.clearTimeout(periodTimer.current); }, []);
  const sheetOpen = !!view.sheet || ['post', 'event', 'idea', 'script', 'test', 'setup', 'ask'].some((k) => params.get(k));
  const frame = view.frame;

  // `[` and `]` step the period scrubber (01 22.1).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '[' && view.period.prevHref) router.replace(view.period.prevHref, { scroll: false });
      if (e.key === ']' && view.period.nextHref) router.replace(view.period.nextHref, { scroll: false });
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [router, view.period.prevHref, view.period.nextHref]);

  if (frame.emptyCard) return null; // the shell shows GEmptyCard (Frame.tsx)

  const brief = view.brief;
  const periods = view.period.ticks.map((t) => ({ id: String(t.offset), label: t.label, from: '', to: '' }));
  return (
    <>
      <div className="lab2-today-top lab2g-today-top">
        <div className="lab2-today-heroes">
          <Heroes view={view} intro={intro} />
        </div>
        <div className="lab2-today-cards">
          <NarrativeCard
            kind="brief"
            label={view.graphs.network.label}
            visual={<NetworkVisual view={view.graphs.network} />}
            captionTag={HERO_GRAPH_COPY.briefTag}
            sentence={brief.sentence}
            meta={brief.state === 'finding' ? brief.meta ?? undefined : ''}
            href={brief.href ?? undefined}
            hrefLabel={brief.state === 'finding' ? LAB_UI.briefLink : undefined}
            sharedId="brief-card"
            state={brief.state === 'finding' ? (frame.mode.sample ? 'sample' : 'ready') : 'thin'}
            paused={sheetOpen}
          />
          <WindowCard view={view} paused={sheetOpen} introPlaying={intro.playing} />
        </div>
      </div>

      {view.checklist && (
        <Glass tone="strong" radius="chip" priority={3} className="lab2g-checklist">
          <span className="lab2g-checklist-text" data-lab-ink="">{fill(LAB_UI.checklistCard, { done: String(view.checklist.done), total: String(view.checklist.total) })}</span>
          {view.checklist.next && <span className="lab2-listrow-meta" data-lab-ink="">{fill(LAB_UI.checklistNext, { label: view.checklist.next.label })}</span>}
          <Link data-g="LabLink" href={view.checklist.href} className="lab2-pill lab2-seeall" data-lab-ink="" data-lab-shared="checklist">{LAB_UI.checklistOpen}</Link>
        </Glass>
      )}

      <div className="lab2-today-bar">
        <Segmented
          label={LAB_UI.todayView}
          options={[
            { id: 'brief', label: LAB_UI.briefSeg },
            { id: 'ask', label: LAB_UI.askSeg },
          ]}
          value={seg}
          onChange={(id) => {
            setSeg(id);
            replaceParam(router, pathname, params, { seg: id === 'brief' ? null : id });
          }}
          controls="lab2g-today-lower"
        />
        {seg === 'brief' && (
          <PeriodScrubber
            periods={periods}
            value={periodOff}
            onChange={(id) => {
              // The scrubber moves at once (03.7.1); the server view follows one request after the keys settle.
              setPeriodOff(id);
              if (periodTimer.current) window.clearTimeout(periodTimer.current);
              periodTimer.current = window.setTimeout(() => replaceParam(router, pathname, params, { period: view.period.unit === 'w' ? null : view.period.unit, offset: id === '0' ? null : id }, { server: true }), 250);
            }}
            label={LAB_UI.periodLabel}
          />
        )}
      </div>

      <div id="lab2g-today-lower" role="tabpanel" className="lab2g-lower">
        {seg === 'ask' ? (
          <AskPanel panel={view.askPanel} />
        ) : (
          <>
            <div className="lab2-today-rows">
              <TileRow id="your-posts" title={view.yourPosts.title} description={view.yourPosts.description} seeAllHref={view.yourPosts.seeAllHref} seeAllLabel={LAB_UI.seeAll} emptyText={view.yourPosts.state.message ?? undefined}>
                {view.yourPosts.tiles.map((t) => <Tile key={t.postId} {...postTileProps(t)} />)}
              </TileRow>
              <TileRow id="launch-radar" title={view.launchRadar.title} description={view.launchRadar.description} seeAllHref={view.launchRadar.seeAllHref} seeAllLabel={LAB_UI.seeAll} emptyText={view.launchRadar.state.message ?? undefined}>
                {view.launchRadar.tiles.map((t) => <Tile key={t.eventId} {...radarTileProps(t)} />)}
              </TileRow>
            </div>
            <NextToMake view={view} />
            <div className="lab2-today-foot">
              <PipelineCard view={view} />
              <Glass as="section" tone="strong" radius="tile" priority={3} className="lab2-card" aria-labelledby="lab2g-ledger-title">
                <header className="lab2-card-head">
                  <h2 id="lab2g-ledger-title" className="lab2-card-title" data-lab-ink="">{LAB_UI.ledger}</h2>
                  <Link data-g="LabLink" href={view.ledgerLine.href} className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.openLedger}</Link>
                </header>
                <p className="lab2-card-text" data-lab-ink="">{view.ledgerLine.state.kind === 'not_built' ? view.ledgerLine.state.message ?? LAB_COPY.layer.ledger : view.ledgerLine.sentence}</p>
                <span className="lab2-card-cap" data-lab-ink="">{LAB_UI.ledgerFoot}</span>
              </Glass>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function TodayPage({ view }: { view: TodayPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <TodayBody view={view} />
    </GPageShell>
  );
}
