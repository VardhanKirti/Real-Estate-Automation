'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  AudioLines,
  Eraser,
  Film,
  FolderTree,
  Image as ImageIcon,
  Maximize2,
  Megaphone,
  Scissors,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wand2,
} from 'lucide-react';
import { Dot } from '@/components/terminal';
import { requestCompose } from '@/lib/content-compose';
import type { ProductionTask, TaskType } from '@/lib/content-schema';
import type { Campaign } from '@/lib/content-campaigns';
import {
  buildRenderingItems,
  formatTimestamp,
  groupDeliveredTasks,
  isVideoRef,
  modelDisplayName,
  specDigest,
  taskSpecOrFallback,
  TASK_TYPE_TOOL_KEY,
  upscaleSpec,
  type PipelineNodeStatus,
} from '@/lib/content-feed';
import { AddToCampaignVerb, VerbButton } from '@/components/content/ActionRow';
import { HoverVideo } from '@/components/content/MediaPreview';
import { MediaDetailOverlay } from '@/components/content/MediaDetail';

const TYPE_ICON: Record<TaskType, typeof ImageIcon> = {
  thumbnail: ImageIcon,
  clips: Scissors,
  upscale: Maximize2,
  'ad-variants': Megaphone,
  'bg-removal': Eraser,
  image: ImageIcon,
  video: Film,
  avatar: UserRound,
  enhance: Wand2,
  speak: AudioLines,
  ads: Megaphone,
};

const STATUS_DOT: Record<ProductionTask['status'], string> = {
  queued: 'available',
  generating: 'warn',
  delivered: 'ok',
  blocked: 'off',
};

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg-t border border-dashed border-os-border px-5 py-8 text-center text-[13px] text-os-muted">
      {children}
    </p>
  );
}

/**
 * The redesigned production surface: a rendering strip of active work
 * (queued/generating/blocked, pipeline runs collapsed to one card) flowing
 * into a delivered feed grouped into sessions, each card carrying the tight
 * four-verb row (Upscale, Vary, Reuse settings, Add to campaign). Statuses
 * come straight from the resolved `tasks` prop — no progress theater.
 */
