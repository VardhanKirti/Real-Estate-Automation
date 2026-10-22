'use client';

import { Activity, Info } from 'lucide-react';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import { relativeTime } from '@/lib/wizard/helpers';
import { departmentIcon, percent, RUN_DOTS } from '@/lib/wizard/ui';

/**
 * Agent performance — real run history only. The two dot rows are the last
 * 48 runs (oldest left, newest right); the percentage is ok runs over runs.
 * Agents with no runs show "—" and empty dots. Designed agents are ghosts.
 */
export function CrewPanel({ crew, now }: { crew: CrewSnapshot; now: number }) {
  const rows = [...crew.rows].sort((a, b) => b.runs.length - a.runs.length || a.agent.name.localeCompare(b.agent.name));
  return (
    <div className="wz-panel flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-os-hairline px-4 py-3">
        <div className="flex items-center gap-2 whitespace-nowrap text-[13.5px] text-os-text">
          <Activity className="h-4 w-4 text-os-muted" strokeWidth={2} />
          Agent performance
          <span title={`Last ${RUN_DOTS} runs per agent within ${crew.windowDays} days. Percent = runs that succeeded.`} className="text-os-dim">
            <Info className="h-3.5 w-3.5" />
          </span>
        </div>
        {/* every run figure states its window (F0.2, H30) */}
        <div className="text-right text-[11.5px] text-os-dim tabular-nums">
          <span className="whitespace-nowrap"><span className="text-os-muted">{crew.totalRuns}</span> runs · {crew.windowDays} days</span> · <span className="whitespace-nowrap"><span className="text-os-muted">{percent(crew.okRate)}</span> ok</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {rows.map(({ agent, runs, okRate }) => {
          const Icon = departmentIcon(agent.departmentId);
          const ordered = [...runs].reverse(); // oldest → newest
          const dots = Array.from({ length: RUN_DOTS }, (_, i) => ordered[i] ?? null);
          const last = runs[0];
          return (
            <div key={agent.id} className="wz-crew-row" title={last ? `${last.ok ? 'ok' : 'failed'} · ${last.summary} · ${relativeTime(last.startedAt, now)}` : 'no runs in window'}>
              <div className="flex items-center gap-2.5">
                <span className="wz-tile">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-os-text">{agent.name}</div>
                  <div className="truncate text-[11px] text-os-dim">{agent.role}</div>
                </div>
                <span className="text-[12px] tabular-nums text-os-muted">{percent(okRate)}</span>
              </div>
              <div className="wz-dots mt-2">
                {dots.map((r, i) => (
                  <span key={i} className={`wz-dot ${r ? (r.ok ? 'wz-dot-ok' : 'wz-dot-err') : ''}`} />
                ))}
              </div>
            </div>
          );
        })}

        {crew.designed.map((d) => {
          const Icon = departmentIcon(d.departmentId);
          return (
            <div key={d.id} className="wz-crew-row wz-crew-ghost" title={d.purpose}>
              <div className="flex items-center gap-2.5">
                <span className="wz-tile">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-os-text">{d.name}</div>
                  <div className="truncate text-[11px] text-os-dim">{d.purpose}</div>
                </div>
                <span className="wz-chip">designed</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
