'use client';

/**
 * /trading under the GladOS style (pages/trading.md §6). Renders the model
 * from lib/trading-page.ts with G kit parts only; behaviour lives in
 * use-trading.ts so every tree acts the same. Monitor only: no control here
 * places an order (T13).
 */
import { Copy, RefreshCw } from 'lucide-react';
import {
  GAreaChart, GBarChart, GButton, GCard, GDelta, GDialog, GDriverBars, GEmpty, GErrorLine, GField, GHeroCard, GInput, GKeyValue, GList, GPage, GRow,
  GSampleBadge, GSectionHeader, GSegmented, GSheet, GSparkline, GStat, GTable, GTag, GToggle, GWell, type GColumn, type GTagTone,
} from '@/components/g';
import {
  ago, day, logRows, usdCompact, qty, signedUsd, stamp, toneOf, tradeLine, usd, whoOf, type ActivityFilter, type TradingModel,
} from '@/lib/trading-model';
import type { TradeActivity, TradingOrder, TradingPosition } from '@/lib/schemas';
import { useTrading, type TradingUi } from './use-trading';

export type TradingTreeProps = { model: TradingModel; pushPath: string; setup: { robinhood: string; phantom: string } };

const statusTone: Record<TradeActivity['status'], GTagTone> = { filled: 'ok', pending: 'neutral', cancelled: 'outline', rejected: 'err' };
const statusLabel: Record<TradeActivity['status'], string> = { filled: 'Filled', pending: 'Pending', cancelled: 'Cancelled', rejected: 'Rejected' };
const verdictTone = (v: string): GTagTone => (/buy|enter|long|take/i.test(v) ? 'ok' : /sell|exit|trim/i.test(v) ? 'warn' : /watch|hold/i.test(v) ? 'neutral' : 'outline');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** P&L in ok / err (never a bordered pill), sans tabular. */
function Pnl({ n, cents = true }: { n: number | null; cents?: boolean }) {
  if (n === null) return <span className="trd-g-pnl">—</span>;
  return (
    <span className="trd-g-pnl" data-tone={toneOf(n)}>
      {signedUsd(n, cents)}
    </span>
  );
}

export function TradingG({ model, pushPath, setup }: TradingTreeProps) {
  const ui = useTrading(model, pushPath);
  const m = model;
  const p = m.payload;

  const headerAction = (
    <div className="trd-g-head-actions">
      {m.fixture && <GSampleBadge fixture={m.fixture} />}
      {m.feedPill ? (
        <GTag tone={m.feedPill.tone} dot title={m.feedPill.title}>
          {m.feedPill.text}
        </GTag>
      ) : (
        <SourceTag label="Robinhood feed" href={setup.robinhood} hint="Have the Markets agent push to /api/trading/snapshot with TRADING_PUSH_TOKEN" />
      )}
      {m.wallet === 'unconfigured' && <SourceTag label="Phantom wallet" href={setup.phantom} hint="Set PHANTOM_WALLET_ADDRESS (a public address, not a key)" />}
      {!m.unconfigured && (
        <GButton onClick={ui.refresh} busy={ui.refreshing} title="Reload from the store; the wallet read is cached 60 s">
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
          Refresh
        </GButton>
      )}
    </div>
  );

  return (
    <GPage className="trd-g">
      <GSectionHeader size="page" title="Trading" caption={m.subtitle ?? m.copy.subtitleEmpty} action={headerAction} />

      {m.unconfigured ? (
        <ConnectCard ui={ui} setupHref={setup.robinhood} />
      ) : (
        <>
          <div className="trd-g-top">
            <Hero m={m} />
            {m.feed === 'none' ? <ConnectCard ui={ui} setupHref={setup.robinhood} /> : <Sleeve m={m} ui={ui} />}
          </div>

          <div className="trd-g-mid">
            <Accounts m={m} setupPhantom={setup.phantom} />
            {m.feed !== 'none' && <Positions m={m} ui={ui} />}
            {m.feed !== 'none' && <Reasoning m={m} ui={ui} />}
          </div>

          {m.feed !== 'none' && <TradeLog m={m} ui={ui} />}

          <div className="trd-g-bottom">
            {m.feed !== 'none' && <OpenOrders orders={p.openOrders} now={m.now} />}
            <Limits m={m} ui={ui} />
          </div>

          <p className="trd-g-foot">Only the agentic sleeve can be traded by an agent. Wallet read from a public RPC.</p>
        </>
      )}

      <TradeSheet trade={ui.openTrade} onClose={() => ui.setOpenTrade(null)} />
      <GSheet open={ui.positionsOpen} onClose={() => ui.setPositionsOpen(false)} title="Positions" caption={`${p.positions.length} open · ${usd(m.investedUsd)} invested`} width={760}>
        <PositionsTable rows={p.positions} />
      </GSheet>
      <GSheet open={ui.notesOpen} onClose={() => ui.setNotesOpen(false)} title="Agent reasoning" caption={p.analysis ? `${p.analysis.agent} · ${stamp(p.analysis.at)}` : undefined} width={640}>
        <p className="trd-g-notes-full">{p.analysis?.notes}</p>
      </GSheet>
      <GDialog
        open={ui.autopilot.confirmOpen}
        onClose={() => ui.autopilot.setConfirmOpen(false)}
        title="Turn on autopilot?"
        confirmLabel="Turn on"
        busy={ui.autopilot.switching}
        onConfirm={() => ui.autopilot.setAutopilot(true, true)}
      >
        {m.copy.autopilotBody}
      </GDialog>
    </GPage>
  );
}

