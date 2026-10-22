'use client';

import { ArrowRight, Inbox } from 'lucide-react';
import type { Chart, StatCard } from '@/lib/inbox-stats';
import { Mono } from './bits';

/**
 * The report row above the inbox columns. Structure follows the reference
 * dashboard — mono label, oversized figure, delta stacked to its right, a
 * chart filling the lower half — in the GladOS palette rather than the
 * reference's white cards.
 *
 * Every bar is one real thing (a conversation, a channel, a day) and each
 * chart says which in its caption, so the shape is readable rather than
 * decorative. A delta renders only where real history exists.
 */

function Bars({ chart }: { chart: Extract<Chart, { kind: 'bars' }> }) {
  const peak = Math.max(1, ...chart.bars.map((b) => b.value));
  return (
    <div className="ib-w-plot">
      <div className="ib-w-bars" role="img" aria-label={chart.bars.map((b) => b.label).join('; ')}>
        {chart.bars.map((b, i) => (
          <i
            key={i}
            title={b.label}
            data-tone={b.value > 0 ? chart.tone : 'off'}
            style={{ height: `${b.value > 0 ? Math.max(9, (b.value / peak) * 100) : 4}%` }}
          />
        ))}
      </div>
      <Mono className="ib-w-cap">{chart.caption}</Mono>
    </div>
  );
}

function Cells({ chart }: { chart: Extract<Chart, { kind: 'cells' }> }) {
  return (
    <div className="ib-w-plot">
      <div className="ib-w-cells" role="img" aria-label={chart.cells.map((c) => c.label).join('; ')}>
        {chart.cells.map((c, i) => (
          <i key={i} title={c.label} data-tone={c.on ? chart.tone : 'off'} />
        ))}
      </div>
      <Mono className="ib-w-cap">{chart.caption}</Mono>
    </div>
  );
}

function Card({ card }: { card: StatCard }) {
  return (
    <article className="ib-w-card">
      <Mono className="ib-w-label">{card.label}</Mono>
      <div className="ib-w-figure">
        <span className="ib-w-value">{card.value}</span>
        {card.unit && <span className="ib-w-unit">{card.unit}</span>}
        {card.delta && (
          <span className="ib-w-delta" data-dir={card.delta.dir}>
            <Mono className="ib-w-delta-v">{card.delta.text}</Mono>
            <span className="ib-w-delta-n">{card.delta.note}</span>
          </span>
        )}
      </div>
      {card.sub && <p className="ib-w-sub">{card.sub}</p>}
      {card.chart.kind === 'bars' ? <Bars chart={card.chart} /> : <Cells chart={card.chart} />}
    </article>
  );
}

export function InboxWidgets({
  cards,
  replyCount,
  onOpenTriage,
}: {
  cards: StatCard[];
  replyCount: number;
  onOpenTriage: () => void;
}) {
  return (
    <section className="ib-widgets" aria-label="Comms report">
      <Card card={cards[0]} />
      <article className="ib-w-card is-accent">
        <span className="ib-w-chip">
          <Inbox strokeWidth={1.8} />
        </span>
        <h2 className="ib-w-accent-h">
          {replyCount === 0
            ? 'Nothing waiting on you'
            : `${replyCount} thread${replyCount === 1 ? '' : 's'} waiting on you`}
        </h2>
        <p className="ib-w-accent-p">
          {replyCount === 0
            ? 'Every thread here is read or already answered.'
            : 'Questions asked of you, and conversations with unread messages.'}
        </p>
        <button className="ib-w-accent-btn" onClick={onOpenTriage} disabled={replyCount === 0}>
          Open triage <ArrowRight strokeWidth={2} />
        </button>
      </article>
      {cards.slice(1).map((c) => (
        <Card key={c.id} card={c} />
      ))}
    </section>
  );
}
