'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Circle, ListChecks, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import {
  GAsk,
  GBar,
  GButton,
  GCard,
  GChip,
  GDialog,
  GDrawer,
  GEmpty,
  GErrorLine,
  GField,
  GHeroCard,
  GInput,
  GKeyValue,
  GPage,
  GProgress,
  GSectionHeader,
  GSegmented,
  GSelect,
  GSheet,
  GStat,
  GTable,
  GTag,
  GTextarea,
  GTickStrip,
  type GColumn,
} from '@/components/g';
import type { Agent, Department } from '@/lib/schemas';
import type { WizardProject } from '@/lib/wizard/store';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import type { DesignedAgent } from '@/lib/wizard/designed';
import type { AgentDirectory } from '@/lib/agent-directory';
import { elapsedLabel, relativeTime, shortSessionId } from '@/lib/wizard/helpers';
import { percent, projectOwners, projectProgress, projectSubline, tokensLabel } from '@/lib/wizard/ui';
import { AgentSheetHost } from '@/components/agents/AgentSheet';
import { openAgentSheet } from '@/components/agents/agent-param';
import { useWizardWorkspace } from './useWizardWorkspace';
import type { WizardTab } from './WizardHeader';

/**
 * /wizard under the GladOS style (glados-ui SPEC S04 §4.6, X5). Same state
 * and calls as the Classic WizardWorkspace (useWizardWorkspace); kit
 * presentation: one meta line on the conversation (session, model, tokens
 * in its title), Delete behind a confirm (AC04.24), the crew as one run strip
 * per agent with the window stated (AC04.26), Spend as the one hero on
 * Sessions, and the rail and crew as sheets on narrow screens (AC04.25).
 */
export function WizardG({
  agents,
  departments,
  initialProjects,
  initialCrew,
  dir,
}: {
  agents: Agent[];
  departments: Department[];
  initialProjects: WizardProject[];
  initialCrew: CrewSnapshot;
  dir: AgentDirectory;
}) {
  const w = useWizardWorkspace(initialProjects, initialCrew);
  const [railSheet, setRailSheet] = useState(false);
  const [crewSheet, setCrewSheet] = useState(false);

  const rail = (
    <ProjectsRailG
      projects={w.projects}
      agents={agents}
      activeId={w.activeId}
      ownerFilter={w.ownerFilter}
      onOwnerFilter={w.setOwnerFilter}
      onSelect={(id) => {
        w.setActiveId(id);
        setRailSheet(false);
      }}
      onNew={w.newProject}
    />
  );
  const crew = <CrewG crew={w.crew} now={w.now} />;

  return (
    <GPage className="wg-page">
      <GSectionHeader
        size="page"
        title="Wizard"
        caption="Talk to the system. Every conversation becomes a project."
        action={
          <div className="wg-head-actions">
            <GButton onClick={() => w.setCreateOpen(true)}>
              <Plus size={14} strokeWidth={1.75} aria-hidden /> New agent
            </GButton>
            <GSegmented<WizardTab>
              label="View"
              value={w.tab}
              onChange={w.setTab}
              options={[
                { value: 'workspace', label: 'Workspace' },
                { value: 'sessions', label: 'Sessions' },
              ]}
            />
          </div>
        }
      />

      {w.tab === 'workspace' ? (
        <div className="wg-wz-grid">
          <div className="wg-wz-rail">{rail}</div>
          <div className="wg-wz-main">
            <div className="wg-wz-narrow">
              <GButton size="sm" onClick={() => setRailSheet(true)} className="wg-wz-only-sm">
                Projects · {w.projects.length}
              </GButton>
              <GButton size="sm" onClick={() => setCrewSheet(true)}>
                Performance
              </GButton>
            </div>
            <ConversationG
              project={w.active}
              pending={w.pending}
              pendingSeconds={w.pendingSeconds}
              engineError={w.engineError}
              now={w.now}
              onSend={w.send}
              onRename={(name) => w.active && w.patch(w.active.id, { name })}
              onStatus={(status) => w.active && w.patch(w.active.id, { status })}
              onTask={(taskId, state) => w.active && w.patch(w.active.id, { task: { id: taskId, state } })}
              onDelete={() => w.active && w.remove(w.active.id)}
              onNew={w.newProject}
            />
          </div>
          <div className="wg-wz-crew">{crew}</div>
        </div>
      ) : (
        <SessionsG projects={w.projects} now={w.now} />
      )}

      <GDrawer open={railSheet} onClose={() => setRailSheet(false)} title="Projects" width={380}>
        {rail}
      </GDrawer>
      <GDrawer open={crewSheet} onClose={() => setCrewSheet(false)} title="Agent performance" width={400}>
        {crew}
      </GDrawer>
      <CreateAgentSheet open={w.createOpen} departments={departments} onClose={() => w.setCreateOpen(false)} onCreated={(a) => w.setCrew((c) => ({ ...c, designed: [a, ...c.designed] }))} />
      <AgentSheetHost dir={dir} />
    </GPage>
  );
}

