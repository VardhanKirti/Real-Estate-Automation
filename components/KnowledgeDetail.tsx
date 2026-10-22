'use client';

import {
  ArrowLeft, ChevronRight, ClipboardList, FileText, ListChecks, Server, User, UserCog, Wrench, X, type LucideIcon,
} from 'lucide-react';
import type { AgentWiki, ToolWiki } from '@/lib/agent-wiki';
import { useGc } from '@/components/system-g/style-context';
import type { Personnel } from '@/lib/personnel';
import type { MemoryNode } from '@/lib/memory-core';
import type { Person, RosterClient, SopTask } from '@/lib/schemas';

export type AgentLite = { id: string; name: string; role: string; model: string };
export type ToolLite = { id: string; slug: string; name: string; mcp: boolean };
export type DeptLite = { deptId: string; teamId: string; name: string; tagline: string; color: string };

/** [[wiki-link]] styled chip, optionally clickable. */
export function WikiLink({ label, mcp, onClick }: { label: string; mcp?: boolean; onClick?: () => void }) {
  const gc = useGc();
  const inner = (
    <>
      <span className="text-os-dim">[[</span>
      {label}
      <span className="text-os-dim">]]</span>
      {mcp && <span className="rounded-sm-t border border-[var(--accent-line)] px-1 text-[9.5px] uppercase tracking-wide text-os-accent">mcp</span>}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={gc('g-btn g-btn-sm', 'inline-flex items-center gap-1 font-mono text-[12px] text-os-accent transition-opacity hover:opacity-70')}>
      {inner}
    </button>
  ) : (
    <span className="inline-flex items-center gap-1 font-mono text-[12px] text-os-accent">{inner}</span>
  );
}

