'use client';

import { useState } from 'react';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentPanel } from '@/components/AgentPanel';
import { Dot } from '@/components/terminal';
import type { Agent, AgentRun, Department, Skill } from '@/lib/schemas';
import type { Campaign } from '@/lib/content-campaigns';
import type { HiggsfieldAccount } from '@/lib/higgsfield/account';

/**
 * Slim single-row studio header, replacing the Kanye hero block: a campaign
 * switcher (same behavior as the old ContentTop chips), a real Higgsfield
 * credits chip, and a small director chip that opens the same AgentPanel
 * profile overlay the /agents roster uses — Kanye is context, one click
 * away, not the top of the page.
 */
export function StudioBar({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  account,
  director,
  avatarSrc,
  allAgents,
  avatars,
  departments,
  skills,
  runsByAgent,
}: {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  account: HiggsfieldAccount | null;
  director: Agent | null;
  avatarSrc: string | null;
  allAgents: Agent[];
  avatars: Record<string, string>;
  departments: Department[];
  skills: Skill[];
  runsByAgent: Record<string, AgentRun[]>;
}) {
  const [panelAgentId, setPanelAgentId] = useState<string | null>(null);
  const panelAgent = panelAgentId ? (allAgents.find((a) => a.id === panelAgentId) ?? null) : null;

  return (
    <div className="glass-panel flex flex-wrap items-center gap-3 px-5 py-3.5">
      {campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="glass-label mr-1">Campaign</span>
          {campaigns.map((c) => {
            const active = c.id === selectedCampaignId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectCampaign(c.id)}
                aria-pressed={active}
                className={`glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] transition-colors ${
                  active ? 'border-[var(--accent-line)] text-os-text' : 'text-os-muted hover:text-os-text'
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2.5">
        {account ? (
          <span
            className="glass-chip px-3 py-1.5 font-mono text-[11.5px] text-os-muted"
            title={`Synced ${new Date(account.syncedAt).toLocaleString('en-US')}`}
          >
            {account.credits} credits · {account.plan}
          </span>
        ) : (
          <span className="glass-chip px-3 py-1.5 text-[11.5px] text-os-dim">Higgsfield not synced</span>
        )}

        {director && (
          <button
            type="button"
            onClick={() => setPanelAgentId(director.id)}
            className="glass-chip flex items-center gap-2 py-1 pl-1 pr-3 text-[12px] text-os-muted transition-colors hover:text-os-text"
          >
            <AgentAvatar src={avatarSrc} name={director.name} size={24} />
            <span className="font-medium text-os-text">{director.name}</span>
            <span className="text-os-dim">creative director</span>
            <Dot state={director.status === 'active' ? 'ok' : 'available'} pulse={director.status === 'active'} />
          </button>
        )}
      </div>

      {panelAgent && (
        <AgentPanel
          agent={panelAgent}
          allAgents={allAgents}
          avatars={avatars}
          departments={departments}
          skills={skills}
          runs={runsByAgent[panelAgent.id] ?? []}
          onClose={() => setPanelAgentId(null)}
          onSelectAgent={(id) => setPanelAgentId(id)}
        />
      )}
    </div>
  );
}