/* ── Projects rail (F-Z2) ─────────────────────────────────────────────── */

function ProjectsRailG({
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
  const [group, setGroup] = useState<'active' | 'done'>('active');
  const owners = agents.filter((a) => projects.some((p) => p.tasks.some((t) => t.ownerId === a.id)));
  const visible = ownerFilter ? projects.filter((p) => p.tasks.some((t) => t.ownerId === ownerFilter)) : projects;
  const active = visible.filter((p) => p.status === 'active');
  const done = visible.filter((p) => p.status === 'done');
  const list = group === 'active' ? active : done;
  return (
    <GCard className="wg-wz-card">
      <GSectionHeader size={22} title={`Projects · ${projects.length}`} />
      <div className="wg-wz-rail-tools">
        <GButton variant="ink" onClick={onNew}>
          <Plus size={14} strokeWidth={1.75} aria-hidden /> New project
        </GButton>
        <GSelect
          aria-label="Filter by owner"
          value={ownerFilter ?? ''}
          onChange={(e) => onOwnerFilter(e.target.value || null)}
          options={[{ value: '', label: 'All owners' }, ...owners.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </div>
      <GSegmented
        label="Project status"
        value={group}
        onChange={setGroup}
        options={[
          { value: 'active', label: `Active ${active.length}` },
          { value: 'done', label: `Done ${done.length}` },
        ]}
      />
      <div className="wg-wz-list">
        {list.length === 0 && <p className="wg-cap">{group === 'active' ? 'Nothing in flight. Start a project or ask in the composer.' : 'Nothing finished yet.'}</p>}
        {list.map((p) => {
          const progress = projectProgress(p);
          const sub = projectSubline(p);
          const chips = projectOwners(p);
          return (
            <GCard key={p.id} p={16} onClick={() => onSelect(p.id)} className="wg-wz-proj" aria-label={`Open ${p.name}`}>
              <span className="wg-wz-proj-name" data-on={activeId === p.id || undefined}>
                {p.name}
              </span>
              <span className="wg-wz-proj-sub">
                {sub.label}: {sub.text}
              </span>
              {(chips.length > 0 || progress) && (
                <span className="wg-wz-proj-foot">
                  {chips.slice(0, 2).map((c) => (
                    <GTag key={c.id ?? c.name} size="xs">
                      {c.name}
                    </GTag>
                  ))}
                  {chips.length > 2 && <GTag size="xs">+{chips.length - 2}</GTag>}
                  {progress && p.status !== 'done' && (
                    <span className="wg-wz-proj-prog">
                      <GBar label={`${progress.done} of ${progress.total} tasks done`} value={progress.done} max={progress.total} />
                      <span>
                        {progress.done}/{progress.total}
                      </span>
                    </span>
                  )}
                </span>
              )}
            </GCard>
          );
        })}
      </div>
    </GCard>
  );
}

/* ── Conversation (F-Z3) ──────────────────────────────────────────────── */

function ConversationG({
  project,
  pending,
  pendingSeconds,
  engineError,
  now,
  onSend,
  onRename,
  onStatus,
  onTask,
  onDelete,
  onNew,
}: {
  project: WizardProject | null;
  pending: boolean;
  pendingSeconds: number;
  engineError: string | null;
  now: number;
  onSend: (text: string) => void;
  onRename: (name: string) => void;
  onStatus: (status: 'active' | 'done') => void;
  onTask: (taskId: string, state: 'open' | 'done') => void;
  onDelete: () => void;
  onNew: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [project?.messages.length, pending]);
  useEffect(() => setEditing(false), [project?.id]);

  if (!project) {
    return (
      <GCard className="wg-wz-card wg-wz-conv">
        <GEmpty title="Start a project" body="Say what you want done. The Wizard plans it, hands work to the crew and tracks it here." action={{ label: 'New project', onClick: onNew }} />
      </GCard>
    );
  }

  const progress = projectProgress(project);
  const sess = shortSessionId(project.sessionId);
  const diag = [
    sess ? `Session ${sess}` : null,
    project.model ? `Model ${project.model}` : null,
    project.lastUsage ? `${tokensLabel(project.lastUsage.inputTokens + project.lastUsage.outputTokens)} tokens last turn` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const meta = [project.status === 'done' ? 'done' : 'active', project.totalCostUsd > 0 ? `$${project.totalCostUsd.toFixed(2)}` : null].filter(Boolean).join(' · ');
  const engineDown = engineError != null && /unavailable|not found|claude/i.test(engineError);

  return (
    <GCard className="wg-wz-card wg-wz-conv">
      <div className="wg-wz-conv-head">
        <div className="wg-wz-conv-title">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
                if (nameDraft.trim() && nameDraft.trim() !== project.name) onRename(nameDraft.trim());
              }}
            >
              <GInput
                autoFocus
                value={nameDraft}
                aria-label="Project name"
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  setEditing(false);
                  if (nameDraft.trim() && nameDraft.trim() !== project.name) onRename(nameDraft.trim());
                }}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              />
            </form>
          ) : (
            <span className="wg-wz-name-row">
              <h2 className="wg-wz-name">{project.name}</h2>
              <GButton
                variant="icon"
                size="compact"
                aria-label="Rename project"
                onClick={() => {
                  setNameDraft(project.name);
                  setEditing(true);
                }}
              >
                <Pencil size={13} strokeWidth={1.6} aria-hidden />
              </GButton>
            </span>
          )}
          <span className="wg-cap" title={diag || undefined}>
            <span className="wg-dot" data-tone={project.status === 'done' ? 'ok' : 'warn'} aria-hidden /> {meta}
          </span>
        </div>
        <GButton size="sm" onClick={() => onStatus(project.status === 'done' ? 'active' : 'done')}>
          {project.status === 'done' ? 'Reopen' : 'Mark done'}
        </GButton>
        <GButton variant="icon" aria-label="Delete project" disabled={pending} disabledReason="Wait for the Wizard to finish" onClick={() => setConfirm(true)}>
          <Trash2 size={15} strokeWidth={1.6} aria-hidden />
        </GButton>
      </div>

      {project.tasks.length > 0 && (
        <div className="wg-wz-tasks">
          <span className="wg-cap wg-wz-taskcount">
            <ListChecks size={13} strokeWidth={1.6} aria-hidden /> {progress?.done}/{progress?.total}
          </span>
          {project.tasks.map((t) => (
            <GChip key={t.id} pressed={t.state === 'done'} onPressedChange={(on) => onTask(t.id, on ? 'done' : 'open')} title={`${t.ownerName} · ${t.state === 'done' ? 'reopen' : 'mark done'}`}>
              {t.state === 'done' ? <Check size={12} strokeWidth={2} aria-hidden /> : <Circle size={12} strokeWidth={1.75} aria-hidden />}
              {t.title}
            </GChip>
          ))}
        </div>
      )}

      <div ref={scroller} className="wg-wz-msgs">
        {project.messages.length === 0 && !pending && <p className="wg-cap wg-wz-hint">Say what you need. The first line names the project.</p>}
        {project.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="wg-wz-msg" data-role="user">
              <p>{m.text}</p>
              <span className="wg-wz-when">{relativeTime(m.at, now)}</span>
            </div>
          ) : (
            <div key={i} className="wg-wz-msg" data-role="wizard">
              <p>{m.text}</p>
              {m.receipts && m.receipts.length > 0 && (
                <span className="wg-tags">
                  {m.receipts.map((r, j) => (
                    <GTag key={j} tone={r.kind === 'ran-agent' ? 'accent' : 'neutral'}>
                      {r.kind === 'ran-agent' ? <Zap size={11} strokeWidth={1.75} aria-hidden /> : r.kind === 'done' ? <Check size={11} strokeWidth={1.75} aria-hidden /> : <ListChecks size={11} strokeWidth={1.75} aria-hidden />}
                      {r.label}
                    </GTag>
                  ))}
                </span>
              )}
              <span className="wg-wz-when">{relativeTime(m.at, now)}</span>
            </div>
          ),
        )}
        {pending && <GProgress text={`Wizard is working · ${elapsedLabel(pendingSeconds)}`} />}
        {engineError && (
          <div className="wg-wz-err">
            <GErrorLine align="left">{engineError}</GErrorLine>
            {engineDown && (
              <GButton variant="sm" href="/setup" title="The Wizard engine (the claude binary) is not available on this host">
                Set up
              </GButton>
            )}
          </div>
        )}
      </div>

      <GAsk
        className="wg-wz-composer"
        value={draft}
        onValueChange={setDraft}
        minChars={1}
        busy={pending}
        label="Ask the Wizard"
        placeholder="Ask the Wizard"
        onSubmit={(text) => {
          onSend(text);
          setDraft('');
        }}
      />

      <GDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this project and its history?"
        tone="danger"
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirm(false);
          onDelete();
        }}
      >
        <p className="wg-cap">“{project.name}” and its conversation are removed for good.</p>
      </GDialog>
    </GCard>
  );
}

