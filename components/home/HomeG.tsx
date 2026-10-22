'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  GBar,
  GBarChart,
  GButton,
  GCard,
  GDelta,
  GDisplay,
  GDotMatrix,
  GDotNumber,
  GEmpty,
  GHeroCard,
  GList,
  GPage,
  GRow,
  GSectionHeader,
  GShareBar,
  GSparkline,
  GStat,
  GTag,
  GTickStrip,
  type StageColumn,
} from '@/components/g';
import { Home6Chart, type Home6Series } from '@/components/Home6Chart';
import { formatCompact, formatFull, formatUsdCompact } from '@/lib/format-number';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { channelColor } from '@/lib/series';
import type { Delta } from '@/lib/delta';
import type { InboundSummary, RevenueSummary } from '@/lib/home-summary';
import type { IncomeCategory } from '@/lib/finances';
import type { StatusPill, Tone } from '@/lib/pulse-history';
import { DONE_TODAY_EMPTY, NEEDS_YOU_EMPTY, type DoneToday, type NeedsYou } from '@/lib/home-today';
import { InterjectG } from './Interject';

/**
 * Home under the GladOS style (glados-ui SPEC S01, X5). Home6Console gathers
 * the data once for both styles and hands this tree a plain object; the
 * Classic console is untouched.
 *
 * Layout is Home's own three columns (DOM order main, left, right; tiers on
 * the page width, rules in the "S01 home (G)" block of app/globals.css). Two
 * gradient heroes on the two numbers that drive a decision today (FR-1,
 * C22): money in and people waiting. Every other widget is a calm kit card.
 */

export type HomeGData = {
  greeting: string;
  status: {
    pill: StatusPill;
    segments: { text: string; href: string | null; tone: Tone }[];
    degraded: boolean;
  };
  revenue: RevenueSummary | null;
  financePeriod: 'MTD' | 'YTD';
  financeCategories: IncomeCategory[];
  inbound: InboundSummary;
  /** ISO start of each hourly bucket, oldest first. */
  hourStarts: string[];
  stats: {
    connected: number;
    connectors: number;
    activeAgents: number;
    agents: number;
    runs7: number;
    failed: number;
    brainPages: number;
  };
  chart: {
    usePosting: boolean;
    title: string;
    caption: string;
    href: string;
    hasChart: boolean;
    days: string[];
    series: { key: string; label: string; points: number[] }[];
  };
  runs: {
    perDay: number[];
    days: string[];
    lastRunText: string | null;
    lastRunTitle: string | null;
    recent: {
      id: string;
      agentId: string;
      ok: boolean;
      summary: string;
      age: string;
      at: string;
    }[];
  };
  freshness: { dated: number; fresh: number; aging: number; stale: number };
  audience: {
    key: string;
    label: string;
    last: number;
    spark: number[];
    delta: Delta | null;
    window: string;
    href: string;
  }[];
  /** F2: tasks blocked on the operator (top five) and what finished since local midnight. */
  needs: NeedsYou;
  done: DoneToday & { caption: string };
  live: {
    agents: { id: string; name: string }[];
    active: number;
    more: number;
  };
  now: { quarter: string; items: { id: string; title: string }[] } | null;
};

