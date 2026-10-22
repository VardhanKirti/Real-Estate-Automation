'use client';

import { useState } from 'react';
import { StudioBar } from '@/components/content/StudioBar';
import { CreateGrid } from '@/components/content/CreateGrid';
import { Composer } from '@/components/content/Composer';
import type { Agent, AgentRun, Department, Skill } from '@/lib/schemas';
import type { Campaign } from '@/lib/content-campaigns';
import type { HiggsfieldAccount } from '@/lib/higgsfield/account';
import type { MediaAsset } from '@/lib/content-schema';
import type { UploadAsset } from '@/lib/content-uploads';

/**
 * Owns the one piece of state the top of the page shares: which campaign is
 * selected. The Studio bar's campaign chips set it; the Composer reads it as
 * the default campaign for a new production — same role the old ContentTop
 * played for DirectorHeader + CreateStudio, now feeding StudioBar + the
 * Composer drawer instead.
 */
export function ContentStudio({
  director,
  avatarSrc,
  allAgents,
  avatars,
  departments,
  skills,
  runsByAgent,
  campaigns,
  defaultCampaignId,
  account,
  libraryAssets,
  uploads,
}: {
  director: Agent | null;
  avatarSrc: string | null;
  allAgents: Agent[];
  avatars: Record<string, string>;
  departments: Department[];
  skills: Skill[];
  runsByAgent: Record<string, AgentRun[]>;
  campaigns: Campaign[];
  defaultCampaignId: string | null;
  account: HiggsfieldAccount | null;
  libraryAssets: MediaAsset[];
  uploads: UploadAsset[];
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    defaultCampaignId ?? campaigns[0]?.id ?? null,
  );

  return (
    <div className="flex flex-col gap-6">
      <StudioBar
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={setSelectedCampaignId}
        account={account}
        director={director}
        avatarSrc={avatarSrc}
        allAgents={allAgents}
        avatars={avatars}
        departments={departments}
        skills={skills}
        runsByAgent={runsByAgent}
      />
      <CreateGrid />
      <Composer
        campaigns={campaigns}
        defaultCampaignId={selectedCampaignId}
        account={account}
        libraryAssets={libraryAssets}
        uploads={uploads}
      />
    </div>
  );
}
