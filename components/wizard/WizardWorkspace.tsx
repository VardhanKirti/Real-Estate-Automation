'use client';

import type { Agent, Department } from '@/lib/schemas';
import type { WizardProject } from '@/lib/wizard/store';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import { WizardHeader, type WizardTab } from './WizardHeader';
import { ProjectsRail } from './ProjectsRail';
import { Conversation } from './Conversation';
import { CrewPanel } from './CrewPanel';
import { SessionsTab } from './SessionsTab';
import { CreateAgentModal } from './CreateAgentModal';
import { useWizardWorkspace } from './useWizardWorkspace';

export function WizardWorkspace({
  agents,
  departments,
  initialProjects,
  initialCrew,
}: {
  agents: Agent[];
  departments: Department[];
  initialProjects: WizardProject[];
  initialCrew: CrewSnapshot;
}) {
  const { projects, crew, setCrew, activeId, setActiveId, tab, setTab, ownerFilter, setOwnerFilter, createOpen, setCreateOpen, pending, pendingSeconds, engineError, now, newProject, patch, remove, send } =
    useWizardWorkspace(initialProjects, initialCrew);

  const active = projects.find((p) => p.id === activeId) ?? null;

  return (
    <div className="wz-page flex flex-col">
      <WizardHeader tab={tab} onTab={setTab} onCreateAgent={() => setCreateOpen(true)} projectCount={projects.length} />

      {tab === 'workspace' ? (
        <div className="wz-grid">
          <ProjectsRail projects={projects} agents={agents} activeId={activeId} ownerFilter={ownerFilter} onOwnerFilter={setOwnerFilter} onSelect={setActiveId} onNew={newProject} />
          <Conversation
            project={active}
            pending={pending}
            pendingSeconds={pendingSeconds}
            engineError={engineError}
            now={now}
            onSend={send}
            onRename={(name) => active && patch(active.id, { name })}
            onStatus={(status) => active && patch(active.id, { status })}
            onTask={(taskId, state) => active && patch(active.id, { task: { id: taskId, state } })}
            onDelete={() => active && remove(active.id)}
            onNew={newProject}
          />
          <CrewPanel crew={crew} now={now} />
        </div>
      ) : (
        <SessionsTab projects={projects} now={now} />
      )}

      <CreateAgentModal open={createOpen} departments={departments} onClose={() => setCreateOpen(false)} onCreated={(a) => setCrew((c) => ({ ...c, designed: [a, ...c.designed] }))} />
    </div>
  );
}
