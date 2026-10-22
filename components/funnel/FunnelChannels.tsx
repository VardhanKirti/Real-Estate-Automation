'use client';

/**
 * F7 channel analytics, Classic tree (and Bennett Legacy, which renders the
 * Classic tree under its skin): a bordered card with one stacked bar per
 * acquisition channel (lead only, booked, converted; chips toggle each part)
 * and a table of leads, bookings and revenue. Data: lib/funnel-channels.ts.
 */

import { useState } from 'react';
import { SetupLink } from '@/components/SetupLink';
import type { ChannelsCard } from '@/lib/funnel-channels';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n: number) => n.toLocaleString('en-US');

const PARTS = [
  { id: 'lead', label: 'Lead only', color: 'var(--fc-meter-crm)' },
  { id: 'booked', label: 'Booked', color: 'var(--fc-meter-ads)' },
  { id: 'converted', label: 'Converted', color: 'var(--fc-meter-organic)' },
] as const;
type PartId = (typeof PARTS)[number]['id'];

export function FunnelChannels({ card }: { card: ChannelsCard }) {
  const [hidden, setHidden] = useState<PartId[]>([]);
  const toggle = (id: PartId) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const head = (windowLabel: string) => (
    <div className="fc-card-head">
      <div className="fc-card-title">
        Channels<span className="fc-card-window">{windowLabel}</span>
      </div>
      {card.state === 'ready' && card.sample && (
        <span data-sample-badge="" className="fc-sample" title="Sample data: components/funnel/sample.ts">
          Sample
        </span>
      )}
    </div>
  );

  if (card.state === 'not_configured') {
    return (
      <div className="fc-card fc-c7 fc-feature" data-feature="funnel-channels">
        {head('Leads, bookings and revenue by first touch')}
        <div className="fc-feature-empty">
          <span className="fc-tag">Not configured</span>
          <p>Channel attribution needs Trakyo. It reports which post or ad brought each lead in.</p>
          <SetupLink href={card.setupHref} hint="Set TRAKYO_API_KEY" />
        </div>
      </div>
    );
  }

  const { rows, total, attributed } = card.analytics;
  const parts = (r: (typeof rows)[number]): Record<PartId, number> => ({ lead: r.leads - r.bookings, booked: r.booked, converted: r.converted });
  const shown = (r: (typeof rows)[number]) => PARTS.reduce((n, p) => n + (hidden.includes(p.id) ? 0 : parts(r)[p.id]), 0);
  const max = Math.max(1, ...rows.map(shown));

  return (
    <div className="fc-card fc-c7 fc-feature" data-feature="funnel-channels">
      {head(total === 0 ? 'Leads, bookings and revenue by first touch' : `${num(attributed)} of ${num(total)} leads attributed`)}
      {total === 0 ? (
        <div className="fc-feature-empty">
          <p>No leads yet. Each channel fills in as Trakyo attributes a new lead to the post or ad that brought it in.</p>
        </div>
      ) : (
        <>
          <div className="fc-chips fc-chips-flush" role="group" aria-label="Show or hide a stage">
            {PARTS.map((p) => (
              <button key={p.id} type="button" className={`fc-chip${hidden.includes(p.id) ? '' : ' on'}`} aria-pressed={!hidden.includes(p.id)} onClick={() => toggle(p.id)}>
                <span className="sw" style={{ ['--c' as string]: p.color }} /> {p.label}
              </button>
            ))}
          </div>
          <div className="fc-chan-bars">
            {rows.map((r) => {
              const v = parts(r);
              return (
                <div key={r.id} className="fc-chan-row" role="img" aria-label={`${r.label}: ${PARTS.map((p) => `${p.label} ${v[p.id]}`).join(', ')}`}>
                  <span className="fc-chan-lab">{r.label}</span>
                  <div className="fc-track fc-chan-track">
                    {PARTS.filter((p) => !hidden.includes(p.id) && v[p.id] > 0).map((p) => (
                      <i key={p.id} style={{ width: `${(v[p.id] / max) * 100}%`, background: p.color }} />
                    ))}
                  </div>
                  <span className="fc-chan-n">{num(shown(r))}</span>
                </div>
              );
            })}
          </div>
          {attributed === 0 && <p className="fc-sources">No lead has matched a Trakyo first touch yet, so every lead is unattributed.</p>}
          <div className="fc-feature-scroll">
            <table className="fc-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="r">Leads</th>
                  <th className="r" title="Leads that booked a call or converted">Bookings</th>
                  <th className="r">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row">
                    <td className="name">{r.label}</td>
                    <td className="r mono">{num(r.leads)}</td>
                    <td className="r mono">{num(r.bookings)}</td>
                    <td className="r mono">{r.revenueUsd > 0 ? usd(r.revenueUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