function PanelHeader({
  title, sub, color, onBack, onClose,
}: {
  title: string; sub?: string; color?: string; onBack?: () => void; onClose?: () => void;
}) {
  const gc = useGc();
  return (
    <div className="flex items-start gap-3 border-b border-os-border px-3 py-3">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className={gc('g-btn g-btn-icon g-btn-sm', 'mt-0.5 shrink-0 text-os-dim transition-colors hover:text-os-text')}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium" style={color ? { color } : undefined}>{title}</div>
        {sub && <div className="truncate text-[11.5px] text-os-dim">{sub}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Close" className={gc('g-btn g-btn-icon g-btn-sm', 'shrink-0 text-os-dim transition-colors hover:text-os-text')}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2.5 text-[12px] text-os-muted">
      <Icon className="h-3 w-3" strokeWidth={1.6} /> {children}
    </div>
  );
}

/** A clickable row used for agents + people. */
function Row({
  color, title, sub, badge, onClick,
}: {
  color: string; title: string; sub?: string; badge?: string; onClick?: () => void;
}) {
  const gc = useGc();
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={gc('g-btn kg-detail-row', `group flex w-full items-center gap-3 rounded-md-t border border-os-border bg-os-surface px-2.5 py-2.5 text-left transition-colors ${
        onClick ? 'hover:border-os-border-strong' : 'cursor-default'
      }`)}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {sub && <span className="block truncate text-[11.5px] text-os-dim">{sub}</span>}
      </span>
      {badge && <span className="shrink-0 text-[10.5px] text-os-dim">{badge}</span>}
      {onClick && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-os-dim opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

/** Department overview: human lead, agents, tools. */
export function DeptOverviewCard({
  dept, head, agents, tools, onAgent, onTool, onPerson,
}: {
  dept: DeptLite;
  head: Personnel | null;
  agents: AgentLite[];
  tools: ToolLite[];
  onAgent: (id: string) => void;
  onTool: (id: string) => void;
  onPerson: (deptId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={dept.name} sub={dept.tagline} color={dept.color} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <SectionLabel icon={UserCog}>Human personnel</SectionLabel>
        {head ? (
          <Row color={dept.color} title={head.name} sub={head.role} badge="Lead" onClick={() => onPerson(dept.deptId)} />
        ) : (
          <p className="rounded-md-t border border-dashed border-os-border px-3 py-3 text-[12.5px] text-os-dim">
            No human lead yet — this team runs on agents.
          </p>
        )}

        <div className="mt-5">
          <SectionLabel icon={User}>Agents ({agents.length})</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {agents.map((a) => (
              <Row key={a.id} color="var(--accent)" title={a.name} sub={`${a.role} · ${a.model}`} onClick={() => onAgent(a.id)} />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <SectionLabel icon={Wrench}>Tools ({tools.length})</SectionLabel>
          <div className="flex flex-wrap gap-x-3 gap-y-2.5">
            {tools.map((t) => (
              <WikiLink key={t.id} label={t.name} mcp={t.mcp} onClick={() => onTool(t.id)} />
            ))}
            {tools.length === 0 && <span className="text-[12.5px] text-os-dim">No tools wired</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Agent harness card: the real picture of one agent — its charter, the SOP it
 * executes (the actual instructions), where it sits in the harness (tier,
 * instance, reports-to, sub-agents), the tools it holds, and its last run.
 */
export function AgentHarnessCard({
  agent, task, parentName, parentAgentId, subAgents, lastRun, headName, runLabel,
  onBack, onClose, onTool, onAgent, onTask,
}: {
  agent: { name: string; role: string; model: string; tier: string; instance: string; description: string; tools: string[] };
  task: SopTask | null;
  parentName: string | null;
  parentAgentId: string | null;
  subAgents: { id: string; name: string }[];
  lastRun: { ok: boolean; summary: string } | null;
  /** relative time of the last run, precomputed by the caller */
  runLabel?: string | null;
  headName?: string | null;
  onBack?: () => void;
  onClose?: () => void;
  onTool?: (slug: string) => void;
  onAgent?: (agentId: string) => void;
  onTask?: () => void;
}) {
  const gc = useGc();
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={agent.name} sub={`${agent.role} · AI agent`} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">{agent.description}</p>

        <SectionLabel icon={ListChecks}>Instructions{task ? '' : ' · no SOP assigned'}</SectionLabel>
        {task ? (
          <button onClick={onTask} disabled={!onTask} className={gc('g-btn g-btn-sm mb-1', `mb-1 text-left ${onTask ? 'hover:opacity-80' : ''}`)}>
            <span className="font-mono text-[12px] text-os-accent">[[{task.title}]]</span>
          </button>
        ) : null}
        <ol className="mb-4 flex flex-col gap-2.5">
          {(task?.steps ?? []).map((s, i) => (
            <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-os-muted">
              <span className="shrink-0 font-mono text-[11.5px] text-os-dim">{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>

        <SectionLabel icon={Server}>Harness</SectionLabel>
        <div className="mb-4 flex flex-col gap-1 font-mono text-[12px] text-os-muted">
          <span>
            <span className="text-os-dim">tier</span> {agent.tier} · <span className="text-os-dim">runs on</span>{' '}
            {agent.instance} · {agent.model}
          </span>
          {parentName && (
            <span>
              <span className="text-os-dim">reports to</span>{' '}
              {parentAgentId && onAgent ? (
                <button onClick={() => onAgent(parentAgentId)} className={gc('g-btn g-btn-sm', 'text-os-accent hover:opacity-80')}>
                  {parentName}
                </button>
              ) : (
                parentName
              )}
            </span>
          )}
          {headName && (
            <span>
              <span className="text-os-dim">human lead</span> {headName}
            </span>
          )}
          {subAgents.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="text-os-dim">sub-agents</span>
              {subAgents.map((s) =>
                onAgent ? (
                  <button key={s.id} onClick={() => onAgent(s.id)} className={gc('g-btn g-btn-sm', 'text-os-accent hover:opacity-80')}>
                    {s.name}
                  </button>
                ) : (
                  <span key={s.id}>{s.name}</span>
                ),
              )}
            </span>
          )}
        </div>

        <SectionLabel icon={Wrench}>Tools ({agent.tools.length})</SectionLabel>
        <div className="mb-4 flex flex-wrap gap-x-3 gap-y-2.5">
          {agent.tools.map((slug) => (
            <WikiLink
              key={slug}
              label={slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              onClick={onTool ? () => onTool(slug) : undefined}
            />
          ))}
          {agent.tools.length === 0 && <span className="text-[12.5px] text-os-dim">No tools wired</span>}
        </div>

        <SectionLabel icon={FileText}>Last run</SectionLabel>
        {lastRun ? (
          <div className="flex items-start gap-3">
            <span className={`dot mt-1 ${lastRun.ok ? 'ok' : 'err'}`} />
            <p className="text-[12.5px] leading-relaxed text-os-muted">
              {lastRun.summary}
              {runLabel && <span className="font-mono text-[11px] text-os-dim"> · {runLabel}</span>}
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-os-dim">Never run — trigger it from /agents</p>
        )}
      </div>
    </div>
  );
}

/** Tool wiki: what it is, how it's wired, and who uses it. */
export function ToolDetailCard({
  wiki, onBack, onClose,
}: {
  wiki: ToolWiki;
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={wiki.name} sub={wiki.kind} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">{wiki.summary}</p>
        <SectionLabel icon={FileText}>Context · <span className="font-mono text-[11px]">{wiki.path}</span></SectionLabel>
        <div className="mb-4 flex items-center gap-3">
          <WikiLink label={`${wiki.slug}.md`} mcp={wiki.mcp} />
        </div>
        <SectionLabel icon={User}>Used by ({wiki.usedBy.length})</SectionLabel>
        {wiki.usedBy.length === 0 ? (
          <p className="text-[12.5px] text-os-dim">No agents in view</p>
        ) : (
          <div className="flex flex-col gap-1">
            {wiki.usedBy.map((n) => (
              <span key={n} className="text-[12.5px] text-os-muted">{n}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type ClientLite = RosterClient;

// stages that count as "this is a client", across funnel and Attio wording
const ACTIVE_STAGES = new Set(['converted', 'won', 'closed won', 'closed-won', 'active']);
const isActiveClient = (status: string) => ACTIVE_STAGES.has(status.toLowerCase());

/** The Clients pillar roster: every client by venture, pipeline underneath. */
export function ClientRosterCard({
  clients, color, onClose,
}: {
  clients: ClientLite[];
  color: string;
  onClose?: () => void;
}) {
  const source = clients[0]?.source ?? 'funnel';
  const isLost = (status: string) => status.toLowerCase().includes('lost');
  const converted = clients.filter((c) => isActiveClient(c.status));
  const pipeline = clients.filter((c) => !isActiveClient(c.status) && !isLost(c.status));
  const lost = clients.filter((c) => !isActiveClient(c.status) && isLost(c.status)).length;
  const ventures = [...new Set(converted.map((c) => c.venture).filter(Boolean))].sort();
  const unventured = converted.filter((c) => !c.venture);
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Client roster"
        sub={`${converted.length} active · ${pipeline.length} in pipeline${lost > 0 ? ` · ${lost} lost` : ''} · ${source === 'attio' ? 'live · Attio' : 'seeded · funnel'}`}
        color={color}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        {ventures.map((v) => (
          <div key={v} className="mb-4">
            <SectionLabel icon={UserCog}>{v.replace(/-/g, ' ')}</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {converted
                .filter((c) => c.venture === v)
                .map((c) => (
                  <Row
                    key={c.id}
                    color={color}
                    title={c.name}
                    sub={c.amountUsd ? `$${c.amountUsd.toLocaleString('en-US')}` : 'active client'}
                  />
                ))}
            </div>
          </div>
        ))}
        {unventured.length > 0 && (
          <div className="mb-4">
            <SectionLabel icon={UserCog}>Clients</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {unventured.map((c) => (
                <Row
                  key={c.id}
                  color={color}
                  title={c.name}
                  sub={c.amountUsd ? `$${c.amountUsd.toLocaleString('en-US')}` : c.status}
                />
              ))}
            </div>
          </div>
        )}
        {converted.length === 0 && (
          <p className="mb-4 text-[12.5px] text-os-dim">No active clients yet.</p>
        )}
        {pipeline.length > 0 && (
          <div>
            <SectionLabel icon={ClipboardList}>In pipeline ({pipeline.length})</SectionLabel>
            <div className="flex flex-col gap-1">
              {pipeline.map((c) => (
                <span key={c.id} className="truncate text-[12.5px] text-os-dim">
                  {c.name} · {c.status.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Memory note detail: one page from the operator's brain-store constellation. */
export function MemoryNoteCard({
  note, color, onBack, onClose,
}: {
  note: MemoryNode;
  color: string;
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={note.label} sub="memory · brain-store" color={color} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="rounded-[6px] border px-1.5 py-0.5 font-mono text-[10.5px]"
            style={{ borderColor: color, color }}
          >
            {note.folder}
          </span>
          <span className="text-[11.5px] text-os-dim">
            {note.wordCount} words · {note.chunks} chunk{note.chunks === 1 ? '' : 's'}
          </span>
        </div>
        {note.excerpt ? (
          <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">{note.excerpt}</p>
        ) : (
          <p className="mb-4 text-[12.5px] text-os-dim">No excerpt</p>
        )}
        <SectionLabel icon={FileText}>Source</SectionLabel>
        <WikiLink label={`${note.id}.md`} />
      </div>
    </div>
  );
}

/** SOP detail: one written-out job — its steps, its single owner, its tools. */
export function SopTaskDetailCard({
  task, assigneeName, assigneeKindLabel, assigneeColor, runtime, tools, onBack, onClose, onAssignee, onTool,
}: {
  task: SopTask;
  assigneeName: string;
  assigneeKindLabel: string; // 'human' | 'AI agent'
  assigneeColor: string;
  /** what executes this SOP, e.g. 'builtin · imapflow' or 'human · judgment call' */
  runtime?: string | null;
  tools: { slug: string; name: string; mcp: boolean }[];
  onBack?: () => void;
  onClose?: () => void;
  onAssignee?: () => void;
  onTool?: (slug: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={task.title} sub="standard operating procedure" onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        {task.summary && <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">{task.summary}</p>}

        <SectionLabel icon={UserCog}>Done by</SectionLabel>
        <div className="mb-4">
          <Row color={assigneeColor} title={assigneeName} sub={assigneeKindLabel} badge="1:1" onClick={onAssignee} />
          {runtime && (
            <p className="mt-1 text-[11.5px] text-os-dim">
              Runs on <span className="font-mono text-[11px] text-os-muted">{runtime}</span>
            </p>
          )}
        </div>

        <SectionLabel icon={ListChecks}>The job, written out</SectionLabel>
        <ol className="mb-4 flex flex-col gap-2.5">
          {task.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-os-muted">
              <span className="shrink-0 font-mono text-[11.5px] text-os-dim">{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>

        <SectionLabel icon={Wrench}>Tools at the end of the chain ({tools.length})</SectionLabel>
        <div className="flex flex-wrap gap-x-3 gap-y-2.5">
          {tools.map((t) => (
            <WikiLink key={t.slug} label={t.name} mcp={t.mcp} onClick={onTool ? () => onTool(t.slug) : undefined} />
          ))}
          {tools.length === 0 && <span className="text-[12.5px] text-os-dim">No tools wired</span>}
        </div>
      </div>
    </div>
  );
}

/** Graph human detail: a person in the process — their one job and tools. */
export function GraphHumanDetailCard({
  person, deptName, color, task, tools, onBack, onClose, onTask, onTool,
}: {
  person: Person;
  deptName: string;
  color: string;
  task: SopTask | null;
  tools: { slug: string; name: string; mcp: boolean }[];
  onBack?: () => void;
  onClose?: () => void;
  onTask?: () => void;
  onTool?: (slug: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={person.name} sub={`${person.role} · human`} color={color} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">
          Human employee in <span className="font-semibold">{deptName}</span> — one job, done by them alone.
        </p>
        <SectionLabel icon={ClipboardList}>Their job</SectionLabel>
        <div className="mb-4">
          {task ? (
            <Row color={color} title={task.title} sub={task.summary} badge="SOP" onClick={onTask} />
          ) : (
            <p className="text-[12.5px] text-os-dim">No task assigned</p>
          )}
        </div>
        <SectionLabel icon={Wrench}>Works with ({tools.length})</SectionLabel>
        <div className="flex flex-wrap gap-x-3 gap-y-2.5">
          {tools.map((t) => (
            <WikiLink key={t.slug} label={t.name} mcp={t.mcp} onClick={onTool ? () => onTool(t.slug) : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Person detail: who they are and the agents they manage. */
export function PersonDetailCard({
  person, deptName, color, agents, onBack, onClose,
}: {
  person: Personnel;
  deptName: string;
  color: string;
  agents: AgentLite[];
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={person.name} sub={person.role} color={color} onBack={onBack} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-3 py-3.5">
        <p className="mb-4 text-[12.5px] leading-relaxed text-os-muted">
          Leads <span className="font-semibold" style={{ color }}>{deptName}</span> — manages {agents.length} agent{agents.length === 1 ? '' : 's'}.
        </p>
        <SectionLabel icon={FileText}>Context · <span className="font-mono text-[11px]">brain-store/people/{person.name.toLowerCase()}.md</span></SectionLabel>
        <div className="mb-4"><WikiLink label={`${person.name.toLowerCase()}.md`} /></div>
        <SectionLabel icon={User}>Manages</SectionLabel>
        <div className="flex flex-col gap-1">
          {agents.map((a) => (
            <span key={a.id} className="text-[12.5px] text-os-muted">{a.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
