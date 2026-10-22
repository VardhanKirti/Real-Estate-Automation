import { getDb } from '@/lib/data';
import { resolveRange } from '@/lib/tasks-metrics';

export const dynamic = 'force-dynamic';

const cell = (v: string | null): string => {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the tasks in the selected window — the reference's Export button. */
export async function GET(request: Request) {
  const range = resolveRange(new URL(request.url).searchParams.get('range'));
  const db = getDb();
  const names = new Map(db.agents.all().map((a) => [a.id, a.name]));
  const from = Date.now() - range.days * 86_400_000;

  const rows = db.agentTasks
    .all()
    .filter((t) => new Date(t.createdAt).getTime() >= from)
    .map((t) =>
      [
        t.id, t.title, t.status, t.priority, t.ownerKind,
        t.agentId ? names.get(t.agentId) ?? t.agentId : 'You',
        t.horizon, t.dueAt, t.createdAt, t.updatedAt, t.detail,
      ]
        .map((v) => cell(v == null ? '' : String(v)))
        .join(','),
    );

  const header = 'id,title,status,priority,owner,assignee,horizon,due_at,created_at,updated_at,detail';
  return new Response([header, ...rows].join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tasks-${range.id}.csv"`,
    },
  });
}
