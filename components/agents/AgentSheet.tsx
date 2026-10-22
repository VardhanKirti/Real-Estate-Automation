'use client';

import { useEffect, useMemo, useState } from 'react';
import { GDrawer, GList, GRow, GTag, GSectionHeader, GButton } from '@/components/g';
import { buildStepTree, connectedChips, resolveWorksWith } from '@/app/agents/panel-data';
import { relativeTime } from '@/lib/wizard/helpers';
import type { AgentDirectory } from '@/lib/agent-directory';
import { AgentFace } from './AgentFace';
import { SheetChat } from './SheetChat';
import { SheetWork } from './SheetWork';
import { useAgentParam } from './agent-param';
import { FailoverG } from '@/components/agents-fo/AgentsFoG';
import { failoverModelOptions } from '@/lib/agent-review';

/**
 * AgentSheet (glados-ui SPEC S04 F-A6, F0.3): the one agent profile, a
 * 560px right GDrawer. Header facts, the real Chat, Work (tasks and
 * schedules), What it does, Connected to, Works with (switches the sheet,
 * Back returns, depth 10) and the Run feed. No directive input (H25) and no
 * Logic bullets (they restated Works with and Connected to). Esc, the close
 * button and the scrim close it; focus is trapped and returns to the opener
 * (GDrawer on useDialog).
 */
const MAX_DEPTH = 10;

export function AgentSheet({ dir, agentId, onClose, onSwitch, onBack }: { dir: AgentDirectory; agentId: string; onClose: () => void; onSwitch: (id: string) => void; onBack?: () => void }) {
  const agent = dir.agents.find((a) => a.id === agentId) ?? null;
  const view = useMemo(() => {
    if (!agent) return null;
    const runs = dir.runsByAgent[agent.id] ?? [];
    const owned = dir.skills.filter((s) => s.ownerAgentId === agent.id);
    return {
      runs,
      department: dir.departments.find((d) => d.id === agent.departmentId) ?? null,
      steps: buildStepTree(agent, runs[0] ?? null, owned),
      chips: connectedChips(agent, owned),
      worksWith: resolveWorksWith(agent, dir.agents),
    };
  }, [agent, dir]);

  if (!agent || !view) return null;
  const active = agent.status === 'active';
  const setup = dir.setupIds.includes(agent.id);

  return (
    <GDrawer open onClose={onClose} onBack={onBack} title={agent.name} width={560} className="wg-sheet">
      <div className="wg-sheet-head" data-agent-sheet={agent.id}>
        <AgentFace src={dir.avatars[agent.id]} name={agent.name} size={56} />
        <div className="wg-sheet-id">
          <p className="wg-sheet-role">{agent.role}</p>
          <div className="wg-tags">
            <GTag tone={active ? 'ok' : 'neutral'} dot>
              {agent.status}
            </GTag>
            <GTag>{agent.tier}</GTag>
            {view.department && <GTag>{view.department.name}</GTag>}
          </div>
          <p className="wg-cap">
            Instance {agent.instance} · {agent.model}
          </p>
        </div>
        {setup && (
          <GButton variant="sm" href={`/agents/setup/${agent.id}`}>
            Set up
          </GButton>
        )}
      </div>
      {agent.description && <p className="wg-sheet-desc">{agent.description}</p>}

      <section className="wg-sheet-sec" aria-labelledby="wg-sec-chat">
        <GSectionHeader size={22} title={<span id="wg-sec-chat">Chat</span>} />
        <SheetChat key={`chat-${agent.id}`} agentId={agent.id} agentName={agent.name} initialMessages={dir.messagesByAgent[agent.id] ?? []} />
      </section>

      <section className="wg-sheet-sec" aria-labelledby="wg-sec-work">
        <GSectionHeader size={22} title={<span id="wg-sec-work">Work</span>} />
        <SheetWork key={`work-${agent.id}`} agentId={agent.id} initialTasks={dir.tasksByAgent[agent.id] ?? []} initialCrons={dir.cronsByAgent[agent.id] ?? []} />
      </section>

      <section className="wg-sheet-sec">
        <GSectionHeader size={22} title="What it does" />
        {view.steps.length === 0 ? (
          <p className="wg-cap">Nothing derivable yet.</p>
        ) : (
          <ol className="wg-steps">
            {view.steps.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="wg-sheet-sec">
        <GSectionHeader size={22} title="Connected to" />
        {view.chips.length === 0 ? (
          <p className="wg-cap">Nothing wired yet.</p>
        ) : (
          <div className="wg-tags">
            {view.chips.map((c) => (
              <GTag key={c}>{c}</GTag>
            ))}
          </div>
        )}
      </section>

      {view.worksWith.length > 0 && (
        <section className="wg-sheet-sec">
          <GSectionHeader size={22} title="Works with" />
          <GList>
            {view.worksWith.map((w) => (
              <GRow
                key={w.agent.id}
                leading={<AgentFace src={dir.avatars[w.agent.id]} name={w.agent.name} size={28} />}
                title={w.agent.name}
                meta={w.relation === 'parent' ? 'Parent' : 'Reports in'}
                onClick={() => onSwitch(w.agent.id)}
              />
            ))}
          </GList>
        </section>
      )}

      <section className="wg-sheet-sec" aria-labelledby="wg-sec-failover">
        <GSectionHeader size={22} title={<span id="wg-sec-failover">Failover</span>} caption="Move this agent onto another model; the change shows in the run feed" />
        <FailoverG key={`fo-${agent.id}`} agentId={agent.id} agentName={agent.name} model={agent.model} options={failoverModelOptions(dir.agents, agent.model, dir.defaultModel)} />
      </section>

      <section className="wg-sheet-sec">
        <GSectionHeader size={22} title="Run feed" caption={view.runs.length > 0 ? `Latest ${view.runs.length}` : undefined} />
        {view.runs.length === 0 ? (
          <p className="wg-cap">No runs recorded yet.</p>
        ) : (
          <ul className="wg-feed">
            {view.runs.map((r) => (
              <li key={r.id} title={`${r.ok ? 'Succeeded' : 'Failed'} · ${new Date(r.startedAt).toLocaleString()}`}>
                <span className="wg-dot" data-tone={r.ok ? 'ok' : 'err'} aria-label={r.ok ? 'Succeeded' : 'Failed'} />
                <span className="wg-feed-when">{relativeTime(r.startedAt)}</span>
                <span className="wg-feed-text">{r.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </GDrawer>
  );
}

/**
 * Binds the sheet to `?agent=`: render once per page that lists agents. The
 * back stack lives here (a "Works with" hop pushes, Back pops, depth 10).
 */
export function AgentSheetHost({ dir }: { dir: AgentDirectory }) {
  const [id, setId] = useAgentParam();
  const [stack, setStack] = useState<string[]>([]);
  useEffect(() => {
    if (!id) setStack([]);
  }, [id]);
  if (!id || !dir.agents.some((a) => a.id === id)) return null;
  return (
    <AgentSheet
      dir={dir}
      agentId={id}
      onClose={() => setId(null)}
      onSwitch={(next) => {
        setStack((s) => (s.length >= MAX_DEPTH ? s : [...s, id]));
        setId(next);
      }}
      onBack={
        stack.length > 0
          ? () => {
              const prev = stack[stack.length - 1];
              setStack((s) => s.slice(0, -1));
              setId(prev);
            }
          : undefined
      }
    />
  );
}
