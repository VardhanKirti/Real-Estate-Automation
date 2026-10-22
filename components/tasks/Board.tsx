'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, ChevronDown, Check, X } from 'lucide-react';
import { todoGroups, HORIZONS, TASK_STATUS_LABEL, type LinkedTask } from '@/lib/tasks-metrics';
import type { AgentTask } from '@/lib/schemas';

/**
 * Zone 3 (docs/TASKS-REDESIGN.md §5.4): Staffly's two-pane board — a grouped
 * To-Do rail on the left, a week time-grid on the right.
 *
 * The grid places tasks by `due_at`. Scheduled agent runs belong here too,
 * but `agent_crons` is empty everywhere and has no runner, so the grid shows
 * due work only and an empty column reads "Idle" rather than pretending.
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

const startOfWeek = (now: number): Date => {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
};

export function Board({
  tasks,
  agentNames,
  deptColorByAgent,
  now,
  onChanged,
  linked = null,
}: {
  tasks: AgentTask[];
  agentNames: Record<string, string>;
  deptColorByAgent: Record<string, string>;
  now: number;
  onChanged: () => void;
  /** ?task=<id> (Home's Needs you, the composer): shown selected at the top of the rail */
  linked?: LinkedTask;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const boardRef = useRef<HTMLDivElement>(null);
  const linkedId = linked?.id ?? null;
  // a deep link lands on the board, not the top of the page
  useEffect(() => {
    if (linkedId) boardRef.current?.scrollIntoView({ block: 'start' });
  }, [linkedId]);
  const clearLinked = () => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.delete('task');
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const [weekOffset, setWeekOffset] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const groups = useMemo(() => todoGroups(tasks), [tasks]);
  const weekStart = useMemo(() => {
    const s = startOfWeek(now);
    return new Date(s.getFullYear(), s.getMonth(), s.getDate() + weekOffset * 7);
  }, [now, weekOffset]);

  const complete = async (id: string) => {
    setBusy(id);
    await fetch('/api/agents/work', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'task', id, status: 'done' }),
    }).catch(() => null);
    setBusy(null);
    onChanged();
  };

  const create = async (horizon: string | null, dueAt?: string) => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    setAdding(null);
    await fetch('/api/agents/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'task', title, ownerKind: 'me', agentId: null,
        horizon: horizon ?? null, dueAt: dueAt ?? null,
      }),
    }).catch(() => null);
    onChanged();
  };

  const cellTasks = (dayIndex: number, hour: number) =>
    tasks.filter((t) => {
      if (!t.dueAt || t.status === 'done') return false;
      const d = new Date(t.dueAt);
      const cell = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayIndex, hour);
      return (
        d.getFullYear() === cell.getFullYear() && d.getMonth() === cell.getMonth() &&
        d.getDate() === cell.getDate() && d.getHours() === hour
      );
    });

  const todayIndex = (() => {
    const t = new Date(now);
    const diff = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - weekStart.getTime()) / 86_400_000);
    return diff >= 0 && diff < 7 ? diff : -1;
  })();

  return (
    <div ref={boardRef} className="glass-panel flex scroll-mt-6 flex-col overflow-hidden lg:flex-row">
      {/* ── To-Do rail ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-os-border p-4 lg:w-[248px] lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between">
          <div className="text-[13.5px] font-medium">To-Do</div>
          <button
            onClick={() => { setAdding('week'); setDraft(''); }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] transition-colors hover:bg-[var(--accent-line)]"
            aria-label="Add a to-do"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {linked && (
            <div
              data-task-focus={linked.id}
              aria-current={linked.task ? 'true' : undefined}
              className="rounded-sm-t border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-1.5 text-[12px]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-os-muted">
                Linked task
                <button onClick={clearLinked} className="ml-auto flex h-4 w-4 items-center justify-center rounded-[4px] text-os-dim transition-colors hover:text-os-text" aria-label="Clear the linked task">
                  <X className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </div>
              {linked.task ? (
                <>
                  <div className="mt-0.5 text-os-text">{linked.task.title}</div>
                  <div className="mt-0.5 text-[11px] text-os-muted">
                    {linked.task.agentId ? agentNames[linked.task.agentId] ?? linked.task.agentId : 'You'} · {TASK_STATUS_LABEL[linked.task.status]}
                    {linked.task.dueAt ? ` · due ${new Date(linked.task.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                  </div>
                  {linked.task.detail && <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-os-muted">{linked.task.detail}</p>}
                </>
              ) : (
                <div className="mt-0.5 text-os-muted">That task is no longer on the board.</div>
              )}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                className="flex w-full items-center gap-1.5 text-[12px] text-os-muted transition-colors hover:text-os-text"
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${collapsed[g.id] ? '-rotate-90' : ''}`} strokeWidth={1.8} />
                {g.label}
                <span className="ml-auto font-mono text-[10.5px] text-os-dim">{g.tasks.length}</span>
              </button>
              {!collapsed[g.id] && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {g.tasks.map((t) => (
                    // a div, not a label element: the check is the row's only button,
                    // so one click completes once (H28)
                    <div
                      key={t.id}
                      className={`tasks-todo flex items-start gap-2 rounded-sm-t px-1 py-1 text-[12px] transition-colors hover:bg-os-surface2 ${
                        busy === t.id ? 'tasks-todo-done' : ''
                      } ${t.id === linkedId ? 'bg-os-surface2' : ''}`}
                      aria-current={t.id === linkedId ? 'true' : undefined}
                    >
                      <button
                        onClick={() => void complete(t.id)}
                        className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border border-os-border-bright transition-colors hover:border-[var(--accent)]"
                        aria-label={`Complete ${t.title}`}
                      >
                        {busy === t.id && <Check className="h-2.5 w-2.5 text-[var(--accent)]" strokeWidth={3} />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-os-muted">{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {adding != null ? (
            <div className="flex flex-col gap-1.5">
              <select
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                className="rounded-sm-t border border-os-border bg-os-surface2 px-2 py-1 text-[11.5px] text-os-muted outline-none"
              >
                {HORIZONS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create(adding);
                  if (e.key === 'Escape') { setAdding(null); setDraft(''); }
                }}
                placeholder="What needs doing?"
                className="rounded-sm-t border border-[var(--accent-line)] bg-os-surface2 px-2 py-1.5 text-[12px] text-os-text outline-none placeholder:text-os-dim"
              />
            </div>
          ) : (
            <button
              onClick={() => { setAdding('week'); setDraft(''); }}
              className="self-start text-[12px] text-[var(--accent)] transition-opacity hover:opacity-75"
            >
              + To-do
            </button>
          )}

          {groups.length === 0 && adding == null && (
            <div className="rounded-md-t border border-dashed border-os-border px-3 py-5 text-center text-[11.5px] leading-relaxed text-os-dim">
              Nothing on your own list.
            </div>
          )}
        </div>
      </div>

      {/* ── week grid ──────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium">
              {weekStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => setWeekOffset((w) => w - 1)} className="rounded-sm-t border border-os-border px-1.5 py-0.5 text-[11px] text-os-dim transition-colors hover:text-os-text">‹</button>
            <button onClick={() => setWeekOffset(0)} className="rounded-sm-t border border-os-border px-2 py-0.5 text-[11px] text-os-dim transition-colors hover:text-os-text">Today</button>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="rounded-sm-t border border-os-border px-1.5 py-0.5 text-[11px] text-os-dim transition-colors hover:text-os-text">›</button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[44px_repeat(7,1fr)] text-[11px] text-os-dim">
              <span />
              {DAYS.map((d, i) => (
                <span key={d} className={`px-1 pb-1.5 text-center ${i === todayIndex ? 'text-[var(--accent)]' : ''}`}>
                  {d}
                </span>
              ))}
            </div>

            {HOURS.map((h) => (
              <div key={h} className="grid grid-cols-[44px_repeat(7,1fr)]">
                <span className="pr-2 pt-1 text-right font-mono text-[10px] text-os-dim">
                  {String(h).padStart(2, '0')}:00
                </span>
                {DAYS.map((_, dayIndex) => {
                  const items = cellTasks(dayIndex, h);
                  return (
                    <div
                      key={dayIndex}
                      className="group relative min-h-[46px] min-w-0 border-b border-r border-dashed p-0.5 first:border-l"
                      style={{ borderColor: 'var(--hairline)' }}
                    >
                      {items.map((t) => {
                        const color = t.agentId ? deptColorByAgent[t.agentId] ?? 'var(--accent)' : 'var(--accent)';
                        return (
                          <div key={t.id} className="tasks-card overflow-hidden rounded-md-t border border-os-border bg-os-surface shadow-sm">
                            <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 35%, transparent))` }} />
                            <div className="px-1.5 py-1">
                              <div className="truncate text-[10.5px] text-os-text">{t.title}</div>
                              <div className="truncate font-mono text-[9px] text-os-dim">
                                {t.agentId ? agentNames[t.agentId] ?? t.agentId : 'You'}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {items.length === 0 && (
                        <button
                          onClick={() => {
                            const cell = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayIndex, h);
                            setDraft('');
                            const title = window.prompt(`New task — ${cell.toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}`);
                            if (title?.trim()) {
                              setDraft(title);
                              void create(null, cell.toISOString());
                            }
                          }}
                          className="absolute inset-1 flex items-center justify-center rounded-sm-t bg-[var(--accent-soft)] text-[10.5px] text-[var(--accent)] opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {tasks.every((t) => t.dueAt == null) && (
          <div className="mt-3 rounded-md-t border border-dashed border-os-border px-3 py-3 text-center text-[11.5px] leading-relaxed text-os-dim">
            Idle — no task carries a due date yet. Add one from a cell, or set a
            due date on an existing task.
          </div>
        )}
      </div>
    </div>
  );
}