function SourceTag({ label, href, hint }: { label: string; href: string; hint: string }) {
  return (
    <span className="trd-g-source" title={hint}>
      <GTag tone="outline">{label} · Not configured</GTag>
      <GButton variant="sm" href={href} title={hint}>
        Set up
      </GButton>
    </span>
  );
}

function ConnectCard({ ui, setupHref }: { ui: TradingUi; setupHref: string }) {
  return (
    <GCard p={24} className="trd-g-connect" aria-label="Connect the Markets agent feed">
      <GEmpty
        kind="unconfigured"
        title="Connect the Markets agent feed. Its first push fills this page."
        body="The agent posts account snapshots, positions and trades with its push token. The token stays in the agent; only the URL goes here."
        setupHref={setupHref}
        setupHint="TRADING_PUSH_TOKEN"
      />
      <GWell className="trd-g-push">
        <code className="trd-g-push-url" data-copy="">
          {ui.pushUrl}
        </code>
        <GButton variant="sm" onClick={ui.copyPushUrl} aria-label="Copy push URL">
          <Copy size={13} strokeWidth={1.75} aria-hidden />
          Copy
        </GButton>
      </GWell>
    </GCard>
  );
}

function Hero({ m }: { m: TradingModel }) {
  const status =
    m.dayPnlUsd === null ? (
      m.wallet === 'ok' ? 'Wallet only' : undefined
    ) : (
      <>
        {signedUsd(m.dayPnlUsd, false)} today
        {m.investedFrac !== null && <> · {Math.round(m.investedFrac * 100)}% invested</>}
      </>
    );
  return (
    <GHeroCard
      variant="a"
      className="trd-g-hero"
      caption="Total value"
      value={m.totalUsd === null ? null : usd(m.totalUsd)}
      label={m.totalUsd === null ? 'Total value unknown' : `Total value ${usd(m.totalUsd)}`}
      title="Brokerage accounts from the newest push, plus the Phantom wallet when priced"
      status={status}
      strip={<GSparkline values={m.totalHistory} label={`Total value · ${m.totalHistory.length} captures · Markets agent feed`} onHero />}
    />
  );
}

