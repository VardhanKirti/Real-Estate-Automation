import { NextResponse } from 'next/server';
import { contentCampaigns } from '@/lib/content-campaigns';
import {
  PatchQueueTaskSchema,
  deleteTask,
  readMediaManifest,
  readQueue,
  resolveTask,
  updateTaskCampaign,
} from '@/lib/content-production';

export const dynamic = 'force-dynamic';

/**
 * Cancels a queued task. Delivered tasks are refused — their output is a
 * real asset in the media library and the row is the provenance for it.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const tasks = readQueue();
  const task = tasks.find((t) => t.id === params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  const resolved = resolveTask(task, readMediaManifest());
  if (resolved.status === 'delivered') {
    return NextResponse.json({ error: 'Delivered tasks cannot be cancelled.' }, { status: 409 });
  }
  const removed = deleteTask(params.id);
  if (!removed) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Re-points a task's campaign — the delivered feed's "Add to campaign"
 * verb. The only field this route touches; everything else about the row
 * (spec, output, credits) is untouched.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = PatchQueueTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A campaignId is required.' }, { status: 400 });
  }
  const validCampaignIds = new Set(contentCampaigns().map((c) => c.id));
  if (!validCampaignIds.has(parsed.data.campaignId)) {
    return NextResponse.json({ error: `Unknown campaign: ${parsed.data.campaignId}` }, { status: 400 });
  }
  const updated = updateTaskCampaign(params.id, parsed.data.campaignId);
  if (!updated) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  return NextResponse.json({ task: updated });
}