export function Production({ tasks, campaigns }: { tasks: ProductionTask[]; campaigns: Campaign[] }) {
  const router = useRouter();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? id;

  async function cancelTask(id: string) {
    if (!window.confirm('Cancel this queued task? This cannot be undone.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/content/queue/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (openTaskId === id) setOpenTaskId(null);
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        window.alert(typeof body?.error === 'string' ? body.error : 'Could not cancel this task.');
      }
    } finally {
      setBusyId(null);
    }
  }

  async function addToCampaign(id: string, campaignId: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/content/queue/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        window.alert(typeof body?.error === 'string' ? body.error : 'Could not update the campaign.');
      }
    } finally {
      setBusyId(null);
    }
  }

  function upscale(task: ProductionTask) {
    requestCompose({
      toolKey: 'enhance',
      spec: upscaleSpec(task),
      title: `Upscale — ${task.title}`,
      campaignId: task.campaignId,
    });
  }

  function vary(task: ProductionTask) {
    requestCompose({
      toolKey: TASK_TYPE_TOOL_KEY[task.type],
      spec: taskSpecOrFallback(task),
      title: `${task.title} — variation`,
      campaignId: task.campaignId,
    });
  }

  function reuseSettings(task: ProductionTask) {
    requestCompose({
      toolKey: TASK_TYPE_TOOL_KEY[task.type],
      spec: { ...taskSpecOrFallback(task), prompt: '' },
      title: task.title,
      campaignId: task.campaignId,
    });
  }

  if (tasks.length === 0) {
    return <EmptyNote>Nothing queued — pick something from Create above</EmptyNote>;
  }

  const items = buildRenderingItems(tasks);
  const groups = groupDeliveredTasks(tasks);
  const openTask = openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Zone A — rendering strip: active work, pipeline runs collapse to one card. */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="glass-label">
            Runs on Higgsfield — queued tasks are picked up by the operator; outputs land in the delivered feed
          </span>
          {items.length > 0 && (
            <span className="font-mono text-[11px] tabular-nums text-os-dim">{items.length} active</span>
          )}
        </div>
        {items.length === 0 ? (
          <EmptyNote>Nothing rendering right now</EmptyNote>
        ) : (
          <div className="flex flex-wrap gap-3">
            {items.map((item) =>
              item.kind === 'task' ? (
                <TaskCard
                  key={item.task.id}
                  task={item.task}
                  campaignName={campaignName(item.task.campaignId)}
                  busy={busyId === item.task.id}
                  onCancel={() => cancelTask(item.task.id)}
                />
              ) : (
                <PipelineCard key={item.pipelineId} pipelineId={item.pipelineId} nodes={item.nodes} />
              ),
            )}
          </div>
        )}
      </div>

      {/* Zone B — delivered feed: session-grouped, output-first, four verbs. */}
      <div>
        <div className="mb-3">
          <span className="glass-label">Delivered</span>
        </div>
        {groups.length === 0 ? (
          <EmptyNote>No delivered work yet — queued jobs land here once fulfilled</EmptyNote>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="text-[12.5px] font-medium text-os-muted">{group.label}</span>
                  <span className="c-chip">{group.tasks.length}</span>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.tasks.map((task) => (
                    <DeliveredCard
                      key={task.id}
                      task={task}
                      campaigns={campaigns}
                      busy={busyId === task.id}
                      onOpen={() => setOpenTaskId(task.id)}
                      onUpscale={() => upscale(task)}
                      onVary={() => vary(task)}
                      onReuse={() => reuseSettings(task)}
                      onAddToCampaign={(campaignId) => addToCampaign(task.id, campaignId)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openTask && openTask.outputRef && (
        <MediaDetailOverlay
          title={openTask.title}
          outputRef={openTask.outputRef}
          kind={isVideoRef(openTask.outputRef) ? 'video' : 'image'}
          spec={openTask.spec}
          model={openTask.model}
          createdAt={openTask.createdAt}
          campaignName={campaignName(openTask.campaignId)}
          credits={openTask.creditEstimate}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  campaignName,
  busy,
  onCancel,
}: {
  task: ProductionTask;
  campaignName: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const Icon = TYPE_ICON[task.type];
  const digest = specDigest(task);
  return (
    <div className="glass-panel flex w-full max-w-xs flex-col gap-2.5 p-4 sm:w-72">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-os-dim" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">{task.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="glass-chip px-2 py-0.5 font-mono text-[10.5px] text-os-muted">
          {modelDisplayName(task.model)}
        </span>
        {digest && <span className="font-mono text-[11px] text-os-dim">{digest}</span>}
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-os-muted">
        <span className="truncate">{campaignName}</span>
        <span className="shrink-0 font-mono tabular-nums">~{task.creditEstimate} cr</span>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-2.5">
        <span className="flex items-center gap-2">
          <Dot state={STATUS_DOT[task.status]} />
          <span className="text-[11.5px] text-os-muted">{task.status}</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel task"
          title="Cancel task"
          className="shrink-0 rounded-md-t p-1.5 text-os-dim transition-colors hover:text-os-err disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}

function PipelineCard({ pipelineId, nodes }: { pipelineId: string; nodes: PipelineNodeStatus[] }) {
  return (
    <div className="glass-panel flex w-full max-w-xs flex-col gap-2.5 p-4 sm:w-72">
      <div className="flex items-center gap-2">
        <FolderTree className="h-4 w-4 shrink-0 text-os-dim" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">Pipeline · {pipelineId}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {nodes.map((n) => (
          <li key={n.taskId} className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="flex min-w-0 items-center gap-2">
              <Dot state={STATUS_DOT[n.status]} />
              <span className="truncate text-os-muted">{n.title}</span>
            </span>
            {n.status === 'blocked' && n.waitingOn && (
              <span className="shrink-0 truncate text-os-dim">waiting on {n.waitingOn}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeliveredCard({
  task,
  campaigns,
  busy,
  onOpen,
  onUpscale,
  onVary,
  onReuse,
  onAddToCampaign,
}: {
  task: ProductionTask;
  campaigns: Campaign[];
  busy: boolean;
  onOpen: () => void;
  onUpscale: () => void;
  onVary: () => void;
  onReuse: () => void;
  onAddToCampaign: (campaignId: string) => void;
}) {
  if (!task.outputRef) return null;
  const video = isVideoRef(task.outputRef);
  return (
    <div className="glass-panel hoverable flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-video bg-black/30">
          {video ? (
            <HoverVideo src={task.outputRef} className="h-full w-full object-cover" />
          ) : (
            <Image
              src={task.outputRef}
              alt={task.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
            />
          )}
        </div>
      </button>
      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <button type="button" onClick={onOpen} className="text-left">
          <span className="block truncate text-[12.5px] text-os-text">{task.title}</span>
          <span className="mt-0.5 block font-mono text-[10.5px] text-os-dim">{formatTimestamp(task.createdAt)}</span>
        </button>
        <span className="glass-chip self-start px-2 py-0.5 font-mono text-[10.5px] text-os-muted">
          {modelDisplayName(task.model)}
        </span>
        <div className="mt-auto grid grid-cols-4 gap-1.5 pt-1">
          <VerbButton icon={Maximize2} label="Upscale" onClick={onUpscale} disabled={busy} />
          <VerbButton icon={Shuffle} label="Vary" onClick={onVary} disabled={busy} />
          <VerbButton icon={SlidersHorizontal} label="Reuse settings" onClick={onReuse} disabled={busy} />
          <AddToCampaignVerb campaigns={campaigns} disabled={busy} onPick={onAddToCampaign} />
        </div>
      </div>
    </div>
  );
}
