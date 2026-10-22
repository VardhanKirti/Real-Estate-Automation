'use client';

/**
 * Brand Deals under the GladOS style (glados-ui SPEC S02 §4.3, §5.3, §5.6;
 * X5 two-tree pattern). Same data, poll, filters and drawer actions as the
 * Classic DealBoard; every widget is a G kit part. Layout kept: Pipeline +
 * Deal volume, then Send activity · Chains · Unique, then the deal list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ExternalLink, MessagesSquare, RefreshCw, Send, X } from 'lucide-react';
import {
  GAsk, GBarChart, GButton, GCard, GDotCloud, GDotMatrix, GDotNumber, GDrawer, GDriverBars, GEmpty, GErrorLine, GHeroCard, GInput, GPage,
  GList, GRow, GSectionHeader, GSegmented, GTag, GTextarea, GTimelineStrip, GWell, type GTagTone, type StageColumn, type TimelineEvent,
} from '@/components/g';
import { formatUsdCompact } from '@/lib/format-number';
import { CHAIN_DEPTH_BUCKETS, chainDepthBucket, sendRangeFor, sendSpanMs, SEND_RANGES, stageBars, type ChainDepthBucket, type DealFilter, type SendRange } from '@/lib/brand-deals-view';
import type { BrandDealsSnapshot, Deal, DealOutcome } from '@/lib/brand-deals';
import { parseDealQuery, useDealBoard } from './use-deal-board';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const frac = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(1, a / b)) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function age(iso: string | null, now: number): string {
  if (!iso || !now) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.round(hrs / 24)} d`;
}

/** The chart column a stage filter lights (S02 §5.3 Selection); `unique` lights none. */
function columnFor(f: DealFilter): string | null {
  if (f === 'won' || f === 'lost' || f === 'closed') return 'closed';
  if (f === 'unique') return null;
  return f;
}

function stageTag(d: Deal): { text: string; tone: GTagTone } {
  if (d.outcome === 'won') return { text: 'Won', tone: 'ok' };
  if (d.outcome === 'lost') return { text: 'Lost', tone: 'err' };
  if (d.outcome === 'skipped' || d.stage === 'skipped') return { text: 'Skipped', tone: 'neutral' };
  if (d.stage === 'approval') return { text: 'Approve', tone: 'warn' };
  if (d.stage === 'sent') return { text: 'Sent', tone: 'accent' };
  return { text: 'Closed', tone: 'neutral' };
}

