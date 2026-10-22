'use client';

/**
 * /trading under the Bennett Legacy style (pages/trading.md §8): FounderOS's
 * own Trading slab, card for card (shots/founderos-v1/trading-1440-full.png),
 * minus its defects: no seeded rows, limits editable, works at 390. Legacy kit
 * and --l-* tokens only; the same model (lib/trading-model.ts) and behaviour
 * (use-trading.ts) as the other trees. Monitor only: nothing here places an order.
 */
import { useId, useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, RefreshCw, SlidersHorizontal, TrendingUp } from 'lucide-react';
import {
  Badge,
  BigStat,
  Chip,
  DotMatrix,
  InsightCard,
  LDialog,
  LEmpty,
  LError,
  LSampleChip,
  LSwitch,
  LUnconfigured,
  MeterStack,
  Pressable,
  SlabCard,
  SlabTitle,
  ToggleChip,
  type BadgeTone,
  type Meter,
} from '@/components/legacy';
import { extent, nearestIndex, spreadX } from '@/lib/chart-geometry';
import {
  ago, logRows, qty, signedUsd, stamp, toneOf, tradeLine, usd, whoOf, type ActivityFilter, type TradingModel,
} from '@/lib/trading-model';
import type { TradeActivity, TradingPosition } from '@/lib/schemas';
import { useTrading, type TradingUi } from './use-trading';
import type { TradingTreeProps } from './TradingG';

const statusTone: Record<TradeActivity['status'], BadgeTone> = { filled: 'ok', pending: 'default', cancelled: 'default', rejected: 'err' };
const statusLabel: Record<TradeActivity['status'], string> = { filled: 'Filled', pending: 'Pending', cancelled: 'Cancelled', rejected: 'Rejected' };
const verdictTone = (v: string): BadgeTone => (/buy|enter|long|take/i.test(v) ? 'ok' : /sell|exit|trim/i.test(v) ? 'warn' : /watch|hold/i.test(v) ? 'accent' : 'default');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const acctName = (id: string) => (id === 'agentic' ? 'Agentic' : cap(id));
const EYEBROW = 'Markets · Robinhood + Phantom · agent-fed';

function Pnl({ n, cents = true }: { n: number | null; cents?: boolean }) {
  if (n === null) return <span className="l-muted">unknown</span>;
  return (
    <span className="l-pnl" data-tone={toneOf(n)}>
      {signedUsd(n, cents)}
    </span>
  );
}

export function TradingLegacy({ model: m, pushPath, setup }: TradingTreeProps) {
  const ui = useTrading(m, pushPath);
  const p = m.payload;

  const right = (
    <>
      {m.fixture && <LSampleChip label="Sample" />}
      {m.feedPill ? (
        <span title={m.feedPill.title}>
          <Chip tone={m.feedPill.tone}>{m.feedPill.text}</Chip>
        </span>
      ) : null}
      <span data-l="Pill" className="l-pill-static">
        monitor-only
      </span>
      {!m.unconfigured && (
        <Pressable tone="ghost" onClick={ui.refresh} disabled={ui.refreshing} aria-label="Refresh" title="Reload from the store; the wallet read is cached 60 s">
          <RefreshCw size={14} strokeWidth={1.7} aria-hidden className={ui.refreshing ? 'l-spin' : undefined} />
        </Pressable>
      )}
    </>
  );

  return (
    <div data-l="TradingLegacy" className="l-page">
      <SlabTitle eyebrow={EYEBROW} title="Trading" meta={m.subtitle ?? m.copy.subtitleEmpty} right={right} />

      {m.unconfigured ? (
        <div className="l-row l-row-hero">
          <ConnectCard ui={ui} setupHref={setup.robinhood} i={1} />
          <SlabCard title="Accounts" sub="no source connected" i={2}>
            <LUnconfigured what="The Phantom wallet" href={setup.phantom} hint="Set PHANTOM_WALLET_ADDRESS (a public address, not a key)" />
          </SlabCard>
        </div>
      ) : (
        <div className="l-stack">
          <div className="l-row l-row-hero">
            {m.feed === 'none' ? <ConnectCard ui={ui} setupHref={setup.robinhood} i={1} /> : <Sleeve m={m} ui={ui} />}
            <Accounts m={m} setupPhantom={setup.phantom} />
          </div>
          {m.feed !== 'none' && (
            <>
              <div className="l-row l-row-three">
                <Reasoning m={m} ui={ui} />
                <Positions m={m} ui={ui} />
                <NextMove m={m} />
              </div>
              <OpenOrders m={m} />
              <TradeLog m={m} ui={ui} />
            </>
          )}
          <Limits m={m} ui={ui} />
          <p className="l-foot-note">Only the agentic sleeve can be traded by an agent. Wallet read from a public RPC.</p>
        </div>
      )}

      {ui.openTrade && <TradeDialog trade={ui.openTrade} onClose={() => ui.setOpenTrade(null)} />}
      {ui.positionsOpen && (
        <LDialog title="Positions" sub={`${p.positions.length} open · ${usd(m.investedUsd)} invested`} onClose={() => ui.setPositionsOpen(false)} width={720}>
          <PositionRows rows={p.positions} />
        </LDialog>
      )}
      {ui.notesOpen && p.analysis && (
        <LDialog title="Agent · reasoning" sub={`${p.analysis.agent} · ${stamp(p.analysis.at)}`} onClose={() => ui.setNotesOpen(false)}>
          <p className="l-prose">{p.analysis.notes}</p>
        </LDialog>
      )}
      {ui.autopilot.confirmOpen && (
        <LDialog
          title="Turn on autopilot?"
          onClose={() => ui.autopilot.setConfirmOpen(false)}
          footer={
            <>
              <Pressable onClick={() => ui.autopilot.setConfirmOpen(false)}>Cancel</Pressable>
              <Pressable tone="primary" disabled={ui.autopilot.switching} onClick={() => void ui.autopilot.setAutopilot(true, true)}>
                Turn on
              </Pressable>
            </>
          }
        >
          <p className="l-prose is-muted">{m.copy.autopilotBody}</p>
        </LDialog>
      )}
    </div>
  );
}

