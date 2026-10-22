'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { Newsletter } from '@/lib/newsletters';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)}%`;
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A labeled metric cell inside the expanded analytics grid. Status shows as
    a dot beside the label — the numeral itself stays neutral (Console rule). */
function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className="rounded-sm-t border border-os-border bg-os-bg px-3 py-3.5">
      <div className="flex items-center gap-2 text-[12px] text-os-muted">
        {tone && <span className={`dot ${tone}`} />}
        {label}
      </div>
      <div className="mt-1 text-[20px] font-normal leading-none tracking-[-0.01em] tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-os-dim">{sub}</div>}
    </div>
  );
}

/**
 * The expandable newsletter list: each past send is a row showing its open
 * rate and audience collapsed; clicking it unfolds the full send analytics
 * (delivery, opens, clicks, unsubscribes, spam, web). Newest first.
 */
export function NewsletterList({ newsletters }: { newsletters: Newsletter[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (newsletters.length === 0) {
    return <p className="rounded-lg-t border border-os-border bg-os-surface px-5 py-6 text-center text-[12.5px] text-os-dim">No newsletters yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {newsletters.map((n) => {
        const expanded = openId === n.id;
        return (
          <div key={n.id} className="overflow-hidden rounded-lg-t border border-os-border bg-os-surface">
            <button
              onClick={() => setOpenId(expanded ? null : n.id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-os-surface2"
            >
              <span className="shrink-0 text-os-dim">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{n.title}</span>
                <span className="mt-0.5 block text-[12px] text-os-dim">
                  {dateLabel(n.publishedAt)} · {fmt(n.recipients)} sent
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[20px] font-normal leading-none tracking-[-0.01em] tabular-nums">
                  {pct(n.openRate)}
                </span>
                <span className="mt-0.5 block text-[11px] text-os-dim">open rate</span>
              </span>
            </button>

            {expanded && (
              <div className="border-t border-os-border px-4 pb-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  <Metric label="Recipients" value={fmt(n.recipients)} />
                  <Metric label="Delivered" value={fmt(n.delivered)} sub={pct(n.deliveryRate) + ' delivery'} tone="ok" />
                  <Metric label="Open rate" value={pct(n.openRate)} sub={fmt(n.opens) + ' opens'} tone="ok" />
                  <Metric label="Click rate" value={pct(n.clickRate)} sub={fmt(n.clicks) + ' clicks'} />
                  <Metric label="Unsubscribes" value={fmt(n.unsubscribes)} sub={pct(n.unsubscribeRate)} tone={n.unsubscribeRate > 1 ? 'warn' : undefined} />
                  <Metric label="Spam reports" value={fmt(n.spamReports)} tone={n.spamReports > 0 ? 'warn' : undefined} />
                  <Metric label="Web views" value={fmt(n.webViews)} />
                  <Metric label="Delivered %" value={pct(n.deliveryRate)} />
                </div>
                {n.webUrl && (
                  <a href={n.webUrl} target="_blank" rel="noreferrer" className="c-btn mt-4">
                    Read the issue <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
