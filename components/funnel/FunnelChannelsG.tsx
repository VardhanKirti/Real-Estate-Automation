'use client';

/**
 * F7 channel analytics under the GladOS style (pages/feature-additions.md):
 * one GCard, a GStackedBar per acquisition channel (lead only, booked,
 * converted) with GLegend toggles, and a GTable of leads, bookings and
 * revenue. The numbers come from lib/funnel-channels.ts on the server.
 */

import { useState } from 'react';
import { GCard, GEmpty, GLegend, GSampleBadge, GSectionHeader, GStackedBar, GTable, type GColumn, type StackKey } from '@/components/g';
import type { ChannelRow, ChannelsCard } from '@/lib/funnel-channels';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n: number) => n.toLocaleString('en-US');

const KEYS: StackKey[] = [
  { id: 'lead', label: 'Lead only', color: 'series-3' },
  { id: 'booked', label: 'Booked', color: 'series-2' },
  { id: 'converted', label: 'Converted', color: 'series-1' },
];

const COLUMNS: GColumn<ChannelRow>[] = [
  { key: 'channel', label: 'Channel', render: (r) => r.label, sortValue: (r) => r.label },
  { key: 'leads', label: 'Leads', numeric: true, render: (r) => num(r.leads), sortValue: (r) => r.leads },
  { key: 'bookings', label: 'Bookings', numeric: true, render: (r) => num(r.bookings), sortValue: (r) => r.bookings, title: 'Leads that booked a call or converted' },
  { key: 'revenue', label: 'Revenue', numeric: true, render: (r) => (r.revenueUsd > 0 ? usd(r.revenueUsd) : '—'), sortValue: (r) => r.revenueUsd },
];

export function FunnelChannelsG({ card }: { card: ChannelsCard }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const toggle = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const isolate = (id: string) => setHidden(KEYS.map((k) => k.id).filter((k) => k !== id));

  if (card.state === 'not_configured') {
    return (
      <GCard p={24} className="fn-g-channels" aria-labelledby="fn-g-channels">
        <GSectionHeader id="fn-g-channels" size={22} title="Channels" caption="Leads, bookings and revenue by first touch" />
        <GEmpty kind="unconfigured" title="Channel attribution needs Trakyo." body="Trakyo reports which post or ad brought each lead in." setupHref={card.setupHref} setupHint="Set TRAKYO_API_KEY" />
      </GCard>
    );
  }

  const { rows, total, attributed } = card.analytics;
  const caption = total === 0 ? 'Leads, bookings and revenue by first touch' : `${num(attributed)} of ${num(total)} leads attributed · by first touch`;
  return (
    <GCard p={24} className="fn-g-channels" aria-labelledby="fn-g-channels">
      <GSectionHeader
        id="fn-g-channels"
        size={22}
        title={<span className="fn-g-panel-title">Channels{card.sample && <GSampleBadge fixture="components/funnel/sample.ts" />}</span>}
        caption={caption}
      />
      {total === 0 ? (
        <GEmpty title="No leads yet." body="Each channel fills in as Trakyo attributes a new lead to the post or ad that brought it in." />
      ) : (
        <>
          <GLegend
            label="Show or hide a stage"
            items={KEYS.map((k) => ({ id: k.id, label: k.label, color: k.color ?? 'series-1', on: !hidden.includes(k.id) }))}
            onToggle={toggle}
            onIsolate={isolate}
            className="fn-g-channels-legend"
          />
          <GStackedBar
            label="Leads per acquisition channel, split by how far they got"
            keys={KEYS}
            hiddenKeys={hidden}
            columns={rows.map((r) => ({ id: r.id, label: r.label, parts: [r.leads - r.bookings, r.booked, r.converted] }))}
            height={150}
          />
          {attributed === 0 && <p className="fn-g-cap">No lead has matched a Trakyo first touch yet, so every lead is unattributed.</p>}
          <div className="fn-g-scroll" data-matrix-scroll=""><GTable columns={COLUMNS} rows={rows} rowKey={(r) => r.id} caption="Leads, bookings and revenue per channel" sort={null} sticky={false} /></div>
        </>
      )}
    </GCard>
  );
}
