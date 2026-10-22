'use client';

import { useState } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import type { Agent, Department } from '@/lib/schemas';
import type { WizardProject } from '@/lib/wizard/store';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import { Chip, LSampleChip, Pressable, ToggleChip } from '@/components/legacy';
import type { WizardTab } from './WizardHeader';
import { ProjectsRail } from './ProjectsRail';
import { Conversation } from './Conversation';
import { CrewPanel } from './CrewPanel';
import { SessionsTab } from './SessionsTab';
import { CreateAgentModal } from './CreateAgentModal';
import { useWizardWorkspace } from './useWizardWorkspace';

/**
 * Bennett Legacy tree of /wizard (founderos-ui pages/wizard.md). Same state
 * hook and the same rail, thread, sessions and crew parts as the Classic
 * WizardWorkspace (they wear the Legacy skin), laid out as FO's chat
 * surfaces: a `// CONDUCTOR` header, one bordered shell holding the projects
 * rail and the thread, and Agent performance on the page ground below it.
 * Not on a slab (L_NO_SLAB). Under 640px the shell shows the rail or the
 * thread, with a back button, never both.
 */
export function WizardL({
  agents,
  departments,
  initialProjects,
  initialCrew,
  filming = false,
}: {
  agents: Agent[];
  departments: Department[];
  initialProjects: WizardProject[];
  initialCrew: CrewSnapshot;
  filming?: boolean;
}) {
  const w = useWizardWorkspace(initialProjects, initialCrew);
  const [view, setView] = useState<'list' | 'thread'>('list');
  const active = w.active;
  const live = w.projects.filter((p) => p.status === 'active').length;

  const open = (id: string) => {
    w.setActiveId(id);
    setView('thread');
  };
  const create = async () => {
    await w.newProject();
    setView('thread');
  };

  return (
    <div data-l="Wizard" className="l-wz" data-view={view}>
      <header className="l-wz-head l-rise">
        <div className="min-w-0">
          <div className="l-eyebrow">{'// CONDUCTOR · PROJECTS · SESSIONS'}</div>
          <h1 className="l-wz-title">Wizard</h1>
        </div>
        <div className="l-wz-actions">
          {filming && <LSampleChip />}
          <Chip tone={w.pending ? 'warn' : 'ok'}>{w.pending ? 'Working' : `${live} live`}</Chip>
          <div className="l-wz-tabs" role="tablist" aria-label="Wizard view">
            {(['workspace', 'sessions'] as WizardTab[]).map((t) => (
              <ToggleChip key={t} role="tab" aria-selected={w.tab === t} on={w.tab === t} onClick={() => w.setTab(t)}>
                {t === 'workspace' ? 'Workspace' : 'Sessions'}
              </ToggleChip>
            ))}
          </div>
          <Pressable tone="secondary" onClick={() => w.setCreateOpen(true)} aria-label="Create an agent">
            <Plus size={13} strokeWidth={2} aria-hidden /> Agent
          </Pressable>
          <Pressable tone="primary" onClick={create}>
            <Plus size={13} strokeWidth={2} aria-hidden /> New project
          </Pressable>
        </div>
      </header>

      {w.tab === 'workspace' ? (
        <>
          <div className="l-wz-shell l-rise" data-l="Shell">
            <div className="l-wz-rail">
              <div className="l-wz-cap">
                <span>Projects</span>
                <span className="l-wz-cap-n">{w.projects.length}</span>
              </div>
              <ProjectsRail
                projects={w.projects}
                agents={agents}
                activeId={w.activeId}
                ownerFilter={w.ownerFilter}
                onOwnerFilter={w.setOwnerFilter}
                onSelect={open}
                onNew={create}
              />
            </div>
            <div className="l-wz-thread">
              <div className="l-wz-cap">
                <button type="button" className="l-wz-back" onClick={() => setView('list')} aria-label="Back to projects">
                  <ChevronLeft size={13} strokeWidth={2} aria-hidden /> Projects
                </button>
                <span className="truncate">Wizard{active ? ` · ${active.name}` : ''}</span>
                {active && (
                  <span className="l-wz-cap-chips">
                    <span className="l-wz-cap-n">turns {active.messages.filter((m) => m.role === 'user').length}</span>
                    <span className="l-wz-cap-n">tasks {active.tasks.length}</span>
                    <span className="l-wz-cap-n">spend ${(active.totalCostUsd ?? 0).toFixed(2)}</span>
                  </span>
                )}
              </div>
              <Conversation
                project={active}
                pending={w.pending}
                pendingSeconds={w.pendingSeconds}
                engineError={w.engineError}
                now={w.now}
                onSend={w.send}
                onRename={(name) => active && w.patch(active.id, { name })}
                onStatus={(status) => active && w.patch(active.id, { status })}
                onTask={(taskId, state) => active && w.patch(active.id, { task: { id: taskId, state } })}
                onDelete={() => {
                  if (!active) return;
                  w.remove(active.id);
                  setView('list');
                }}
                onNew={create}
              />
            </div>
          </div>
          <div className="l-wz-below l-rise">
            <CrewPanel crew={w.crew} now={w.now} />
          </div>
        </>
      ) : (
        <div className="l-wz-sessions l-rise">
          <SessionsTab projects={w.projects} now={w.now} />
        </div>
      )}

      <CreateAgentModal open={w.createOpen} departments={departments} onClose={() => w.setCreateOpen(false)} onCreated={(a) => w.setCrew((c) => ({ ...c, designed: [a, ...c.designed] }))} />
    </div>
  );
}
