'use client';

/**
 * Audience and DM history sheets under the GladOS style (glados-ui SPEC S03
 * F6). The old hand-rolled pop-outs become one GSheet (Escape, focus trap,
 * focus return), plotted over the page's range so the sheet and the page
 * never disagree. Series colours are the C19 slots, never brand hex.
 */

import { useEffect, useMemo, useState } from 'react';
import { GErrorLine, GLegend, GLineChart, GList, GRow, GSheet, GSkeleton, GDelta } from '@/components/g';
import type { VizColor } from '@/components/g';
import { dateAxis, forwardFill } from '@/lib/posting-activity';
import { channelsNetChange, netChange, rangeWindow, type RangePoint, type SocialRange } from '@/lib/social-range';
import { fmtDay, MAX_MARKS, rangePhrase } from '@/lib/social-view';
import { formatFull } from '@/lib/format-number';

type Series = { key: string; label: string; series: number; points: RangePoint[] };

const slot = (i: number): VizColor => (i >= 1 && i <= 6 ? (`series-${i}` as VizColor) : 'accent');

export function SeriesSheetG({ open, metric, range, today, onClose }: { open: boolean; metric: 'audience' | 'dms'; range: SocialRange; today: string; onClose: () => void }) {
  const [data, setData] = useState<Series[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [off, setOff] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    setOff([]);
    fetch(`/api/social/series?metric=${metric}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { series: Series[] }) => { if (!cancelled) setData(body.series ?? []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, metric]);

  const model = useMemo(() => {
    if (!data || data.length === 0) return null;
    const newest = data.reduce<string | null>((m, s) => { const d = s.points.at(-1)?.date ?? null; return d && (!m || d > m) ? d : m; }, null);
    const oldest = data.reduce<string | null>((m, s) => { const d = s.points[0]?.date ?? null; return d && (!m || d < m) ? d : m; }, null);
    const w = rangeWindow(range, newest, today, oldest);
    const full = dateAxis(w.start, w.end);
    const step = Math.max(1, Math.ceil(full.length / MAX_MARKS));
    const idx = full.map((_, i) => i).filter((i) => (full.length - 1 - i) % step === 0);
    const axis = idx.map((i) => full[i]);
    const channels = data.filter((s) => s.key !== 'all');
    const rows = data.map((s) => {
      const vals = forwardFill(s.points, full);
      const growth = s.key === 'all'
        ? channelsNetChange(channels.map((c) => c.points), range, today)
        : netChange(s.points, rangeWindow(range, s.points.at(-1)?.date ?? null, today, s.points[0]?.date ?? null));
      return { ...s, values: idx.map((i) => vals[i]), latest: s.points.at(-1)?.value ?? null, growth };
    });
    return { axis, rows };
  }, [data, range, today]);

  const title = metric === 'audience' ? 'Audience by channel' : 'Total DMs';
  const shown = model ? model.rows.filter((r) => !off.includes(r.key)) : [];

  return (
    <GSheet
      open={open}
      onClose={onClose}
      title={title}
      caption={`${rangePhrase(range)[0].toUpperCase()}${rangePhrase(range).slice(1)} · the page's range. ${metric === 'dms' ? 'DM totals are seeded until a DM source is wired.' : 'Email is the Beehiiv subscriber count.'}`}
      width={880}
    >
      {failed ? (
        <GErrorLine>Could not load the history.</GErrorLine>
      ) : !model ? (
        data === null ? <GSkeleton height={240} shape="well" /> : <GErrorLine>No history yet.</GErrorLine>
      ) : (
        <div className="soc-g-sheet">
          {model.rows.length > 1 && (
            <GLegend
              label="Show or hide a series"
              items={model.rows.map((r) => ({ id: r.key, label: r.label, color: slot(r.series), on: !off.includes(r.key) }))}
              onToggle={(id) => setOff((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))}
            />
          )}
          <GLineChart
            labels={model.axis.map(fmtDay)}
            series={shown.map((r) => ({ id: r.key, label: r.label, values: r.values, color: slot(r.series) }))}
            height={240}
            formatValue={formatFull}
            label={`${title} ${rangePhrase(range)}`}
            state={shown.length === 0 ? 'empty' : undefined}
            emptyText="Select a series to plot."
          />
          <GList divided label={`${title} latest values`}>
            {shown.map((r) => (
              <GRow
                key={r.key}
                leading={<i className="soc-g-swatch" style={{ background: `var(--g-${slot(r.series)})` }} aria-hidden />}
                title={r.label}
                trailing={
                  <span className="soc-g-row-trail">
                    <span className="soc-g-val">{r.latest == null ? '—' : formatFull(r.latest)}</span>
                    {r.growth ? <GDelta cur={r.growth.current} prev={r.growth.baseline} window={rangePhrase(range)} /> : <span className="soc-g-cap">—</span>}
                  </span>
                }
              />
            ))}
          </GList>
        </div>
      )}
    </GSheet>
  );
}
