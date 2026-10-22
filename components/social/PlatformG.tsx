'use client';

/**
 * /social/[platform] and /social/beehiiv under the GladOS style (glados-ui
 * SPEC S03 §4.2, §4.3, §5.3; X5). Same data as Classic. One hero, the growth
 * stats once (the duplicate badges in the chart header are cut, F10), the
 * history as an area chart with its own window, and the not-connected state
 * as a GEmpty with a Set up link (F12).
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { GAreaChart, GButton, GCard, GEmpty, GHeroCard, GList, GPage, GRow, GSectionHeader, GSegmented, GTag, GTickStrip } from '@/components/g';
import type { Newsletter } from '@/lib/newsletters';
import { formatFull } from '@/lib/format-number';
import { fmtDay, fmtPct, MAX_MARKS } from '@/lib/social-view';

function Back() {
  return (
    <div className="soc-g-back">
      <GButton size="sm" href="/social"><ChevronLeft size={14} strokeWidth={1.75} aria-hidden /> All platforms</GButton>
    </div>
  );
}

export function PlatformNotConnectedG({ label, setupHref }: { label: string; setupHref: string }) {
  return (
    <GPage className="soc-g soc-g-detail">
      <Back />
      <GSectionHeader size="page" title={label} />
      <GCard p={24}>
        <GEmpty kind="unconfigured" title={`${label} is not connected`} body="Follower history appears here once Zernio tracks this account." setupHref={setupHref} setupHint={`Connect ${label} through Zernio`} />
      </GCard>
    </GPage>
  );
}

type Growth = { d7: number | null; d30: number | null; d60: number | null; allTime: number | null };

const WINDOWS = [
  { value: '30', label: '30d', days: 30 },
  { value: '90', label: '90d', days: 90 },
  { value: 'all', label: 'All', days: Infinity },
];

export function PlatformG(props: {
  label: string;
  handle: string;
  url: string | null;
  followers: number | null;
  growth: Growth;
  snapshots: { date: string; followers: number }[];
  source: string | null;
}) {
  const { label, handle, url, followers, growth, snapshots, source } = props;
  const [win, setWin] = useState('30');
  const days = WINDOWS.find((w) => w.value === win)?.days ?? 30;
  const chart = useMemo(() => {
    const last = snapshots.at(-1)?.date;
    const cutoff = last && Number.isFinite(days) ? new Date(Date.parse(`${last}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10) : '';
    const inWin = snapshots.filter((s) => s.date >= cutoff);
    const step = Math.max(1, Math.ceil(inWin.length / MAX_MARKS));
    const idx = inWin.map((_, i) => i).filter((i) => (inWin.length - 1 - i) % step === 0);
    return idx.map((i) => ({ ...inWin[i], prev: i > 0 ? inWin[i - step]?.followers ?? inWin[0].followers : null }));
  }, [snapshots, days]);
  const latest = snapshots.at(-1);

  return (
    <GPage className="soc-g soc-g-detail">
      <Back />
      <GSectionHeader
        size="page"
        title={label}
        caption={handle}
        action={url ? <GButton href={url} external>Open profile <ExternalLink size={13} strokeWidth={1.75} aria-hidden /></GButton> : undefined}
      />
      <div className="soc-g-detail-top">
        <GHeroCard
          variant="a"
          caption="Followers"
          value={followers == null ? null : formatFull(followers)}
          label={`${label} followers ${followers == null ? 'unknown' : formatFull(followers)}`}
          title="The newest follower snapshot"
          status={growth.d30 == null ? 'No 30-day history yet' : `${fmtPct(growth.d30)} over 30 days`}
          strip={<Strip points={snapshots.slice(-30)} what="followers" />}
        />
        <GrowthStats growth={growth} />
      </div>
      <section className="soc-g-sec" aria-labelledby="soc-g-history">
        <GSectionHeader
          id="soc-g-history"
          size={22}
          title="Follower history"
          action={<GSegmented label="History window" options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} value={win} onChange={setWin} />}
        />
        <GCard p={24} className="soc-g-chart">
          <GAreaChart
            labels={chart.map((c) => fmtDay(c.date))}
            series={[{ id: 'followers', label: 'Followers', values: chart.map((c) => c.followers), color: 'accent' }]}
            height={240}
            zeroBase={false}
            formatValue={formatFull}
            tip={(i) => {
              const c = chart[i];
              const d = c.prev == null ? null : c.followers - c.prev;
              return { title: fmtDay(c.date), lines: [formatFull(c.followers), d == null ? 'first snapshot' : `${d >= 0 ? '+' : '−'}${formatFull(Math.abs(d))} vs previous`] };
            }}
            label={`${label} followers, ${win === 'all' ? 'all time' : `last ${win} days of snapshots`}`}
            emptyText="No snapshots yet."
          />
          {latest && <p className="soc-g-cap">{snapshots.length} snapshots · latest {fmtDay(latest.date)}{source ? ` · ${source}` : ''}</p>}
        </GCard>
      </section>
    </GPage>
  );
}

/** The hero strip: one tick per recent snapshot (absent below two). */
function Strip({ points, what }: { points: { date: string; followers: number }[]; what: string }) {
  if (points.length < 2) return null;
  return (
    <GTickStrip
      onHero
      values={points.map((p) => p.followers)}
      titles={points.map((p) => `${fmtDay(p.date)} · ${formatFull(p.followers)}`)}
      label={`${what}, last ${points.length} snapshots`}
    />
  );
}