function Sleeve({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const p = m.payload;
  const s = m.series.find((x) => x.accountId === ui.acct) ?? m.series[0];
  const pts = s?.points ?? [];
  const agent = p.view.agent;
  const caption = agent.hasActed
    ? `${agent.tradeCount} ${agent.tradeCount === 1 ? 'trade' : 'trades'} · last ${agent.lastTrade ? ago(agent.lastTrade.at, m.now) : ''}`
    : 'The agent has not traded yet';
  return (
    <GCard p={24} className="trd-g-sleeve" aria-labelledby="trd-g-sleeve">
      <GSectionHeader
        id="trd-g-sleeve"
        size={22}
        title="Agent sleeve"
        caption={caption}
        action={
          m.series.length > 1 ? (
            <GSegmented
              label="Account shown in the chart"
              value={ui.acct ?? ''}
              onChange={ui.setAcct}
              options={m.series.map((x) => ({ value: x.accountId, label: x.label }))}
            />
          ) : undefined
        }
      />
      <div className="trd-g-chart">
        <GAreaChart
          labels={pts.map((x) => stamp(x.at))}
          axisLabels={pts.map((x) => day(x.at))}
          series={[{ id: s?.accountId ?? 'none', label: s?.label ?? 'Account', values: pts.map((x) => x.valueUsd), color: 'series-1' }]}
          formatValue={usdCompact}
          zeroBase={false}
          height={180}
          tip={(i) => ({ title: stamp(pts[i].at), lines: [`${s?.label}: ${usd(pts[i].valueUsd, true)}`] })}
          label={`${s?.label ?? 'Account'} value per capture, ${pts.length} captures, Markets agent feed`}
          emptyText="No captures for this account yet."
        />
      </div>
      {m.hasAgentic ? (
        <div className="trd-g-stats">
          <GStat value={usd(agent.deployedUsd, true)} label="Deployed" source="Market value of the agentic sleeve's positions" />
          <GStat value={agent.idleCashUsd === null ? null : usd(agent.idleCashUsd, true)} label="Idle cash" source="Cash in the agentic sleeve, newest push" />
          <div className="trd-g-stat-tone" data-tone={toneOf(agent.unrealizedPnlUsd)}>
            <GStat value={signedUsd(agent.unrealizedPnlUsd)} label="Unrealized" source="Unrealized P&L across the agentic sleeve's positions" />
          </div>
          <GStat value={`${agent.tradeCount} filled`} label="Agent trades" source="Filled orders the agent placed in the sleeve" />
        </div>
      ) : (
        <GEmpty inline title="No agentic account in the feed." body="The agent's stats appear once a push carries the account with id agentic." />
      )}
    </GCard>
  );
}

function Accounts({ m, setupPhantom }: { m: TradingModel; setupPhantom: string }) {
  const brokerage = m.accounts.filter((a) => a.kind === 'brokerage');
  const wallet = m.accounts.find((a) => a.kind === 'wallet');
  const rows = m.accounts
    .filter((a) => a.valueUsd !== null)
    .map((a) => ({
      id: a.id,
      label: a.label,
      value: a.valueUsd ?? 0,
      display: usd(a.valueUsd ?? 0),
      title: `${a.label} · ${a.note} · ${Math.round(a.frac * 100)}% of the total`,
      tone: a.agentMayTrade ? undefined : ('soft' as const),
    }));
  const cash = brokerage.reduce((s, a) => s + (a.cashUsd ?? 0), 0);
  const bp = brokerage.reduce((s, a) => s + (a.buyingPowerUsd ?? 0), 0);
  const totalPnl = m.payload.accounts.reduce((s, a) => s + a.totalPnlUsd, 0);
  return (
    <GCard p={24} className="trd-g-accounts" aria-labelledby="trd-g-accounts">
      <GSectionHeader id="trd-g-accounts" size={22} title="Accounts" caption={`${m.accounts.length} ${m.accounts.length === 1 ? 'source' : 'sources'}`} />
      {rows.length > 0 && <GDriverBars rows={rows} labelWidth={84} label="Value per account" />}
      <GList divided label="Account notes">
        {m.accounts.map((a) => (
          <GRow
            key={a.id}
            title={a.label}
            meta={a.note}
            hint={a.error}
            trailing={a.kind === 'wallet' && a.valueUsd === null ? <GTag tone="warn" title={a.error}>Not reachable</GTag> : <GDelta cur={a.valueUsd} prev={a.dayPnlUsd === null || a.valueUsd === null ? null : a.valueUsd - a.dayPnlUsd} money window="today" />}
          />
        ))}
        {!wallet && (
          <GRow
            title="Phantom"
            meta="Solana wallet, read from a public address"
            trailing={
              <GButton variant="sm" href={setupPhantom} title="Set PHANTOM_WALLET_ADDRESS">
                Set up
              </GButton>
            }
          />
        )}
      </GList>
      {brokerage.length > 0 && (
        <GKeyValue
          className="trd-g-kv"
          items={[
            { label: 'Cash', value: usd(cash, true) },
            { label: 'Buying power', value: usd(bp, true) },
            { label: 'Total P&L', value: <Pnl n={totalPnl} /> },
          ]}
        />
      )}
    </GCard>
  );
}

function PositionsTable({ rows }: { rows: TradingPosition[] }) {
  const cols: GColumn<TradingPosition>[] = [
    { key: 'symbol', label: 'Symbol', render: (r) => <span className="trd-g-sym">{r.symbol}</span>, sortValue: (r) => r.symbol },
    { key: 'acct', label: 'Account', render: (r) => (r.accountId === 'agentic' ? 'Agentic' : cap(r.accountId)), sortValue: (r) => r.accountId },
    { key: 'qty', label: 'Qty', align: 'right', numeric: true, render: (r) => qty(r.quantity), sortValue: (r) => r.quantity },
    { key: 'value', label: 'Value', align: 'right', numeric: true, render: (r) => usd(r.marketValueUsd, true), sortValue: (r) => r.marketValueUsd },
    { key: 'pnl', label: 'P&L', align: 'right', numeric: true, render: (r) => <Pnl n={r.unrealizedPnlUsd} />, sortValue: (r) => r.unrealizedPnlUsd },
  ];
  return <GTable columns={cols} rows={rows} rowKey={(r) => `${r.accountId}:${r.symbol}`} caption="Open positions, largest first" sticky={false} empty="No open positions." />;
}

function Positions({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const pos = m.payload.positions;
  const top = pos.slice(0, 6);
  const sizes = m.payload.view.sizes;
  const biggest = sizes.reduce((a, b) => (b.count > a.count ? b : a), sizes[0]);
  return (
    <GCard p={24} className="trd-g-positions" aria-labelledby="trd-g-positions">
      <GSectionHeader
        id="trd-g-positions"
        size={22}
        title="Positions"
        caption={pos.length ? `${pos.length} open · ${usd(m.investedUsd)} invested` : 'Nothing held'}
        action={
          pos.length > top.length ? (
            <GButton variant="sm" onClick={() => ui.setPositionsOpen(true)}>
              See all {pos.length}
            </GButton>
          ) : undefined
        }
      />
      {pos.length === 0 ? (
        <GEmpty inline title="No open positions." body="Holdings appear with the next push that carries them." />
      ) : (
        <>
          <div className="trd-g-buckets">
            <GBarChart
              variant="series"
              bars={sizes.map((b) => ({ id: b.label, label: b.label, value: b.count, tip: { title: b.label, lines: [`${b.count} ${b.count === 1 ? 'position' : 'positions'}`] } }))}
              highlight={biggest.count > 0 ? biggest.label : null}
              height={64}
              formatValue={(v) => String(v)}
              label="Positions by size: under $50, $50 to $250, $250 to $1k, over $1k"
            />
          </div>
          <div className="trd-g-pos-table">
            <PositionsTable rows={top} />
          </div>
          <GList divided className="trd-g-pos-list" label="Largest positions">
            {top.map((r) => (
              <GRow
                key={`${r.accountId}:${r.symbol}`}
                title={r.symbol}
                meta={`${qty(r.quantity)} @ ${usd(r.avgCostUsd, true)} · ${r.accountId === 'agentic' ? 'Agentic' : cap(r.accountId)}`}
                trailing={
                  <span className="trd-g-stack">
                    <span>{usd(r.marketValueUsd, true)}</span>
                    <Pnl n={r.unrealizedPnlUsd} />
                  </span>
                }
              />
            ))}
          </GList>
        </>
      )}
    </GCard>
  );
}

function Reasoning({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const a = m.payload.analysis;
  return (
    <GCard p={24} className="trd-g-reasoning" aria-labelledby="trd-g-reasoning">
      <GSectionHeader
        id="trd-g-reasoning"
        size={22}
        title="Agent reasoning"
        caption={a ? `Examined ${a.examined} · ${a.signals} ${a.signals === 1 ? 'signal' : 'signals'} · ${ago(a.at, m.now)}` : 'No run recorded'}
      />
      {!a ? (
        <GEmpty inline title="No analysis pushed yet." body="The agent writes here every run, whether or not it trades." />
      ) : (
        <>
          {a.notes && (
            <div className="trd-g-notes">
              <p>{a.notes}</p>
              {a.notes.length > 140 && (
                <GButton variant="sm" onClick={() => ui.setNotesOpen(true)}>
                  More
                </GButton>
              )}
            </div>
          )}
          {a.rows.length > 0 ? (
            <GList divided label="Names the agent examined">
              {a.rows.slice(0, 6).map((r) => (
                <GRow
                  key={r.ticker}
                  title={<span className="trd-g-sym">{r.ticker}</span>}
                  meta={r.reason}
                  hint={r.score === null ? 'Not scored' : `Score ${r.score.toFixed(2)}`}
                  trailing={<GTag tone={verdictTone(r.verdict)}>{cap(r.verdict)}</GTag>}
                />
              ))}
            </GList>
          ) : (
            <GEmpty inline title="The run listed no names." />
          )}
        </>
      )}
    </GCard>
  );
}

function TradeLog({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const c = m.payload.view.activityCounts;
  const rows = logRows(m, ui.log);
  const opts: { value: ActivityFilter; label: string }[] = [
    { value: 'all', label: `All ${c.all}` },
    { value: 'agent', label: `Agent ${c.agent}` },
    { value: 'you', label: `You ${c.you}` },
    { value: 'rejected', label: `Rejected ${c.rejected}` },
  ];
  return (
    <GCard p={24} className="trd-g-log" aria-labelledby="trd-g-log">
      <GSectionHeader
        id="trd-g-log"
        size={22}
        title="Trade log"
        caption={c.all ? `${rows.length} of ${c.all}` : undefined}
        action={c.all ? <GSegmented label="Filter the trade log" value={ui.log} onChange={ui.setLog} options={opts} className="trd-g-logseg" /> : undefined}
      />
      {c.all === 0 ? (
        <GEmpty inline title="No trades yet." body="Every order the agent or you place in a fed account lands here with its rationale." />
      ) : rows.length === 0 ? (
        <GEmpty inline title="Nothing matches this filter." />
      ) : (
        <GList divided label="Trades, newest first">
          {rows.map((t) => (
            <GRow
              key={t.id}
              onClick={() => ui.setOpenTrade(t)}
              leading={<GTag tone={t.action === 'buy' ? 'ok' : 'warn'}>{t.action === 'buy' ? 'Buy' : 'Sell'}</GTag>}
              title={
                <span className="trd-g-trade-title">
                  <span className="trd-g-sym">
                    <span className="trd-g-act" data-side={t.action}>{t.action === 'buy' ? 'Buy ' : 'Sell '}</span>
                    {tradeLine(t)}
                  </span>
                  <GTag tone={statusTone[t.status]} size="xs">
                    {statusLabel[t.status]}
                  </GTag>
                </span>
              }
              meta={t.rationale || 'No rationale given'}
              trailing={
                <span className="trd-g-stack trd-g-who">
                  <span>{whoOf(t)}</span>
                  <span className="trd-g-muted">{ago(t.at, m.now)}</span>
                </span>
              }
            />
          ))}
        </GList>
      )}
    </GCard>
  );
}

function TradeSheet({ trade: t, onClose }: { trade: TradeActivity | null; onClose: () => void }) {
  return (
    <GSheet open={t !== null} onClose={onClose} title={t ? `${t.action === 'buy' ? 'Buy' : 'Sell'} ${t.symbol}` : ''} caption={t ? stamp(t.at) : undefined} width={560}>
      {t && (
        <div className="trd-g-sheet">
          <GKeyValue
            items={[
              { label: 'Order', value: tradeLine(t) },
              { label: 'Notional', value: usd(t.quantity * t.priceUsd, true) },
              { label: 'Status', value: <GTag tone={statusTone[t.status]}>{statusLabel[t.status]}</GTag> },
              { label: 'Who', value: whoOf(t) },
              { label: 'Account', value: t.accountId === 'agentic' ? 'Agentic sleeve' : cap(t.accountId) },
            ]}
          />
          <GWell>
            <p className="trd-g-rationale">{t.rationale || 'No rationale given.'}</p>
          </GWell>
        </div>
      )}
    </GSheet>
  );
}

function OpenOrders({ orders, now }: { orders: TradingOrder[]; now: number }) {
  return (
    <GCard p={24} className="trd-g-orders" aria-labelledby="trd-g-orders">
      <GSectionHeader id="trd-g-orders" size={22} title="Open orders" caption={orders.length ? `${orders.length} working` : 'Nothing working'} />
      {orders.length === 0 ? (
        <GEmpty inline title="No live orders at the broker." />
      ) : (
        <GList divided label="Working orders">
          {orders.map((o) => (
            <GRow
              key={o.id}
              leading={<GTag tone={o.side === 'buy' ? 'ok' : 'warn'}>{o.side === 'buy' ? 'Buy' : 'Sell'}</GTag>}
              title={
                <span className="trd-g-sym">
                  {o.symbol} {o.dollarAmountUsd !== null ? usd(o.dollarAmountUsd, true) : `${qty(o.quantity)}${o.limitPriceUsd !== null ? ` @ ${usd(o.limitPriceUsd, true)}` : ''}`}
                </span>
              }
              meta={`${cap(o.type)} · ${o.filledQuantity ? `${qty(o.filledQuantity)} filled · ` : ''}${o.placedAgent || 'Unknown'} · ${ago(o.createdAt, now)}`}
              trailing={<GTag>{cap(o.state)}</GTag>}
            />
          ))}
        </GList>
      )}
    </GCard>
  );
}

function Limits({ m, ui }: { m: TradingModel; ui: TradingUi }) {
  const L = ui.limits;
  return (
    <GCard p={24} className="trd-g-limits" aria-labelledby="trd-g-limits">
      <GSectionHeader id="trd-g-limits" size={22} title="Agent limits" caption={m.limits.savedLabel} />
      <form
        className="trd-g-limits-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void L.save();
        }}
      >
        <div className="trd-g-fields">
          {m.limits.fields.map((f) => (
            <GField key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label} hint={f.hint} error={L.fieldError(f.key)} htmlFor={`trd-g-${f.key}`}>
              <GInput
                id={`trd-g-${f.key}`}
                inputMode="decimal"
                value={L.values[f.key] ?? ''}
                placeholder="Not set"
                invalid={Boolean(L.fieldError(f.key))}
                disabled={m.readOnly}
                title={m.readOnly ? (m.readOnlyReason ?? undefined) : `${f.min.toLocaleString('en-US')} to ${f.max.toLocaleString('en-US')}`}
                onChange={(e) => L.setValue(f.key, e.target.value)}
                onBlur={() => L.blur(f.key)}
              />
            </GField>
          ))}
        </div>
        <div className="trd-g-autopilot">
          <GToggle
            checked={ui.autopilot.on}
            onCheckedChange={(next) => void ui.autopilot.setAutopilot(next)}
            disabled={Boolean(ui.autopilot.reason) || ui.autopilot.switching}
            disabledReason={ui.autopilot.reason}
            aria-label="Autopilot"
          >
            Autopilot
          </GToggle>
          <p className="trd-g-muted">
            {ui.autopilot.on
              ? 'On: the Markets agent may place real orders inside these limits.'
              : 'Off: the daily run proposes and logs every order as a dry run; nothing reaches the broker.'}
          </p>
        </div>
        {L.saveError && (
          <GErrorLine align="left">{L.saveError}</GErrorLine>
        )}
        <div className="trd-g-save">
          <GButton variant="ink" type="submit" busy={L.saving} disabled={Boolean(L.saveReason)} disabledReason={L.saveReason}>
            Save
          </GButton>
        </div>
      </form>
    </GCard>
  );
}