export function DealBoardG({ initial, botUrl = null }: { initial: BrandDealsSnapshot; botUrl?: string | null }) {
  const b = useDealBoard(initial);
  const { snap, poll, now, stageFilter, setStageFilter, depth, setDepth, filtered, selected } = b;
  const { counts, volume } = snap;
  const listRef = useRef<HTMLDivElement>(null);
  const toList = () => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /* Pipeline: the revenue chart (FR-B2): bars in dollars, count secondary. */
  const columns: StageColumn[] = useMemo(() => {
    const open = volume.openUsd;
    return stageBars(snap).map((c) => {
      if (c.key === 'closed') {
        const [won, lost] = c.segments ?? [];
        return {
          id: c.key,
          label: c.label,
          value: c.usd,
          count: c.count,
          won: won?.usd ?? 0,
          lost: lost?.usd ?? 0,
          sub: plural(c.count, 'deal'),
          tip: { lines: [`${won?.count ?? 0} won · ${usd(won?.usd ?? 0)}`, `${lost?.count ?? 0} lost · ${usd(lost?.usd ?? 0)}`], hint: 'Click a segment to show won or lost' },
        };
      }
      const share = c.key !== 'all' && open > 0 ? `${Math.round((c.usd / open) * 100)}% of open value` : 'every tracked deal thread';
      return { id: c.key, label: c.label, value: c.usd, count: c.count, tip: { lines: [`${usd(c.usd)} across ${plural(c.count, 'deal')}`, share] } };
    });
  }, [snap, volume.openUsd]);
  const allZero = columns.every((c) => !(c.value > 0));
  const segment = stageFilter === 'won' || stageFilter === 'lost' ? stageFilter : null;

  /* Send activity (FR-B4): one dot per event in the chosen range. */
  const [range, setRange] = useState<SendRange | null>(null);
  const effRange = range ?? (now ? sendRangeFor(snap.events, now) : '30d');
  const r = SEND_RANGES[effRange];
  const span = sendSpanMs(effRange, snap.events, now || Date.parse(snap.lastActivityAt ?? '') || 0);
  const events: TimelineEvent[] = useMemo(
    () =>
      snap.events.map((e, i) => {
        const d = snap.deals.find((x) => x.id === e.dealId);
        const when = new Date(e.at);
        return {
          id: `${e.dealId}:${e.kind}:${i}`,
          at: e.at,
          status: e.kind,
          lane: e.kind === 'sent' ? 1 : e.kind === 'announced' ? 0 : 2,
          title: e.brand,
          detail: `${e.kind === 'sent' ? 'Sent' : e.kind === 'announced' ? 'Announced' : 'Skipped'} · ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
          meta: d && d.chainLen > 0 ? plural(d.chainLen, 'msg') + ' in thread' : undefined,
        };
      }),
    [snap.events, snap.deals],
  );
  const sendsInRange = now ? snap.events.filter((e) => e.kind === 'sent' && now - Date.parse(e.at) <= span).length : 0;
  const order = Object.keys(SEND_RANGES) as SendRange[];
  const step = (dir: 'wider' | 'narrower') => {
    const i = order.indexOf(effRange);
    const j = dir === 'wider' ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
    setRange(order[j]);
  };
  const agoLabel = r.spanMs ? r.ago : `${Math.round(span / 86_400_000)} d ago`;

  /* Chains (FR-B5): depth columns filter the list. */
  const depthCols = useMemo(() => {
    const n = new Map<ChainDepthBucket, number>(CHAIN_DEPTH_BUCKETS.map((k) => [k, 0]));
    for (const d of snap.deals) {
      const k = chainDepthBucket(d.chainLen);
      if (k) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return CHAIN_DEPTH_BUCKETS.map((k) => ({ id: k, label: k, value: n.get(k) ?? 0, title: `${k} ${k === '1' ? 'message' : 'messages'} · ${plural(n.get(k) ?? 0, 'deal')}` }));
  }, [snap.deals]);
  const totalMsgs = snap.deals.reduce((n, d) => n + d.chainLen, 0);
  const deepest = Math.max(0, ...snap.deals.map((d) => d.chainLen));

  const uniqueDeals = snap.deals.filter((d) => d.tag === 'UNIQUE');
  const reasons = Array.from(new Set(uniqueDeals.map((d) => d.tagReason).filter(Boolean))).slice(0, 2);
  const { token } = parseDealQuery(b.query);

  const head = (
    <GSectionHeader
      size="page"
      title="Deal journeys"
      caption="Every brand thread bdpilot is working, from first email to outcome."
      action={
        <div className="bd-g-head-actions">
          <span role="status" data-poll-status={poll.tone} title={poll.title}>
            <GTag tone={poll.tone === 'warn' ? 'warn' : 'neutral'} dot={poll.tone === 'warn'}>{poll.text}</GTag>
          </span>
          {botUrl && (
            <GButton href={botUrl} external data-bot-link="" title="Approve drafts in the Telegram bot">
              Approve in Telegram <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
            </GButton>
          )}
          <GButton variant="icon" aria-label="Refresh" title="Refresh now" onClick={b.refresh}>
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
          </GButton>
        </div>
      }
    />
  );

  // bdpilot not reporting on this host (H7): route to setup instead of a board of zeros.
  if (!snap.sources.state) {
    return (
      <GPage className="bd-g">
        <div data-bd-empty="unconfigured">
          {head}
          <GCard p={24} className="bd-g-gap">
            <GEmpty kind="unconfigured" title="bdpilot is not reporting" body="No brand-deal daemon state was found on this host, so there are no deals, quotes or sends to show yet." setupHref="/setup" setupHint="bdpilot state file not found (BDPILOT_STATE)" />
          </GCard>
        </div>
      </GPage>
    );
  }

  return (
    <GPage className="bd-g">
      {head}

      <div className="bd-g-row1">
        <GCard p={24} className="bd-g-pipeline" aria-labelledby="bd-g-pipeline">
          <GSectionHeader
            id="bd-g-pipeline"
            size={22}
            title="Pipeline"
            caption="Bar height is quoted value; the count is under each figure."
            action={
              <GButton variant="icon" size="sm" aria-label="Show the deal list" title="Show the deal list" onClick={toList}>
                <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
              </GButton>
            }
          />
          <div className="bd-g-chart">
            <GBarChart
              variant="stages"
              measure="usd"
              flow
              columns={columns}
              selected={columnFor(stageFilter)}
              onSelect={(id) => setStageFilter(id as DealFilter)}
              onSegmentSelect={(_, seg) => setStageFilter(seg)}
              selectedSegment={segment}
              countNoun={['deal', 'deals']}
              tipHint="Click to show these deals"
              label="Pipeline by stage, bar height in quoted dollars"
            />
            {allZero && <p className="bd-g-note">No quotes yet. Set one from a deal&apos;s drawer.</p>}
          </div>
          <GAsk mode="filter" value={b.query} onValueChange={b.setQuery} label="Filter deals" placeholder="Filter deals, or type /unique /approval /won /lost" className="bd-g-ask" />
          {token && (
            <p className="bd-g-token">
              {parseDealQuery(b.query).tokenFilter ? <>Filtering by <GTag size="xs" tone="accent">{token}</GTag></> : <>Unknown filter <GTag size="xs" tone="warn">{token}</GTag> · try /unique /approval /won /lost</>}
            </p>
          )}
        </GCard>

        <GHeroCard
          variant="a"
          className="bd-g-volume"
          caption="Open deal value"
          value={formatUsdCompact(volume.openUsd)}
          label={`Open deal value ${usd(volume.openUsd)}`}
          title={`Open = needs approval + awaiting brand. ${volume.quotedDeals} of ${snap.deals.length} threads carry a quote.`}
          status={`${volume.quotedDeals} of ${snap.deals.length} threads quoted`}
          strip={
            <GDriverBars
              labelWidth={116}
              label="Open value by stage"
              max={1}
              rows={[
                { id: 'approval', label: `Needs approval (${counts.approval})`, value: frac(volume.approvalUsd, volume.openUsd), display: formatUsdCompact(volume.approvalUsd), title: `Needs approval: ${usd(volume.approvalUsd)} across ${plural(counts.approval, 'deal')}, share of open value. Click to show them.`, onClick: () => { setStageFilter('approval'); toList(); }, selected: stageFilter === 'approval' },
                { id: 'sent', label: `Awaiting brand (${counts.sent})`, value: frac(volume.awaitingUsd, volume.openUsd), display: formatUsdCompact(volume.awaitingUsd), title: `Awaiting brand: ${usd(volume.awaitingUsd)} across ${plural(counts.sent, 'deal')}, share of open value. Click to show them.`, onClick: () => { setStageFilter('sent'); toList(); }, selected: stageFilter === 'sent' },
                { id: 'closed', label: `Won vs lost (${counts.won}/${counts.lost})`, value: frac(volume.wonUsd, volume.wonUsd + volume.lostUsd), display: `${formatUsdCompact(volume.wonUsd)} / ${formatUsdCompact(volume.lostUsd)}`, title: `Won ${usd(volume.wonUsd)}, lost ${usd(volume.lostUsd)}; the bar is the won share of closed value. Click to show closed deals.`, onClick: () => { setStageFilter('closed'); toList(); }, selected: stageFilter === 'closed' },
              ]}
            />
          }
        />
      </div>

      <div className="bd-g-row2">
        <GCard p={24} aria-labelledby="bd-g-sends">
          <GSectionHeader id="bd-g-sends" size={22} title="Send activity" />
          <div className="bd-g-stat">
            <GDotNumber value={String(sendsInRange)} size={4} label={`${sendsInRange} sends in range`} />
            <span className="bd-g-stat-cap">{sendsInRange === 1 ? 'send' : 'sends'} · {r.long}</span>
          </div>
          <GTimelineStrip
            readOnly
            events={events}
            spanMs={span}
            now={now || undefined}
            agoLabel={agoLabel}
            emptyText="No sends yet"
            onDot={(id) => b.setSelectedId(id.split(':')[0])}
            onCluster={() => (effRange === '24h' ? toList() : step('narrower'))}
            onRangeStep={step}
            rangeControl={
              <GSegmented<SendRange>
                label="Range"
                value={effRange}
                onChange={setRange}
                options={order.map((k) => ({ value: k, label: SEND_RANGES[k].label, title: SEND_RANGES[k].long }))}
              />
            }
            label="Brand deal sends, announcements and skips over time"
          />
        </GCard>

        <GCard p={24} aria-labelledby="bd-g-chains">
          <GSectionHeader id="bd-g-chains" size={22} title="Chains" />
          <div className="bd-g-stat">
            <GDotNumber value={String(totalMsgs)} size={4} label={`${totalMsgs} messages`} />
            <span className="bd-g-stat-cap">messages · deepest {deepest}</span>
          </div>
          <GDotMatrix
            columns={depthCols}
            color="series-2"
            selected={depth}
            onSelect={(id) => setDepth(depth === id ? null : (id as ChainDepthBucket))}
            label="Deals by chain depth; pick a column to filter the list"
            className="bd-g-depth"
          />
          <p className="bd-g-cap">Messages per thread. Pick a column to filter the list.</p>
        </GCard>

        <GHeroCard
          variant="b"
          className="bd-g-unique"
          caption="Outside the reel playbook"
          value={String(counts.unique)}
          label={`${counts.unique} unique deals`}
          status={`${counts.unique} of ${plural(snap.deals.length, 'deal')}${reasons.length ? ` · ${reasons.join(' · ')}` : ''}`}
          title="Deals tagged unique by bdpilot. Click to show them."
          strip={<GDotCloud total={snap.deals.length} lit={counts.unique} onHero label={`${counts.unique} of ${snap.deals.length} deals are unique`} />}
          onClick={() => { setStageFilter('unique'); toList(); }}
        />
      </div>

      <div ref={listRef} className="bd-g-listwrap">
        <GCard p={24} aria-labelledby="bd-g-deals">
          <div className="bd-g-listhead">
            <GSectionHeader id="bd-g-deals" size={22} title="Deals" caption={`${filtered.length} of ${snap.deals.length}`} />
            <div className="bd-g-filters">
              {depth && (
                <GButton size="sm" onClick={() => setDepth(null)} aria-label={`Remove chain depth filter ${depth}`} title="Remove the chain depth filter">
                  Depth {depth} <X size={12} strokeWidth={1.75} aria-hidden />
                </GButton>
              )}
              <GSegmented<DealFilter>
                label="Stage"
                size="md"
                value={stageFilter === 'closed' ? 'closed' : stageFilter}
                onChange={setStageFilter}
                options={[
                  { value: 'all', label: `All ${snap.deals.length}` },
                  { value: 'approval', label: `Needs approval ${counts.approval}` },
                  { value: 'sent', label: `Awaiting ${counts.sent}` },
                  { value: 'unique', label: `Unique ${counts.unique}` },
                  ...(stageFilter === 'closed' ? [{ value: 'closed' as const, label: `Closed ${counts.won + counts.lost}` }] : []),
                  { value: 'won', label: `Won ${counts.won}` },
                  { value: 'lost', label: `Lost ${counts.lost}` },
                ]}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <GEmpty inline title="Nothing matches that filter." />
          ) : (
            <GList label="Deals" className="bd-g-list">
              {filtered.map((d) => {
                const st = stageTag(d);
                return (
                  <GRow
                    key={d.id}
                    className="bd-g-row"
                    selected={b.selectedId === d.id}
                    onClick={() => b.setSelectedId(d.id)}
                    hint={`Open ${d.brand}`}
                    title={d.brand}
                    meta={d.email}
                    trailing={
                      <span className="bd-g-trail">
                        <span className="bd-g-subject">{d.subject || d.tagReason || '—'}</span>
                        <span className="bd-g-tags">
                          {d.quotedUsd != null && <GTag tone="accent" title={d.quoteSource === 'manual' ? 'Quote set manually' : 'Quote parsed from the thread'}>{usd(d.quotedUsd)}</GTag>}
                          {d.tag === 'UNIQUE' && <GTag tone="outline">Unique</GTag>}
                          <GTag tone={st.tone}>{st.text}</GTag>
                        </span>
                        <span className="bd-g-meta" title={`${plural(d.chainLen, 'message')} cached`}>
                          {d.chainLen > 0 && (<><MessagesSquare size={12} strokeWidth={1.6} aria-hidden /> {d.chainLen}</>)}
                        </span>
                        <span className="bd-g-meta bd-g-age" title={d.lastEventAt ?? undefined}>{age(d.lastEventAt, now)}</span>
                      </span>
                    }
                  />
                );
              })}
            </GList>
          )}
        </GCard>
      </div>

      <DealDrawerG b={b} deal={selected} />
    </GPage>
  );
}

/* ── the deal drawer (FR-B8): behaviour unchanged, kit controls ─────────── */

function DealDrawerG({ b, deal }: { b: ReturnType<typeof useDealBoard>; deal: Deal | null }) {
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [quote, setQuote] = useState('');
  const id = deal?.id ?? null;
  useEffect(() => {
    setArmed(false);
    setDraft(null);
    b.setNotice(null);
    setQuote(deal?.quotedUsd != null ? String(deal.quotedUsd) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!deal) return null;
  const busy = b.busy;
  const st = stageTag(deal);
  return (
    <GDrawer open onClose={() => b.setSelectedId(null)} title={deal.brand} width={480} className="bd-g-drawer">
      <div className="bd-g-dhead">
        <span className="bd-g-email">{deal.email}</span>
        <span className="bd-g-tags">
          <GTag tone={st.tone}>{deal.stage === 'approval' && deal.outcome === 'open' ? 'Needs approval' : st.text}</GTag>
          {deal.tag === 'UNIQUE' && <GTag tone="outline">Unique</GTag>}
          {deal.chainLen > 0 && <GTag>{plural(deal.chainLen, 'msg')}</GTag>}
        </span>
        {deal.tagReason && <p className="bd-g-cap">{deal.tagReason}</p>}
      </div>
      {b.notice && <GErrorLine align="left">{b.notice}</GErrorLine>}

      {deal.stage === 'approval' && (
        <section className="bd-g-sec">
          <h3 className="bd-g-sec-title">Draft actions</h3>
          <div className="bd-g-actions">
            {!armed ? (
              <GButton variant="ink" onClick={() => setArmed(true)} disabled={busy != null}>
                <Send size={13} strokeWidth={1.75} aria-hidden /> Send as the verified sender
              </GButton>
            ) : (
              <>
                <GButton variant="ink" busy={busy === 'send'} disabled={busy != null && busy !== 'send'} onClick={async () => { if (await b.act('send', '/api/brand-deals/send', { dealId: deal.id })) setArmed(false); }}>
                  Confirm send
                </GButton>
                <GButton onClick={() => setArmed(false)} disabled={busy != null}>Cancel</GButton>
              </>
            )}
            <GButton busy={busy === 'skip'} disabled={busy != null && busy !== 'skip'} onClick={() => b.act('skip', '/api/brand-deals/override', { dealId: deal.id, outcome: 'skipped' })}>Skip</GButton>
            {draft === null && (
              <GButton busy={busy === 'draft-load'} disabled={busy != null && busy !== 'draft-load'} onClick={async () => { const t = await b.loadDraft(deal.id); if (t !== null) setDraft(t); }}>
                Edit draft
              </GButton>
            )}
          </div>
          {draft !== null && (
            <div className="bd-g-draft">
              <GTextarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} maxLines={16} aria-label="Draft email body" />
              <div className="bd-g-actions">
                <GButton variant="ink" busy={busy === 'draft-save'} disabled={(busy != null && busy !== 'draft-save') || !draft.trim()} disabledReason="The draft is empty" onClick={async () => { if (await b.act('draft-save', '/api/brand-deals/draft', { dealId: deal.id, text: draft })) setDraft(null); }}>
                  Save draft
                </GButton>
                <GButton onClick={() => setDraft(null)} disabled={busy != null}>Cancel</GButton>
              </div>
              <p className="bd-g-cap">Recipient, subject, and thread are locked in code, so an edit can never redirect the email.</p>
            </div>
          )}
        </section>
      )}

      <section className="bd-g-sec">
        <h3 className="bd-g-sec-title">Outcome</h3>
        <div className="bd-g-actions">
          {([['open', 'Reopen'], ['won', 'Mark won'], ['lost', 'Mark lost']] as Array<[DealOutcome, string]>).map(([o, label]) => (
            <GButton
              key={o}
              variant={deal.outcome === o ? 'ink' : 'default'}
              aria-pressed={deal.outcome === o}
              busy={busy === `outcome-${o}`}
              disabled={(busy != null && busy !== `outcome-${o}`) || deal.outcome === o}
              disabledReason={deal.outcome === o ? 'Already the outcome' : undefined}
              onClick={() => b.act(`outcome-${o}`, '/api/brand-deals/override', { dealId: deal.id, outcome: o })}
            >
              {label}
            </GButton>
          ))}
        </div>
        <div className="bd-g-quote">
          <GInput value={quote} onChange={(e) => setQuote(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="USD" aria-label="Quote in USD" className="bd-g-quote-input" />
          <GButton busy={busy === 'quote'} disabled={busy != null && busy !== 'quote'} onClick={() => b.act('quote', '/api/brand-deals/override', { dealId: deal.id, amountUsd: quote ? Number(quote) : null })}>Set quote</GButton>
          <span className="bd-g-cap">{deal.quotedUsd != null ? (deal.quoteSource === 'manual' ? 'Set manually' : 'Parsed from the thread') : 'No quote detected'}</span>
        </div>
        <p className="bd-g-cap">Outcome and quote are tracked here only. They never email anyone.</p>
      </section>

      {deal.summary && (
        <section className="bd-g-sec">
          <h3 className="bd-g-sec-title">Summary</h3>
          <p className="bd-g-body">{deal.summary}</p>
        </section>
      )}

      <section className="bd-g-sec">
        <h3 className="bd-g-sec-title">Email chain {deal.chain.length > 0 && <span className="bd-g-cap">{deal.chain.length}</span>}</h3>
        {deal.chain.length === 0 && <p className="bd-g-cap">No cached chain for this deal (sent before chain caching existed).</p>}
        <div className="bd-g-chain">
          {deal.chain.map((m, i) => (
            <GWell key={i}>
              <details open={i >= deal.chain.length - 2}>
                <summary className="bd-g-msg-head">
                  <span className="bd-g-msg-who">{m.who}</span>
                  <span className="bd-g-cap">{m.date}</span>
                </summary>
                <p className="bd-g-body">{m.body}</p>
              </details>
            </GWell>
          ))}
        </div>
      </section>
    </GDrawer>
  );
}