const usd = (n: number) => `$${formatFull(Math.round(n))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Comms sources on the inbound chart: email is the C19 email slot; the chat sources take categorical slots. */
const COMMS_COLOR: Record<string, string> = {
  email: 'var(--g-series-5)',
  whatsapp: 'var(--g-cat-8)',
  slack: 'var(--g-cat-7)',
};

const TAG_TONE: Record<Tone, 'ok' | 'warn' | 'err' | 'neutral' | 'accent'> = {
  ok: 'ok',
  warn: 'warn',
  err: 'err',
  accent: 'accent',
  dim: 'neutral',
};

export function HomeG({ data }: { data: HomeGData }) {
  return (
    <GPage className="hg">
      <header className="hg-head">
        <GDisplay>{data.greeting}</GDisplay>
        <StatusLine status={data.status} />
      </header>

      <div className="hg-grid h6-grid">
        <div className="hg-col h6-col h6-col-main">
          <div className="hg-heroes">
            <RevenueHero revenue={data.revenue} period={data.financePeriod} />
            <InboundHero inbound={data.inbound} starts={data.hourStarts} />
          </div>
          <Stats stats={data.stats} />
          <InterjectG />
          <div className="hg-today">
            <NeedsYouCard needs={data.needs} />
            <DoneTodayCard done={data.done} />
          </div>
          <ActivityCard chart={data.chart} />
          {data.financeCategories.length > 0 && <FinanceCard categories={data.financeCategories} period={data.financePeriod} />}
        </div>

        <div className="hg-col h6-col h6-col-left">
          <AgentsCard runs={data.runs} failed={data.stats.failed} runs7={data.stats.runs7} />
          <FreshnessCard f={data.freshness} />
          <AudienceCard rows={data.audience} />
        </div>

        <div className="hg-col h6-col h6-col-right">
          <LiveCard live={data.live} />
          {data.now && <NowCard now={data.now} />}
        </div>
      </div>
    </GPage>
  );
}

/* ── header: status from stateOfWorld (FR-5, H2) ─────────────────────── */

function StatusLine({ status }: { status: HomeGData['status'] }) {
  return (
    <div className="hg-status">
      <GTag tone={status.pill.tone} dot title="Overall status from failed runs and connectors">
        {status.pill.text}
      </GTag>
      {status.segments.map((s) =>
        s.href ? (
          <GButton key={s.text} variant="sm" href={s.href}>
            {s.text}
          </GButton>
        ) : (
          <GTag key={s.text} tone={TAG_TONE[s.tone]}>
            {s.text}
          </GTag>
        ),
      )}
      {status.degraded && (
        <GButton variant="sm" href="/setup" title="something needs wiring: open the guided setup">
          Set up
        </GButton>
      )}
    </div>
  );
}

/* ── heroes (FR-1 to FR-4) ───────────────────────────────────────────── */

function RevenueHero({ revenue, period }: { revenue: RevenueSummary | null; period: 'MTD' | 'YTD' }) {
  const caption = `Revenue · ${period}`;
  if (!revenue) {
    return (
      <GHeroCard
        variant="a"
        caption={caption}
        status="No payment processor connected"
        setupHref={setupHrefFor('stripe')}
        setupHint="connect a payment processor to see revenue"
        title="Revenue: no payment processor connected"
      />
    );
  }
  const { total, top, segments } = revenue;
  const periodWords = period === 'YTD' ? 'year to date' : 'month to date';
  const lead = segments.length === 1 ? `${top.label} · 100%` : `${top.label} leads · ${top.share}%`;
  return (
    <GHeroCard
      variant="a"
      href="/finances"
      caption={caption}
      value={formatUsdCompact(total)}
      label={`Revenue ${periodWords} ${usd(total)}, ${top.label} ${segments.length === 1 ? 'is all of it' : `leads at ${top.share} percent`}. Open Finances.`}
      title={`${usd(total)} income ${periodWords}, from the same processor books as Finances`}
      status={lead}
      strip={
        <GShareBar
          onHero
          label={`Revenue share by category, ${period}`}
          segments={segments.map((s) => ({
            id: s.key,
            label: s.label,
            value: s.usd,
            title: `${s.label} · ${usd(s.usd)} · ${s.share}%`,
          }))}
        />
      }
    />
  );
}

function hourLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function InboundHero({ inbound, starts }: { inbound: InboundSummary; starts: string[] }) {
  const caption = 'Inbound · 24h';
  if (!inbound.configured && inbound.count === 0) {
    return (
      <GHeroCard
        variant="b"
        caption={caption}
        status="Comms not connected"
        setupHref={setupHrefFor('email')}
        setupHint="connect email, WhatsApp or Slack to count inbound messages"
        title="Inbound: no comms channel connected"
      />
    );
  }
  const shown = inbound.capped ? `${inbound.count}+` : inbound.count;
  const status =
    inbound.count === 0 ? 'Quiet day · 0 in 24h' : inbound.priority > 0 ? `${inbound.priority} priority` : `across ${plural(inbound.channels, 'channel')}`;
  const peak = inbound.hourly.reduce((best, v, i) => (v > inbound.hourly[best] ? i : best), 0);
  return (
    <GHeroCard
      variant="b"
      href="/inbox"
      caption={caption}
      value={shown}
      label={`${shown} inbound messages in the last 24 hours, ${status}. Open the inbox.`}
      title={`Messages that arrived in the last 24 hours across every connected channel${inbound.capped ? ' (the feed is capped, so there may be more)' : ''}`}
      status={status}
      strip={
        <GTickStrip
          onHero
          values={inbound.hourly}
          marked={23}
          titles={inbound.hourly.map((n, i) => `${hourLabel(starts[i])} · ${plural(n, 'message')}`)}
          label={`Inbound per hour, last 24 hours: ${plural(inbound.count, 'message')}${inbound.count > 0 ? `, peak ${inbound.hourly[peak]} at ${hourLabel(starts[peak])}` : ''}`}
        />
      }
    />
  );
}

/* ── stats row (FR-7) ────────────────────────────────────────────────── */

function Stats({ stats }: { stats: HomeGData['stats'] }) {
  return (
    <div className="hg-stats">
      <GStat
        value={stats.connected}
        label={`of ${stats.connectors} systems`}
        href="/integrations"
        source={`${stats.connected} of ${stats.connectors} connectors connected`}
      />
      <GStat
        value={stats.activeAgents}
        label={`of ${stats.agents} agents live`}
        href="/agents"
        source={`${stats.activeAgents} of ${stats.agents} agents active`}
      />
      <GStat
        value={stats.runs7}
        label="runs · 7d"
        href="/agents"
        source={`Agent runs finished in the last 7 days${stats.failed > 0 ? `; ${stats.failed} of the last 40 failed` : ''}`}
        extra={
          stats.failed > 0 ? (
            <GTag tone="err" size="xs">
              {stats.failed} failed
            </GTag>
          ) : undefined
        }
      />
      <GStat value={stats.brainPages} label="brain pages" href="/brain" source={`${formatFull(stats.brainPages)} pages in the brain store`} />
    </div>
  );
}

/* ── activity chart (FR-8) ───────────────────────────────────────────── */

function ActivityCard({ chart }: { chart: HomeGData['chart'] }) {
  const series: Home6Series[] = chart.series.map((s) => ({
    ...s,
    color: chart.usePosting ? channelColor(s.key) : (COMMS_COLOR[s.key] ?? 'var(--g-accent)'),
  }));
  return (
    <GCard className="hg-card hg-chart" aria-labelledby="hg-chart-title">
      <GSectionHeader
        id="hg-chart-title"
        size={22}
        title={chart.title}
        caption={chart.caption}
        action={
          <GButton variant="sm" href={chart.href}>
            View all
          </GButton>
        }
      />
      {chart.hasChart ? (
        <>
          <ul className="hg-legend" aria-label="Legend">
            {series.map((s) => (
              <li key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <Home6Chart days={chart.days} series={series} title={`${chart.title} · ${chart.caption}`} skin="g" />
        </>
      ) : (
        <GEmpty
          kind="unconfigured"
          title="No posting or comms history yet"
          body="Connect Zernio for posting history."
          setupHref={setupHrefFor('zernio')}
          setupHint="connect Zernio for posting history"
        />
      )}
    </GCard>
  );
}

/* ── finances by category (FR-9, C13) ────────────────────────────────── */

function FinanceCard({ categories, period }: { categories: IncomeCategory[]; period: 'MTD' | 'YTD' }) {
  const router = useRouter();
  const total = categories.reduce((s, c) => s + c.usd, 0);
  const top = categories.reduce((best, c) => (c.usd > best.usd ? c : best), categories[0]);
  const [selected, setSelected] = useState<string | null>(top?.key ?? null);
  const columns: StageColumn[] = categories.map((c) => ({
    id: c.key,
    label: c.label,
    value: c.usd,
    tip: {
      title: c.label,
      lines: [usd(c.usd), `${total > 0 ? Math.round((c.usd / total) * 100) : 0}% of ${period} revenue`],
      hint: 'Open in Finances',
    },
  }));
  return (
    <GCard className="hg-card" aria-labelledby="hg-fin-title">
      <GSectionHeader
        id="hg-fin-title"
        size={22}
        title="By category"
        caption={`Income · ${period}`}
        action={
          <GButton variant="sm" href="/finances">
            Open
          </GButton>
        }
      />
      <div className="hg-fin">
        <GBarChart
          variant="stages"
          measure="usd"
          flow={false}
          columns={columns}
          selected={selected}
          plotHeight={120}
          onSelect={(id) => {
            setSelected(id);
            router.push(`/finances?category=${encodeURIComponent(id)}`);
          }}
          tipHint="Open in Finances"
          label={`Income by category, ${period}`}
        />
      </div>
    </GCard>
  );
}

/* ── left column ─────────────────────────────────────────────────────── */

const DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
};

/** Agents: the run histogram and the recent runs in one card (FR-10, H4). */
function AgentsCard({ runs, failed, runs7 }: { runs: HomeGData['runs']; failed: number; runs7: number }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-agents-title">
      <GSectionHeader
        id="hg-agents-title"
        size={22}
        title="Agents"
        caption={
          <span title={runs.lastRunTitle ?? 'Agent runs finished in the last 7 days'}>
            {plural(runs7, 'run')} · 7d{runs.lastRunText ? ` · ${runs.lastRunText}` : ''}
          </span>
        }
        action={
          runs.recent.length > 0 && (
            <GTag tone={failed > 0 ? 'err' : 'ok'} dot title={failed > 0 ? `${failed} of the last 40 runs failed` : 'No failures in the last 40 runs'}>
              {failed > 0 ? `${failed} failed` : 'all ok'}
            </GTag>
          )
        }
      />
      {runs.recent.length === 0 && runs7 === 0 ? (
        <GEmpty
          kind="unconfigured"
          title="No agent runs recorded yet"
          body="Runs appear here once an agent has a job."
          setupHref="/agents"
          setupHint="no agent has run yet; open Agents to set one up"
        />
      ) : (
        <>
          {/* the per-day histogram only when the week has runs: seven empty columns say nothing the caption does not */}
          {runs7 > 0 && (
            <GDotMatrix
              compact
              rows={6}
              label="Runs per day, last 7 days"
              columns={runs.perDay.map((v, i) => {
                const day = runs.days[i] ? new Date(`${runs.days[i]}T00:00:00Z`).toLocaleDateString('en-GB', DAY_FMT) : '';
                return {
                  id: runs.days[i] ?? String(i),
                  label: day.slice(0, 2),
                  value: v,
                  title: `${day} · ${plural(v, 'run')}`,
                };
              })}
            />
          )}
          <GList label="Recent runs" className="hg-list">
            {runs.recent.map((r) => (
              <GRow
                key={r.id}
                href={`/agents?agent=${encodeURIComponent(r.agentId)}`}
                leading={<span className="hg-dot" data-tone={r.ok ? 'ok' : 'err'} aria-label={r.ok ? 'succeeded' : 'failed'} role="img" />}
                title={r.agentId}
                meta={r.summary}
                trailing={
                  <span className="hg-age" title={new Date(r.at).toLocaleString('en-US')}>
                    {r.age}
                  </span>
                }
                hint={r.summary}
              />
            ))}
          </GList>
        </>
      )}
    </GCard>
  );
}

/** Brain freshness (FR-11): one share number, one split bar, three rows. Page count lives in the stats row only. */
function FreshnessCard({ f }: { f: HomeGData['freshness'] }) {
  const pct = (n: number) => (f.dated > 0 ? Math.round((n / f.dated) * 100) : 0);
  return (
    <GCard className="hg-card" aria-labelledby="hg-fresh-title">
      <GSectionHeader id="hg-fresh-title" size={22} title="Brain freshness" />
      {f.dated === 0 ? (
        <GEmpty
          kind="unconfigured"
          title="Brain store not mounted"
          body="Expected at ~/knowledge/brain-store or GBRAIN_STORE."
          setupHref="/setup"
          setupHint="expected at ~/knowledge/brain-store (or GBRAIN_STORE)"
        />
      ) : (
        <>
          <div className="hg-fresh-head" title="Share of dated pages changed in the last 30 days">
            <GDotNumber value={`${pct(f.fresh)}%`} size={4} label={`${pct(f.fresh)} percent fresh`} />
            <span className="hg-cap">fresh</span>
          </div>
          <GBar
            label={`Brain freshness: ${f.fresh} fresh, ${f.aging} aging, ${f.stale} stale`}
            segments={[
              { value: f.fresh, tone: 'accent', label: `Fresh ${f.fresh}` },
              { value: f.aging, tone: 'muted', label: `Aging ${f.aging}` },
              { value: f.stale, tone: 'warn', label: `Stale ${f.stale}` },
            ]}
          />
          <GList label="Freshness" className="hg-list">
            <GRow
              href="/brain"
              title="Fresh"
              meta="changed in the last 30 days"
              trailing={formatFull(f.fresh)}
              hint={`${f.fresh} pages changed in the last 30 days`}
            />
            <GRow
              href="/brain"
              title="Aging"
              meta="changed 31 to 89 days ago"
              trailing={formatFull(f.aging)}
              hint={`${f.aging} pages changed 31 to 89 days ago`}
            />
            <GRow
              href="/drift"
              title="Stale"
              meta="untouched for 90 days or more"
              trailing={formatFull(f.stale)}
              hint={`${f.stale} pages untouched for 90 days or more; open Drift`}
            />
          </GList>
        </>
      )}
    </GCard>
  );
}

/** Audience (FR-12, C19): one row per channel, a 30 day line and the change over the same window. */
function AudienceCard({ rows }: { rows: HomeGData['audience'] }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-aud-title">
      <GSectionHeader id="hg-aud-title" size={22} title="Audience" caption={rows.length > 0 ? 'Last 30 days' : undefined} />
      {rows.length === 0 ? (
        <GEmpty
          kind="unconfigured"
          title="No audience history yet"
          body="Connect Zernio to track followers."
          setupHref={setupHrefFor('zernio')}
          setupHint="connect Zernio to track followers"
        />
      ) : (
        <GList label="Audience by channel" className="hg-list">
          {rows.map((r) => (
            <GRow
              key={r.key}
              href={r.href}
              title={r.label}
              meta={r.delta ? <GDelta delta={r.delta} window={r.window} /> : undefined}
              hint={`${r.label}: ${formatFull(r.last)}${r.delta ? `, ${r.delta.text} from ${r.window}` : ''}`}
              trailing={
                <span className="hg-aud-trail">
                  {r.spark.length > 1 && <GSparkline values={r.spark} color={seriesSlot(r.key)} height={24} width={72} label={`${r.label} · last 30 days`} />}
                  <span className="hg-aud-val">{formatCompact(r.last)}</span>
                </span>
              }
            />
          ))}
        </GList>
      )}
    </GCard>
  );
}

/** The series slot for a channel (C19); untracked keys read muted. */
function seriesSlot(key: string): 'series-1' | 'series-2' | 'series-3' | 'series-4' | 'series-5' | 'series-6' | 'muted' {
  const m = channelColor(key).match(/--series-(\d)\)/);
  return m && m[1] !== '0' ? (`series-${m[1]}` as 'series-1') : 'muted';
}

/* ── right column ────────────────────────────────────────────────────── */

/** F2 Needs you: tasks blocked until the operator acts, top five, each opening on the board. */
function NeedsYouCard({ needs }: { needs: NeedsYou }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-needs-title" data-home-needs="">
      <GSectionHeader
        id="hg-needs-title"
        size={22}
        title="Needs you"
        caption={needs.total > 0 ? 'Blocked until you act' : undefined}
        action={
          needs.total > needs.rows.length ? (
            <GButton variant="sm" href="/tasks" title={`All ${needs.total} blocked tasks on the board`}>
              All {needs.total}
            </GButton>
          ) : needs.total > 0 ? (
            <GTag tone="warn" dot title={`${plural(needs.total, 'task')} blocked until you act`}>
              {needs.total}
            </GTag>
          ) : undefined
        }
      />
      {needs.rows.length === 0 ? (
        <p className="hg-today-empty">{NEEDS_YOU_EMPTY}</p>
      ) : (
        <GList label="Tasks waiting on you" className="hg-list">
          {needs.rows.map((t) => (
            <GRow
              key={t.id}
              href={t.href}
              leading={<span className="hg-dot" data-tone={t.priority === 'high' ? 'err' : 'warn'} role="img" aria-label={t.priority === 'high' ? 'high priority' : 'blocked'} />}
              title={t.title}
              meta={t.agentId ?? 'Yours'}
              trailing={
                <span className="hg-age" title={`Waiting since ${new Date(t.at).toLocaleString('en-US')}`}>
                  {t.age}
                </span>
              }
              hint={`${t.title}: open on the board`}
            />
          ))}
        </GList>
      )}
    </GCard>
  );
}

/** F2 Done today: runs and tasks finished since local midnight, the count and the newest three. */
function DoneTodayCard({ done }: { done: HomeGData['done'] }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-done-title" data-home-done="">
      <GSectionHeader
        id="hg-done-title"
        size={22}
        title="Done today"
        action={
          done.failed > 0 ? (
            <GTag tone="err" dot title={`${plural(done.failed, 'run')} failed today`}>
              {done.failed} failed
            </GTag>
          ) : undefined
        }
      />
      {done.count === 0 ? (
        <p className="hg-today-empty">{DONE_TODAY_EMPTY}</p>
      ) : (
        <>
        <GStat value={done.count} label={done.caption} source="Agent runs and tasks finished since local midnight" />
        <GList label="Finished today" className="hg-list">
          {done.rows.map((r) => (
            <GRow
              key={`${r.kind}-${r.id}`}
              href={r.href}
              leading={<span className="hg-dot" data-tone={r.ok ? 'ok' : 'err'} role="img" aria-label={r.ok ? 'finished' : 'failed'} />}
              title={r.title}
              meta={r.kind === 'task' ? 'Task' : 'Run'}
              trailing={
                <span className="hg-age" title={new Date(r.at).toLocaleString('en-US')}>
                  {r.age}
                </span>
              }
              hint={r.title}
            />
          ))}
        </GList>
        </>
      )}
    </GCard>
  );
}

/** Agents live (FR-14, H3): the count is every active agent; the list shows four and says how many more. */
function LiveCard({ live }: { live: HomeGData['live'] }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-live-title">
      <GSectionHeader
        id="hg-live-title"
        size={22}
        title="Agents live"
        action={
          <GTag tone="accent" title={`${live.active} agents active`}>
            {live.active}
          </GTag>
        }
      />
      {live.agents.length === 0 ? (
        <GEmpty
          kind="unconfigured"
          title="No agents live"
          body="No agent is active right now."
          setupHref="/agents"
          setupHint="no agent is active; open Agents to set one up"
        />
      ) : (
        <GList label="Active agents" className="hg-list">
          {live.agents.map((a) => (
            <GRow key={a.id} href={`/agents?agent=${encodeURIComponent(a.id)}`} title={a.name} hint={`Open ${a.name}`} />
          ))}
          {live.more > 0 && <GRow href="/agents" title={`+${live.more} more`} hint={`${live.more} more active agents`} />}
        </GList>
      )}
    </GCard>
  );
}

/** Now (FR-15): the current quarter once, then the items. */
function NowCard({ now }: { now: NonNullable<HomeGData['now']> }) {
  return (
    <GCard className="hg-card" aria-labelledby="hg-now-title">
      <GSectionHeader id="hg-now-title" size={22} title="Now" caption={now.quarter} />
      <GList label={`Roadmap, ${now.quarter}`} className="hg-list hg-now">
        {now.items.map((it) => (
          <GRow key={it.id} href="/roadmap" title={it.title} hint={it.title} />
        ))}
      </GList>
    </GCard>
  );
}
