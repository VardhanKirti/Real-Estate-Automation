'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { GButton, GErrorLine, GInput, GSegmented, GTag, GToggle } from '@/components/g';
import { describeCron } from '@/lib/cron';
import type { AgentCron, AgentTask } from '@/lib/schemas';

/**
 * The AgentSheet's Work section (glados-ui SPEC S04 F-A6.3): the moved
 * AgentWorkPanel CRUD (tasks and schedules, persisted through
 * /api/agents/work) on the kit. Same calls, same status cycle; the
 * Schedules tab keeps the honest note that no runner exists yet.
 */
const STATUS_NEXT: Record<AgentTask['status'], AgentTask['status']> = { open: 'doing', doing: 'done', blocked: 'doing', done: 'open' };
const STATUS_LABEL: Record<AgentTask['status'], string> = { open: 'Open', doing: 'In progress', blocked: 'Blocked', done: 'Done' };

export function SheetWork({ agentId, initialTasks, initialCrons }: { agentId: string; initialTasks: AgentTask[]; initialCrons: AgentCron[] }) {
  const [tab, setTab] = useState<'tasks' | 'schedules'>('tasks');
  const [tasks, setTasks] = useState(initialTasks);
  const [crons, setCrons] = useState(initialCrons);
  const [taskTitle, setTaskTitle] = useState('');
  const [cronSchedule, setCronSchedule] = useState('');
  const [cronDesc, setCronDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const api = async (method: string, body: unknown) => {
    setError(null);
    try {
      const res = await fetch('/api/agents/work', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Request failed');
        return null;
      }
      return json;
    } catch {
      setError('Request failed');
      return null;
    }
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    const res = await api('POST', { kind: 'task', agentId, title: taskTitle.trim() });
    if (res?.task) {
      setTasks((prev) => [res.task, ...prev]);
      setTaskTitle('');
    }
  };
  const cycleTask = async (task: AgentTask) => {
    const status = STATUS_NEXT[task.status];
    if (await api('PATCH', { kind: 'task', id: task.id, status })) setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
  };
  const removeTask = async (id: string) => {
    if (await api('DELETE', { kind: 'task', id })) setTasks((prev) => prev.filter((t) => t.id !== id));
  };
  const addCron = async () => {
    if (!cronSchedule.trim() || !cronDesc.trim()) return;
    const res = await api('POST', { kind: 'cron', agentId, schedule: cronSchedule.trim(), description: cronDesc.trim() });
    if (res?.cron) {
      setCrons((prev) => [res.cron, ...prev]);
      setCronSchedule('');
      setCronDesc('');
    }
  };
  const toggleCron = async (cron: AgentCron) => {
    if (await api('PATCH', { kind: 'cron', id: cron.id, enabled: !cron.enabled })) setCrons((prev) => prev.map((c) => (c.id === cron.id ? { ...c, enabled: !c.enabled } : c)));
  };
  const removeCron = async (id: string) => {
    if (await api('DELETE', { kind: 'cron', id })) setCrons((prev) => prev.filter((c) => c.id !== id));
  };

  const openCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="wg-work">
      <GSegmented
        label="Work"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'tasks', label: `Tasks · ${openCount} open` },
          { value: 'schedules', label: `Schedules · ${crons.length}` },
        ]}
      />
      {error && <GErrorLine align="left">{error}</GErrorLine>}
      {tab === 'tasks' ? (
        <>
          <form
            className="wg-inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              void addTask();
            }}
          >
            <GInput value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="New task" aria-label="New task title" />
            <GButton type="submit" variant="icon" aria-label="Add task" disabled={!taskTitle.trim()}>
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </GButton>
          </form>
          {tasks.length === 0 ? (
            <p className="wg-cap">No tasks yet.</p>
          ) : (
            <ul className="wg-work-list">
              {tasks.map((t) => (
                <li key={t.id} className="wg-work-row" data-done={t.status === 'done' || undefined}>
                  <GButton size="compact" onClick={() => cycleTask(t)} title="Advance: open, in progress, done">
                    {STATUS_LABEL[t.status]}
                  </GButton>
                  <span className="wg-work-title">{t.title}</span>
                  <GButton variant="icon" size="compact" aria-label={`Delete ${t.title}`} onClick={() => removeTask(t.id)}>
                    <Trash2 size={14} strokeWidth={1.6} aria-hidden />
                  </GButton>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <form
            className="wg-inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              void addCron();
            }}
          >
            <GInput className="wg-cron-in" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="0 9 * * 1-5" aria-label="Schedule (cron)" />
            <GInput value={cronDesc} onChange={(e) => setCronDesc(e.target.value)} placeholder="What it should do" aria-label="What it should do" />
            <GButton type="submit" variant="icon" aria-label="Add schedule" disabled={!cronSchedule.trim() || !cronDesc.trim()}>
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </GButton>
          </form>
          {crons.length === 0 ? (
            <p className="wg-cap">No schedules yet.</p>
          ) : (
            <ul className="wg-work-list">
              {crons.map((c) => (
                <li key={c.id} className="wg-work-row">
                  <GToggle checked={c.enabled} onCheckedChange={() => toggleCron(c)} aria-label={c.enabled ? `Disable ${c.description}` : `Enable ${c.description}`} />
                  <span className="wg-work-title" title={c.schedule}>
                    {describeCron(c.schedule) ?? c.schedule} · {c.description}
                  </span>
                  <GButton variant="icon" size="compact" aria-label={`Delete ${c.description}`} onClick={() => removeCron(c.id)}>
                    <Trash2 size={14} strokeWidth={1.6} aria-hidden />
                  </GButton>
                </li>
              ))}
            </ul>
          )}
          <p className="wg-cap">
            <GTag size="xs" tone="outline">
              Stored, no runner yet
            </GTag>{' '}
            Schedules are saved here; the runner ships with the dedicated host deploy.
          </p>
        </>
      )}
    </div>
  );
}