/* ── Crew (F-Z4) ──────────────────────────────────────────────────────── */

function CrewG({ crew, now }: { crew: CrewSnapshot; now: number }) {
  const [showIdle, setShowIdle] = useState(false);
  const rows = [...crew.rows].sort((a, b) => b.runs.length - a.runs.length || a.agent.name.localeCompare(b.agent.name));
  const ran = rows.filter((r) => r.runs.length > 0);
  const idle = rows.filter((r) => r.runs.length === 0);
  const row = ({ agent, runs, okRate }: (typeof rows)[number]) => {
    const ordered = [...runs].reverse();
    const last = runs[0];
    return (
      <li key={agent.id}>
        <GCard p={16} onClick={() => openAgentSheet(agent.id)} className="wg-wz-crewrow" aria-label={`Open ${agent.name}`} title={last ? `${last.ok ? 'ok' : 'failed'} · ${last.summary} · ${relativeTime(last.startedAt, now)}` : 'No runs in the window'}>
          <span className="wg-wz-crewtop">
            <span className="wg-wz-crewid">
              <span className="wg-wz-crewname">{agent.name}</span>
              <span className="wg-cap">{agent.role}</span>
            </span>
            <span className="wg-wz-crewpct">{percent(okRate)}</span>
          </span>
          {runs.length > 0 && (
            <GTickStrip
              kind="runs"
              label={`${agent.name}: ${runs.length} runs in ${crew.windowDays} days, ${percent(okRate)} ok`}
              states={ordered.map((r) => (r.ok ? 'ok' : 'failed'))}
              titles={ordered.map((r) => `${r.ok ? 'ok' : 'failed'} · ${relativeTime(r.startedAt, now)} · ${r.summary}`)}
            />
          )}
        </GCard>
      </li>
    );
  };
  return (
    <GCard className="wg-wz-card">
      <GSectionHeader size={22} title={`Agent performance · ${crew.windowDays} days`} caption={`${crew.totalRuns} runs · ${percent(crew.okRate)} ok`} />
      <ul className="wg-wz-crew-list">
        {ran.map(row)}
        {idle.length > 0 && (
          <li>
            <GButton size="sm" aria-expanded={showIdle} onClick={() => setShowIdle((v) => !v)}>
              {idle.length} agent{idle.length === 1 ? '' : 's'} with no runs
            </GButton>
          </li>
        )}
        {showIdle && idle.map(row)}
        {crew.designed.map((d) => (
          <li key={d.id} className="wg-wz-ghost" title={d.purpose}>
            <span className="wg-wz-crewid">
              <span className="wg-wz-crewname">{d.name}</span>
              <span className="wg-cap">{d.purpose}</span>
            </span>
            <GTag tone="outline">designed</GTag>
          </li>
        ))}
      </ul>
    </GCard>
  );
}

