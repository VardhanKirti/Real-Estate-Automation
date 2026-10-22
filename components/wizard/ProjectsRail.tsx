'use client';

import { CircleCheck, LoaderCircle, Plus, ChevronDown } from 'lucide-react';
import type { Agent } from '@/lib/schemas';
import type { WizardProject } from '@/lib/wizard/store';
import { departmentIcon, projectOwners, projectProgress, projectSubline } from '@/lib/wizard/ui';
import { ProgressRing } from './ProgressRing';

export function ProjectsRail({
  projects,
  agents,
  activeId,
  ownerFilter,
  onOwnerFilter,
  onSelect,
  onNew,
}: {
  projects: WizardProject[];
  agents: Agent[];
  activeId: string | null;
  ownerFilter: string | null;
  onOwnerFilter: (id: string | null) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const owners = agents.filter((a) => projects.some((p) => p.tasks.some((t) => t.ownerId === a.id)));
  const visible = ownerFilter ? projects.filter((p) => p.tasks.some((t) => t.ownerId === ownerFilter)) : projects;
  const active = visible.filter((p) => p.status === 'active');
  const done = visible.filter((p) => p.status === 'done');

  function Card({ p }: { p: WizardProject }) {
    const progress = projectProgress(p);
    const sub = projectSubline(p);
    const chips = projectOwners(p);
    const isDone = p.status === 'done';
    return (
      <button type="button" onClick={() => onSelect(p.id)} className={`wz-card animate-wizard-row-in w-full p-3.5 text-left ${activeId === p.id ? 'wz-card-on' : ''}`}>
        <div className="flex items-start gap-3">
          <span className={`wz-tile ${isDone ? 'wz-tile-done' : ''}`}>
            {isDone ? <CircleCheck className="h-4 w-4" strokeWidth={2} /> : <LoaderCircle className="h-4 w-4" strokeWidth={2} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13.5px] leading-snug text-os-text">{p.name}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-os-dim">
              <span className="text-os-muted">↳ {sub.label}:</span> {sub.text}
            </div>
          </div>
          {progress && !isDone && <ProgressRing done={progress.done} total={progress.total} size={40} />}
        </div>
        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.slice(0, 3).map((c) => {
              const Icon = departmentIcon(c.id ? agentById.get(c.id)?.departmentId : null);
              return (
                <span key={c.id ?? c.name} className="wz-chip">
                  <Icon className="h-3 w-3" strokeWidth={2} />
                  {c.name}
                </span>
              );
            })}
            {chips.length > 3 && <span className="wz-chip">+{chips.length - 3}</span>}
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="wz-panel flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-os-hairline px-4 py-3">
        <button type="button" onClick={onNew} className="wz-new flex-1">
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          New project
        </button>
        <label className="wz-select">
          <select value={ownerFilter ?? ''} onChange={(e) => onOwnerFilter(e.target.value || null)} aria-label="Filter by owner">
            <option value="">All owners</option>
            {owners.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3.5 w-3.5" />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Group icon={<LoaderCircle className="h-4 w-4" strokeWidth={2} />} label="Active" count={active.length}>
          {active.length === 0 && <p className="px-1 py-2 text-[12px] text-os-dim">Nothing in flight. Start a project below or with the composer.</p>}
          {active.map((p) => (
            <Card key={p.id} p={p} />
          ))}
        </Group>
        <Group icon={<CircleCheck className="h-4 w-4" strokeWidth={2} />} label="Done" count={done.length}>
          {done.map((p) => (
            <Card key={p.id} p={p} />
          ))}
        </Group>
      </div>
    </div>
  );
}

function Group({ icon, label, count, children }: { icon: React.ReactNode; label: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center gap-2 px-1 text-[13px] text-os-text">
        <span className="text-os-muted">{icon}</span>
        {label}
        <span className="wz-count">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