/** A plain number + caption: dot numerals are for heroes, a row of them reads as noise. */
function Readout({ value, label, title, tone }: { value: string; label: string; title: string; tone?: 'ok' | 'err' }) {
  return (
    <div className="soc-g-readout" title={title}>
      <span className="soc-g-num" data-tone={tone}>{value}</span>
      <span className="soc-g-cap">{label}</span>
    </div>
  );
}

function GrowthStats({ growth }: { growth: Growth }) {
  const items: [string, number | null][] = [['7 days', growth.d7], ['30 days', growth.d30], ['60 days', growth.d60], ['All time', growth.allTime]];
  return (
    <GCard p={24} className="soc-g-statcard" aria-labelledby="soc-g-growth">
      <GSectionHeader id="soc-g-growth" size={22} title="Growth" caption="From follower snapshots" />
      <div className="soc-g-stats">
      {items.map(([label, v]) => (
        <Readout key={label} value={v == null ? '—' : fmtPct(v)} label={label} title={`Follower growth over ${label.toLowerCase()}, from snapshot history`} tone={v != null && v < 0 ? 'err' : undefined} />
      ))}
      </div>
    </GCard>
  );
}

export function BeehiivG(props: {
  subscribers: number | null;
  status: { text: string; tone: 'ok' | 'err' | 'neutral'; setupHref: string | null };
  count: number;
  avgOpenRate: number | null;
  bestOpenRate: number | null;
  newsletters: Newsletter[];
  /** Subscriber snapshots, oldest first (the hero strip). */
  history: { date: string; followers: number }[];
}) {
  const { subscribers, status, count, avgOpenRate, bestOpenRate, newsletters, history } = props;
  const pct = (n: number | null) => (n == null ? null : `${n.toFixed(1)}%`);
  return (
    <GPage className="soc-g soc-g-detail">
      <Back />
      <GSectionHeader
        size="page"
        title="Newsletter"
        caption={
          <span className="soc-g-status">
            <GTag tone={status.tone} dot>{status.text}</GTag>
            {status.setupHref && <GButton size="sm" href={status.setupHref} title="Connect Beehiiv for live subscribers and issues">Set up</GButton>}
          </span>
        }
        action={<GButton href="https://app.beehiiv.com" external>Open Beehiiv <ExternalLink size={13} strokeWidth={1.75} aria-hidden /></GButton>}
      />
      <div className="soc-g-detail-top">
        <GHeroCard
          variant="a"
          caption="Subscribers"
          value={subscribers == null ? null : formatFull(subscribers)}
          label={`Subscribers ${subscribers == null ? 'unknown' : formatFull(subscribers)}`}
          title="The email list count, the same figure as the Social page"
          status={subscribers == null ? 'No count yet' : 'Email list'}
          strip={<Strip points={history.slice(-30)} what="subscribers" />}
        />
        <GCard p={24} className="soc-g-statcard" aria-labelledby="soc-g-sends">
          <GSectionHeader id="soc-g-sends" size={22} title="Sends" caption="From Beehiiv issues" />
          <div className="soc-g-stats soc-g-stats-3">
          <Readout value={formatFull(count)} label="Newsletters sent" title="Issues sent" />
          <Readout value={pct(avgOpenRate) ?? '—'} label="Average open rate" title="Average open rate across sent issues; — when nothing was sent" />
          <Readout value={pct(bestOpenRate) ?? '—'} label="Best open rate" title="Best open rate of any sent issue; — when nothing was sent" />
          </div>
        </GCard>
      </div>
      <section className="soc-g-sec" aria-labelledby="soc-g-issues">
        <GSectionHeader id="soc-g-issues" size={22} title="Past newsletters" caption="Open an issue to see its analytics" />
        <IssuesG newsletters={newsletters} />
      </section>
    </GPage>
  );
}

const nfmt = (n: number) => n.toLocaleString('en-US');
const npct = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)}%`;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function IssuesG({ newsletters }: { newsletters: Newsletter[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (newsletters.length === 0) return <GCard p={24}><GEmpty title="No newsletters yet" body="Sent issues and their open rates show here." /></GCard>;
  return (
    <GCard p={16}>
      <GList divided label="Past newsletters">
        {newsletters.map((n) => {
          const open = openId === n.id;
          return (
            <li key={n.id} className="soc-g-issue">
              <GList>
                <GRow
                  onClick={() => setOpenId(open ? null : n.id)}
                  selected={open}
                  title={n.title}
                  meta={`${dateLabel(n.publishedAt)} · ${nfmt(n.recipients)} sent`}
                  trailing={<span className="soc-g-val" title="Open rate">{npct(n.openRate)} open</span>}
                />
              </GList>
              {open && (
                <div className="soc-g-issue-body">
                  {[
                    ['Recipients', nfmt(n.recipients)],
                    ['Delivered', `${nfmt(n.delivered)} · ${npct(n.deliveryRate)}`],
                    ['Opens', `${nfmt(n.opens)} · ${npct(n.openRate)}`],
                    ['Clicks', `${nfmt(n.clicks)} · ${npct(n.clickRate)}`],
                    ['Unsubscribes', `${nfmt(n.unsubscribes)} · ${npct(n.unsubscribeRate)}`],
                    ['Spam reports', nfmt(n.spamReports)],
                    ['Web views', nfmt(n.webViews)],
                  ].map(([k, v]) => (
                    <div key={k} className="soc-g-kv"><span className="soc-g-cap">{k}</span><span className="soc-g-val">{v}</span></div>
                  ))}
                  {n.webUrl && <GButton size="sm" href={n.webUrl} external>Read the issue</GButton>}
                </div>
              )}
            </li>
          );
        })}
      </GList>
    </GCard>
  );
}
