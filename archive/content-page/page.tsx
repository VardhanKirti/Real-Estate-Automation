import { Suspense } from 'react';
import { agentAvatars } from '@/lib/agent-avatars';
import { getDb } from '@/lib/data';
import { activeCampaign, contentCampaigns } from '@/lib/content-campaigns';
import { productionTasks, readMediaManifest } from '@/lib/content-production';
import { readHiggsfieldAccount } from '@/lib/higgsfield/account';
import { readUploads } from '@/lib/content-uploads';
import { readPipelines } from '@/lib/content-pipelines';
import { PipelineBoard } from '@/components/content/PipelineBoard';
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';
import { ContentStudio } from '@/components/content/ContentStudio';
import { RemakeHandoff } from '@/components/content/RemakeHandoff';
import { Production } from '@/components/content/Production';
import { MediaLibrary } from '@/components/content/MediaLibrary';
import { CampaignBoard } from '@/components/content/CampaignBoard';
import type { AgentRun } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

// The panel's run feed only needs the recent tail — same cap as /agents.
const RUNS_PER_AGENT = 20;

export default async function ContentPage() {
  const db = getDb();
  const allAgents = db.agents.all();
  const departments = db.departments.all();
  const skills = db.skills.all();
  const avatarsMap = agentAvatars();
  const avatarsObj = Object.fromEntries(avatarsMap);

  const runsByAgent: Record<string, AgentRun[]> = {};
  for (const agent of allAgents) {
    runsByAgent[agent.id] = db.agentRuns.byAgent(agent.id).slice(0, RUNS_PER_AGENT);
  }

  const campaigns = contentCampaigns();
  const campaign = activeCampaign();
  const manifest = readMediaManifest();
  const tasks = productionTasks(manifest);
  const account = readHiggsfieldAccount();
  const uploads = readUploads();
  const pipelines = readPipelines();

  return (
    <div>
      {/* AdPilot -> Composer hand-off (?remake=1 + sessionStorage payload) */}
      <Suspense fallback={null}>
        <RemakeHandoff />
      </Suspense>
      <PageHeader
        eyebrow="Content production"
        title="Content"
        right={<Badge tone="accent">{campaigns.length} campaigns</Badge>}
      />

      {/* Studio bar (campaign switcher · credits · director) + the tool grid
          + the Composer drawer, all wired to one shared "selected campaign"
          state. The Composer mounts once here and opens via the compose bus
          — from a Create tool card, or a Reuse settings / Vary / Upscale
          action on the Production or Library sections below.

          director is null: the live roster has no agent that is honestly a
          creative director (that role belongs to a person — the media lead
          — not an agent record), so StudioBar renders with the director chip
          hidden rather than an invented agent identity. */}
      <ContentStudio
        director={null}
        avatarSrc={null}
        allAgents={allAgents}
        avatars={avatarsObj}
        departments={departments}
        skills={skills}
        runsByAgent={runsByAgent}
        campaigns={campaigns}
        defaultCampaignId={campaign?.id ?? null}
        account={account}
        libraryAssets={manifest.assets}
        uploads={uploads}
      />

      {/* Pipelines — saved media workflows; runs compile into queue tasks */}
      <section className="mt-8">
        <SectionHead label="Pipelines" count={`${pipelines.length}`} />
        <PipelineBoard pipelines={pipelines} tasks={tasks} campaigns={campaigns} />
      </section>

      {/* Production — real tasks in data/content-queue.json, status derived from the manifest */}
      <section className="mt-8">
        <SectionHead label="Production" count={`${tasks.length} tasks`} />
        <Production tasks={tasks} campaigns={campaigns} />
      </section>

      {/* Library — identity assets, delivered renders, and uploads */}
      <section className="mt-8">
        <SectionHead label="Library" count={`${manifest.assets.length} assets`} />
        <MediaLibrary manifest={manifest} tasks={tasks} account={account} uploads={uploads} />
      </section>

      {/* Campaign board — real, verbatim-from-brief sponsor campaigns */}
      <section className="mt-10">
        <SectionHead label="Campaigns" count={`${campaigns.length}`} />
        <CampaignBoard campaigns={campaigns} />
      </section>
    </div>
  );
}