/* ── Sessions tab (F-Z5) ──────────────────────────────────────────────── */

type Engine = { present: boolean; version: string | null; host: string };

function SessionsG({ projects, now }: { projects: WizardProject[]; now: number }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/wizard/engine')
      .then((r) => r.json())
      .then((b) => alive && (b.ok ? setEngine(b.engine as Engine) : setFailed(true)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const withSession = projects.filter((p) => p.sessionId);
  const spend = projects.reduce((s, p) => s + p.totalCostUsd, 0);
  const turns = projects.reduce((s, p) => s + (p.lastUsage?.turns ?? 0), 0);
  const columns: GColumn<WizardProject>[] = [
    {
      key: 'name',
      label: 'Project',
      sortValue: (p) => p.name,
      render: (p) => (
        <span className="wg-wz-sess">
          <span>{p.name}</span>
          <span className="wg-cap" data-mono-ok="">
            {p.sessionId}
          </span>
        </span>
      ),
    },
    { key: 'model', label: 'Model', sortValue: (p) => p.model ?? '', render: (p) => <span className="wg-cap">{p.model ?? '—'}</span> },
    { key: 'tokens', label: 'Last turn', render: (p) => (p.lastUsage ? `${tokensLabel(p.lastUsage.inputTokens)} in · ${tokensLabel(p.lastUsage.outputTokens)} out` : '—') },
    { key: 'msgs', label: 'Messages', numeric: true, sortValue: (p) => p.messages.length, render: (p) => p.messages.length },
    { key: 'cost', label: 'Spend', numeric: true, sortValue: (p) => p.totalCostUsd, render: (p) => `$${p.totalCostUsd.toFixed(2)}` },
    { key: 'when', label: 'Updated', sortValue: (p) => p.updatedAt, render: (p) => <span className="wg-cap">{relativeTime(p.updatedAt, now)}</span> },
  ];
  return (
    <div className="wg-wz-sessions">
      <div className="wg-wz-sess-side">
        <GCard>
          <GSectionHeader size={22} title="Engine" action={<GTag tone={engine ? (engine.present ? 'ok' : 'err') : failed ? 'err' : 'neutral'} dot>{engine ? (engine.present ? 'Present' : 'Not found') : failed ? 'Unknown' : 'Checking'}</GTag>} />
          {engine && !engine.present ? (
            <GEmpty inline kind="unconfigured" title="Claude binary not found on this host" body="The Wizard runs one exchange per message through it." setupHref="/setup" />
          ) : (
            <GKeyValue
              items={[
                { label: 'Version', value: engine?.version ?? '—' },
                { label: 'Host', value: engine?.host ?? '—' },
                { label: 'Mode', value: 'one exchange per message, session resumed by id' },
              ]}
            />
          )}
        </GCard>
        <GHeroCard variant="b" size="sm" caption="Spend" value={`$${spend.toFixed(2)}`} status={`across ${projects.length} projects`} title="Total reported cost of every Wizard session (the engine envelope's cost)." />
        <GCard className="wg-wz-totals">
          <GStat value={withSession.length} label="Sessions" source="Projects with a Claude session" />
          <GStat value={projects.length} label="Projects" source="Every Wizard project" />
          <GStat value={turns} label="Turns" source="Turns reported on each project's last exchange" />
        </GCard>
      </div>
      <GCard>
        <GSectionHeader size={22} title="Sessions" />
        <div className="wg-table-wrap">
          <GTable caption="Wizard sessions" columns={columns} rows={withSession} rowKey={(p) => p.id} sort={{ key: 'when', dir: 'desc' }} empty="No sessions yet. The first message in a project opens one." />
        </div>
      </GCard>
    </div>
  );
}

/* ── Create an agent (designed) ──────────────────────────────────────── */

function CreateAgentSheet({ open, departments, onClose, onCreated }: { open: boolean; departments: Department[]; onClose: () => void; onCreated: (a: DesignedAgent) => void }) {
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [purpose, setPurpose] = useState('');
  const [tools, setTools] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || !departmentId || !purpose.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/wizard/designed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, departmentId, purpose, tools }) });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Filing failed (${res.status})`);
      onCreated(body.agent as DesignedAgent);
      setName('');
      setPurpose('');
      setTools('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <GSheet
      open={open}
      onClose={onClose}
      width={480}
      title="New agent"
      caption="Files a spec under designed agents. It shows in the crew and on the Blueprint until it is wired."
      footer={
        <>
          <GButton onClick={onClose}>Cancel</GButton>
          <GButton variant="ink" busy={busy} onClick={submit} disabled={!name.trim() || !purpose.trim()} disabledReason="Name and purpose are needed">
            File as designed
          </GButton>
        </>
      }
    >
      <div className="wg-form">
        <GField label="Name">
          <GInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice reconciler" />
        </GField>
        <GField label="Department">
          <GSelect value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        </GField>
        <GField label="Purpose">
          <GTextarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What would it actually do?" rows={4} />
        </GField>
        <GField label="Tools" hint="Comma separated, for example gmail, attio">
          <GInput value={tools} onChange={(e) => setTools(e.target.value)} />
        </GField>
        {error && <GErrorLine align="left">{error}</GErrorLine>}
      </div>
    </GSheet>
  );
}
