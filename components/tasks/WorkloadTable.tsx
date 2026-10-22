'use client';

import { useMemo, useState } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';
import type { WorkloadRow } from '@/lib/tasks-metrics';

/**
 * The reference's "Workload overview" (docs/TASKS-REDESIGN.md §5.5), by agent
 * rather than by person. Load level is banded against the fleet's own median
 * open load, so the pill means "busy for this fleet".
 */
const LOAD_STYLE: Record<WorkloadRow['load'], string> = {
  low: 'border-[var(--ramp-1)] text-[var(--ramp-1-ink,var(--ramp-1))]',
  medium: 'border-[var(--warn)] text-[var(--warn)]',
  high: 'border-[var(--err)] text-[var(--err)]',
};

type SortKey = 'name' | 'assigned' | 'completed' | 'ongoing' | 'pending';

export function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'assigned', dir: -1 });
  const [openOnly, setOpenOnly] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!needle || r.name.toLowerCase().includes(needle) || r.department.toLowerCase().includes(needle)) &&
        (!openOnly || r.ongoing + r.pending > 0),
    );
    return [...filtered].sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
      return (a[sort.key] - b[sort.key]) * sort.dir;
    });
  }, [rows, q, sort, openOnly]);

  const head = (key: SortKey, label: string, numeric = true) => (
    <th
      className={`cursor-pointer px-3 py-2 font-normal text-os-dim transition-colors hover:text-os-muted ${
        numeric ? 'text-right' : 'text-left'
      }`}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))}
    >
      <span className={`inline-flex items-center gap-1 ${numeric ? 'flex-row-reverse' : ''}`}>
        {label}
        {sort.key === key && <ArrowUpDown className="h-3 w-3" strokeWidth={1.6} />}
      </span>
    </th>
  );

  return (
    <div className="glass-panel flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <div className="text-[13.5px] font-medium">Workload overview</div>
          <div className="mt-0.5 text-[12px] text-os-dim">Where the work sits, and which agents are carrying it.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md-t border border-os-border bg-os-surface2 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-os-dim" strokeWidth={1.6} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search here"
              className="w-[140px] bg-transparent text-[12px] text-os-text outline-none placeholder:text-os-dim"
            />
          </div>
          <button
            onClick={() => setOpenOnly((v) => !v)}
            aria-pressed={openOnly}
            title="Show only agents with open work"
            className={`flex items-center gap-1.5 rounded-md-t border px-2.5 py-1.5 text-[12px] transition-colors ${
              openOnly
                ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-text'
                : 'border-os-border bg-os-surface2 text-os-muted hover:bg-os-surface3'
            }`}
          >
            Open only
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="border-y border-os-border text-[11.5px]">
            <tr>
              {head('name', 'Name', false)}
              {head('assigned', 'Assigned')}
              {head('completed', 'Completed')}
              {head('ongoing', 'On going')}
              {head('pending', 'Pending')}
              <th className="px-3 py-2 text-left font-normal text-os-dim">Department</th>
              <th className="px-3 py-2 text-left font-normal text-os-dim">Load level</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.agentId} className="border-b border-os-border transition-colors last:border-0 hover:bg-os-surface2">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.departmentColor }} />
                    <span className="truncate text-os-text">{r.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-os-muted">{r.assigned}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-os-muted">{r.completed}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-os-muted">{r.ongoing}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-os-muted">{r.pending}</td>
                <td className="px-3 py-2.5 text-os-dim">{r.department}</td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${LOAD_STYLE[r.load]}`}>
                    {r.load}
                  </span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[12.5px] text-os-dim">
                  {rows.length === 0 ? 'No agent holds a task yet.' : 'No agent matches that filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
