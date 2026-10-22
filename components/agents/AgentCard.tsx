'use client';

import { GButton, GCard, GTickStrip } from '@/components/g';
import { relativeTime } from '@/lib/wizard/helpers';
import type { Agent, AgentRun } from '@/lib/schemas';
import { AgentFace } from './AgentFace';

/**
 * Compact roster card (glados-ui SPEC S04 F-A4, X1 composite "AgentCard"):
 * avatar, name, role, one status, the last run and a 12-run strip, plus a
 * "Set up" button when the agent needs wiring. Everything else lives in the
 * AgentSheet. The card face is one button that opens the sheet; Set up is a
 * sibling link so controls never nest.
 */
export function AgentCard({ agent, avatar, runs, setup, onOpen }: { agent: Agent; avatar: string | undefined; runs: AgentRun[]; setup: boolean; onOpen: () => void }) {
  const last = runs[0];
  const recent = runs.slice(0, 12).reverse();
  const active = agent.status === 'active';
  return (
    <div className="wg-agent" data-status={agent.status}>
      <GCard p={16} onClick={onOpen} aria-label={`Open ${agent.name} profile`} className="wg-agent-open">
        <span className="wg-agent-top">
          <AgentFace src={avatar} name={agent.name} size={36} />
          <span className="wg-agent-id">
            <span className="wg-agent-name">{agent.name}</span>
            <span className="wg-agent-role">{agent.role}</span>
          </span>
        </span>
        <span className="wg-agent-status">
          <span className="wg-dot" data-tone={active ? 'ok' : 'idle'} aria-hidden />
          {agent.status}
        </span>
        <span className="wg-agent-run" title={last?.summary}>
          {last ? `Last run ${last.ok ? 'ok' : 'failed'} · ${relativeTime(last.startedAt)}` : 'No runs recorded'}
        </span>
        {recent.length > 0 && (
          <GTickStrip
            kind="runs"
            label={`${agent.name}: last ${recent.length} runs, ${recent.filter((r) => r.ok).length} ok`}
            states={recent.map((r) => (r.ok ? 'ok' : 'failed'))}
            titles={recent.map((r) => `${r.ok ? 'ok' : 'failed'} · ${new Date(r.startedAt).toLocaleDateString()} · ${r.summary}`)}
            className="wg-agent-ticks"
          />
        )}
      </GCard>
      {setup && (
        <GButton variant="sm" href={`/agents/setup/${agent.id}`} className="wg-agent-setup">
          Set up
        </GButton>
      )}
    </div>
  );
}