/** The unconfigured hero: the Not configured badge, the push URL and its copy button. */
function ConnectCard({ ui, setupHref, i }: { ui: TradingUi; setupHref: string; i: number }) {
  return (
    <SlabCard title="Connect the feed" sub="Markets agent · push token stays in the agent" i={i}>
      <LUnconfigured what="The Markets agent feed" href={setupHref} hint="Have the Markets agent push to /api/trading/snapshot with TRADING_PUSH_TOKEN" />
      <div className="l-card-body pt-0">
        <p className="l-lead">Connect the Markets agent feed. Its first push fills this page.</p>
        <p className="l-caption">The agent posts account snapshots, positions and trades with its push token. The token stays in the agent; only the URL goes here.</p>
        <div data-l="CopyField" className="l-copy-field">
          <code data-copy="">{ui.pushUrl}</code>
          <Pressable onClick={ui.copyPushUrl} aria-label="Copy push URL">
            <Copy size={12} strokeWidth={1.7} aria-hidden /> Copy
          </Pressable>
        </div>
      </div>
    </SlabCard>
  );
}

/**
 * FO's sleeve chart: a straight line over fading pinstripes with square
 * markers on each capture, scaled to the account's own range (a value series
 * would read flat against zero), the change pinned under the middle.
 */
function ValueLine({ points, label }: { points: Array<{ at: string; valueUsd: number }>; label: string }) {
  const W = 600;
  const H = 170;
  const pad = 10;
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((x) => x.valueUsd);
  const geo = useMemo(() => {
    const [lo0, hi0] = extent(values, false);
    const span = hi0 - lo0 || Math.max(1, Math.abs(hi0) * 0.02);
    const lo = lo0 - span * 0.1;
    const hi = hi0 + span * 0.25;
    const xs = spreadX(values.length, pad, W - pad);
    const ys = values.map((v) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2));
    const d = xs.map((x, i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
    return { xs, ys, d, area: `${d} L ${xs[xs.length - 1]} ${H} L ${xs[0]} ${H} Z` };
  }, [values]);
  if (points.length < 2) {
    return <LEmpty>{points.length === 1 ? 'One capture so far. The line starts with the next push.' : 'No captures for this account yet.'}</LEmpty>;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.valueUsd - first.valueUsd;
  const pct = first.valueUsd ? (change / first.valueUsd) * 100 : null;
  const h = hover !== null ? points[hover] : null;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(geo.xs, ((e.clientX - r.left) / r.width) * W));
  };
  // FO pins a square on a handful of captures: every one on a short series, else the peak, the last and the hovered one
  const peak = values.indexOf(Math.max(...values));
  const marked = (i: number) => i === hover || (values.length <= 8 ? i > 0 : i === peak || i === values.length - 1);
  const pins = `l-trd-pins-${uid}`;
  const fade = `l-trd-fade-${uid}`;
  const mask = `l-trd-mask-${uid}`;
  return (
    <div data-l="ValueLine" className="l-stepline l-trd-line">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <pattern id={pins} width="5" height="8" patternUnits="userSpaceOnUse">
            <rect width="1.2" height="8" style={{ fill: 'var(--l-text)' }} opacity="0.28" />
          </pattern>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--l-text)', stopOpacity: 0.9 }} />
            <stop offset="1" style={{ stopColor: 'var(--l-text)', stopOpacity: 0.05 }} />
          </linearGradient>
          <mask id={mask}>
            <rect width={W} height={H} fill={`url(#${fade})`} />
          </mask>
        </defs>
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="l-trd-mid" />
        <path d={geo.area} fill={`url(#${pins})`} mask={`url(#${mask})`} />
        <path className="l-draw" d={geo.d} fill="none" strokeWidth={2.5} strokeLinejoin="miter" pathLength={1} style={{ stroke: 'var(--l-text)' }} />
        {geo.xs.map((x, i) =>
          !marked(i) ? null : (
            <rect key={i} className="l-fade" x={x - 4.5} y={geo.ys[i] - 4.5} width={9} height={9} style={{ fill: i === hover || i === geo.xs.length - 1 ? 'var(--l-text)' : 'var(--l-bg-2)', stroke: 'var(--l-text)', strokeWidth: 2 }} />
          ),
        )}
      </svg>
      <div className="l-axis l-trd-axis">
        <span>{stamp(first.at)}</span>
        <span className="l-pnl" data-tone={toneOf(change)}>
          {h ? `${stamp(h.at)} · ${usd(h.valueUsd, true)}` : `${signedUsd(change)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)` : ''}`}
        </span>
        <span>{stamp(last.at)}</span>
      </div>
    </div>
  );
}

function Sleeve({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const a = m.payload.view.agent;
  const s = m.series.find((x) => x.accountId === ui.acct) ?? m.series[0];
  const strip: Array<{ label: string; value: ReactNode }> = [
    { label: 'Deployed', value: usd(a.deployedUsd, true) },
    { label: 'Idle cash', value: a.idleCashUsd === null ? 'unknown' : usd(a.idleCashUsd, true) },
    { label: 'Unrealized', value: <Pnl n={a.unrealizedPnlUsd} /> },
    { label: 'Agent trades', value: a.tradeCount },
  ];
  return (
    <SlabCard
      title="Agent · the sleeve"
      sub={a.hasActed ? `${a.tradeCount} ${a.tradeCount === 1 ? 'trade' : 'trades'} · last ${a.lastTrade ? ago(a.lastTrade.at, m.now) : ''}` : 'the agent has not traded yet'}
      i={1}
    >
      {m.series.length > 1 && (
        <div role="radiogroup" aria-label="Account shown in the chart" className="l-chip-row l-pad-x pt-3">
          {m.series.map((x) => (
            <ToggleChip key={x.accountId} role="radio" aria-checked={ui.acct === x.accountId} on={ui.acct === x.accountId} onClick={() => ui.setAcct(x.accountId)}>
              {x.label}
            </ToggleChip>
          ))}
        </div>
      )}
      <div className="pt-4">
        <ValueLine points={s?.points ?? []} label={`${s?.label ?? 'Account'} value per capture`} />
      </div>
      {m.hasAgentic ? (
        <dl data-l="StatStrip" className="l-strip mx-6 mb-6">
          {strip.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd>{x.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <LEmpty>No agentic account in the feed. The agent&apos;s stats appear once a push carries the account with id agentic.</LEmpty>
      )}
    </SlabCard>
  );
}

function Accounts({ m, setupPhantom }: { m: TradingModel; setupPhantom: string }) {
  const hasWallet = m.accounts.some((a) => a.kind === 'wallet');
  const brokerage = m.accounts.filter((a) => a.kind === 'brokerage');
  const n = m.payload.positions.length;
  const chips = [
    ...(m.dayPnlUsd !== null ? [{ tone: (m.dayPnlUsd < 0 ? 'err' : 'ok') as 'ok' | 'err', text: `${signedUsd(m.dayPnlUsd)} today` }] : []),
    ...(n ? [{ tone: 'accent' as const, text: `${usd(m.investedUsd)} in ${n} ${n === 1 ? 'position' : 'positions'}` }] : []),
  ];
  const meters: Meter[] = m.accounts.map((a) => ({
    label: `${a.label} · ${a.note}`,
    frac: a.valueUsd === null ? null : a.frac,
    display: a.valueUsd === null ? 'unknown' : usd(a.valueUsd, true),
  }));
  return (
    <SlabCard title="Accounts" sub={`${m.accounts.length} ${m.accounts.length === 1 ? 'source' : 'sources'} · ${m.payload.view.freshness.label}`} i={2} className="flex flex-col">
      <div className="l-card-body flex flex-1 flex-col">
        <BigStat display={m.totalUsd === null ? undefined : usd(m.totalUsd, true)} value={m.totalUsd} caption={`brokerage, ${brokerage.length} ${brokerage.length === 1 ? 'account' : 'accounts'}`} />
        {chips.length > 0 && (
          <div className="l-chip-row mt-3">
            {chips.map((c) => (
              <Chip key={c.text} tone={c.tone}>
                {c.text}
              </Chip>
            ))}
          </div>
        )}
        <MeterStack meters={meters} dense empty="No account has reported yet." />
        {!hasWallet && <LUnconfigured what="The Phantom wallet" href={setupPhantom} hint="Set PHANTOM_WALLET_ADDRESS" />}
        {brokerage.length > 0 && (
          <dl className="l-kv mt-4">
            <div>
              <dt>Cash</dt>
              <dd>{usd(brokerage.reduce((t, a) => t + (a.cashUsd ?? 0), 0), true)}</dd>
            </div>
            <div>
              <dt>Buying power</dt>
              <dd>{usd(brokerage.reduce((t, a) => t + (a.buyingPowerUsd ?? 0), 0), true)}</dd>
            </div>
            <div>
              <dt>Total P&amp;L</dt>
              <dd>
                <Pnl n={m.payload.accounts.reduce((t, a) => t + a.totalPnlUsd, 0)} />
              </dd>
            </div>
          </dl>
        )}
      </div>
    </SlabCard>
  );
}

function Reasoning({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const a = m.payload.analysis;
  return (
    <SlabCard
      title="Agent · reasoning"
      sub={a ? `examined ${a.examined} · ${a.signals} ${a.signals === 1 ? 'signal' : 'signals'} · ${ago(a.at, m.now)}` : 'no run recorded'}
      i={3}
      action={
        a && a.notes.length > 140 ? (
          <Pressable onClick={() => ui.setNotesOpen(true)}>Read all</Pressable>
        ) : undefined
      }
    >
      {!a ? (
        <LEmpty>No analysis pushed yet. The agent writes here every run, whether or not it trades.</LEmpty>
      ) : (
        <div className="l-card-body">
          {a.notes && <p className="l-clamp-3 l-body-text">{a.notes}</p>}
          <ul className="l-rows mt-3">
            {a.rows.slice(0, 6).map((r) => (
              <li key={r.ticker} className="l-trd-why" title={r.score === null ? 'Not scored' : `Score ${r.score.toFixed(2)}`}>
                <span className="l-sym">{r.ticker}</span>
                <span className="l-trd-why-text">{r.reason}</span>
                <Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SlabCard>
  );
}

function PositionRows({ rows }: { rows: TradingPosition[] }) {
  return (
    <ul className="l-rows">
      {rows.map((r) => (
        <li key={`${r.accountId}:${r.symbol}`} className="l-trd-pos">
          <span className="min-w-0">
            <span className="l-sym">{r.symbol}</span> <span className="l-tag">{acctName(r.accountId)}</span>
            <span className="l-sub-line">
              {qty(r.quantity)} @ {usd(r.avgCostUsd, true)}
            </span>
          </span>
          <span className="l-num">{usd(r.marketValueUsd, true)}</span>
          <span className="l-num">
            <Pnl n={r.unrealizedPnlUsd} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Positions({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const pos = m.payload.positions;
  return (
    <SlabCard
      title="Positions"
      sub={pos.length ? `${usd(m.investedUsd)} invested` : 'nothing held'}
      i={4}
      action={pos.length > 4 ? <Pressable onClick={() => ui.setPositionsOpen(true)}>See all</Pressable> : undefined}
    >
      {pos.length === 0 ? (
        <LEmpty>No open positions.</LEmpty>
      ) : (
        <>
          <div className="l-trd-pos-head">
            <BigStat value={pos.length} size={30} caption="open positions" />
            <DotMatrix cols={m.payload.view.sizes.map((b) => ({ label: b.label, count: b.count }))} />
          </div>
          <PositionRows rows={pos.slice(0, 4)} />
        </>
      )}
    </SlabCard>
  );
}

function NextMove({ m }: { m: TradingModel }) {
  const a = m.payload.view.agent;
  const last = m.lastAgentTrade;
  const notes = m.payload.analysis?.notes;
  const budget = m.limits.saved?.maxDeployedCapitalUsd ?? null;
  const frac = budget ? a.deployedUsd / Math.max(1, budget) : null;
  return (
    <InsightCard
      badge="Agent · next move"
      value={a.tradeCount}
      headline={`${a.tradeCount === 1 ? 'trade' : 'trades'} filled in the sleeve.`}
      body={
        <>
          <span className="l-clamp-4">{notes || (last ? `Last: ${last.action} ${tradeLine(last)}, ${ago(last.at, m.now)}. ${last.rationale}` : 'The agent has not reported a run yet.')}</span>
          {m.limits.saved && frac !== null && (
            <span className="mt-2 block text-[11px]">
              Autopilot {m.limits.saved.autopilot ? 'on' : 'off'} · {Math.round(frac * 100)}% of the autonomy budget deployed
            </span>
          )}
        </>
      }
      frac={frac}
      i={5}
      icon={<TrendingUp size={13} strokeWidth={1.7} aria-hidden />}
    />
  );
}

function OpenOrders({ m }: { m: TradingModel }) {
  const orders = m.payload.openOrders;
  return (
    <SlabCard title="Open orders" sub={orders.length ? `${orders.length} working` : 'nothing working'} i={6}>
      {orders.length === 0 ? (
        <LEmpty>No live orders at the broker.</LEmpty>
      ) : (
        <ul className="l-rows l-rows-ruled mt-3">
          {orders.map((o) => (
            <li key={o.id} className="l-trd-trade">
              <span className="l-side" data-side={o.side}>
                {o.side}
              </span>
              <span className="min-w-0">
                <span className="l-sym">{o.symbol}</span>{' '}
                <span className="l-body-text">
                  {o.dollarAmountUsd !== null ? usd(o.dollarAmountUsd, true) : `${qty(o.quantity)}${o.limitPriceUsd !== null ? ` @ ${usd(o.limitPriceUsd, true)}` : ''}`}
                </span>{' '}
                <Badge>{o.state}</Badge>
                <span className="l-sub-line">
                  {cap(o.type)} · {o.filledQuantity ? `${qty(o.filledQuantity)} filled · ` : ''}
                  {o.placedAgent || 'Unknown'}
                </span>
              </span>
              <span className="l-when">{ago(o.createdAt, m.now)}</span>
            </li>
          ))}
        </ul>
      )}
    </SlabCard>
  );
}

function TradeLog({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const c = m.payload.view.activityCounts;
  const rows = logRows(m, ui.log);
  const filters: { value: ActivityFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'agent', label: 'Agent' },
    { value: 'you', label: 'You' },
    { value: 'rejected', label: 'Rejected' },
  ];
  return (
    <SlabCard
      title="Trade log"
      sub={c.all ? `${rows.length} of ${c.all}` : undefined}
      i={7}
      action={
        c.all ? (
          <div role="radiogroup" aria-label="Filter the trade log" className="l-chip-row l-chip-scroll">
            {filters.map((f) => (
              <ToggleChip key={f.value} role="radio" aria-checked={ui.log === f.value} on={ui.log === f.value} onClick={() => ui.setLog(f.value)}>
                {f.label} {c[f.value]}
              </ToggleChip>
            ))}
          </div>
        ) : undefined
      }
    >
      {c.all === 0 ? (
        <LEmpty>No trades yet.</LEmpty>
      ) : rows.length === 0 ? (
        <LEmpty>Nothing matches this filter.</LEmpty>
      ) : (
        <ul className="l-rows l-rows-ruled mt-3">
          {rows.map((t) => (
            <li key={t.id}>
              <Pressable tone="row" className="l-trd-trade" onClick={() => ui.setOpenTrade(t)}>
                <span className="l-side" data-side={t.action}>
                  {t.action}
                </span>
                <span className="min-w-0">
                  <span className="l-sym">{tradeLine(t)}</span> <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
                  <span className="l-sub-line">{t.rationale || 'No rationale given'}</span>
                </span>
                <span className="l-when">
                  {whoOf(t)} · {acctName(t.accountId)}
                  <span className="block">{ago(t.at, m.now)}</span>
                </span>
              </Pressable>
            </li>
          ))}
        </ul>
      )}
    </SlabCard>
  );
}

function TradeDialog({ trade: t, onClose }: { trade: TradeActivity; onClose: () => void }) {
  const rows: [string, ReactNode][] = [
    ['Order', tradeLine(t)],
    ['Notional', usd(t.quantity * t.priceUsd, true)],
    ['Status', <Badge key="s" tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>],
    ['Who', whoOf(t)],
    ['Account', t.accountId === 'agentic' ? 'Agentic sleeve' : acctName(t.accountId)],
  ];
  return (
    <LDialog title={`${t.action === 'buy' ? 'Buy' : 'Sell'} ${t.symbol}`} sub={stamp(t.at)} onClose={onClose}>
      <dl className="l-kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="l-quote mt-4">{t.rationale || 'No rationale given.'}</p>
    </LDialog>
  );
}

function Limits({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const L = ui.limits;
  return (
    <section data-l="SlabCard" className="l-rise l-card l-trd-limits" style={{ ['--l-rise-i' as string]: 8 }} aria-labelledby="l-trd-limits">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void L.save();
        }}
      >
        <div className="l-trd-limits-head">
          <h2 id="l-trd-limits" className="l-label">
            <SlidersHorizontal size={12} strokeWidth={1.8} aria-hidden /> Agent limits
          </h2>
          <span className="l-micro">{m.limits.savedLabel}</span>
        </div>
        <div className="l-trd-fields">
          {m.limits.fields.map((f) => {
            const err = L.fieldError(f.key);
            return (
              <label key={f.key} className="l-trd-field" htmlFor={`l-trd-${f.key}`}>
                <span className="min-w-0 flex-1">
                  <span className="l-field-label">{f.label}</span>
                  <span className={err ? 'l-field-hint is-err' : 'l-field-hint'} role={err ? 'alert' : undefined}>
                    {err ?? f.hint}
                  </span>
                </span>
                <span className="l-trd-input" data-invalid={err ? '' : undefined}>
                  {f.unit === '$' && <span aria-hidden>$</span>}
                  <input
                    id={`l-trd-${f.key}`}
                    inputMode="decimal"
                    value={L.values[f.key] ?? ''}
                    placeholder="Not set"
                    aria-invalid={Boolean(err)}
                    disabled={m.readOnly}
                    title={m.readOnly ? (m.readOnlyReason ?? undefined) : `${f.min.toLocaleString('en-US')} to ${f.max.toLocaleString('en-US')}`}
                    onChange={(e) => L.setValue(f.key, e.target.value)}
                    onBlur={() => L.blur(f.key)}
                    className="l-input"
                  />
                  {f.unit === '%' && <span aria-hidden>%</span>}
                </span>
              </label>
            );
          })}
        </div>
        <div className="l-trd-autopilot">
          <span className="min-w-0 flex-1">
            <span className="l-field-label">Autopilot</span>
            <span className="l-field-hint">
              {ui.autopilot.on ? 'On: the Markets agent may place real orders inside these limits.' : 'Off: the daily run proposes and logs every order as a dry run; nothing reaches the broker.'}
            </span>
          </span>
          <LSwitch
            on={ui.autopilot.on}
            label="Autopilot"
            disabled={Boolean(ui.autopilot.reason) || ui.autopilot.switching}
            title={ui.autopilot.reason}
            onToggle={() => void ui.autopilot.setAutopilot(!ui.autopilot.on)}
          />
        </div>
        <div className="l-trd-save">
          {L.saveError && (
            <span role="alert" className="l-err-text">
              {L.saveError}
            </span>
          )}
          <Pressable type="submit" disabled={Boolean(L.saveReason) || L.saving} title={L.saveReason}>
            {L.saving ? 'Saving' : 'Save'}
          </Pressable>
        </div>
      </form>
    </section>
  );
}

/** The trading store itself is unreachable: the whole page says so, with Retry. */
export function TradingLegacyError({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div data-l="TradingLegacy" className="l-page">
      <SlabTitle eyebrow={EYEBROW} title="Trading" meta="the trading store could not be read" />
      <SlabCard title="The trading store is not reachable." i={1}>
        <LError message={message} onRetry={() => router.refresh()} />
      </SlabCard>
    </div>
  );
}
