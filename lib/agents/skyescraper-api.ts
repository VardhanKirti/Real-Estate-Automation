/**
 * Thin, typed call layer over the real Skyescraper REST API — every read AND
 * every write the four LangGraph agents (lib/agents/sky-agents.ts) can make.
 *
 * Why no direct database access: the earlier n8n version of these agents used
 * a read-only MySQL credential for reads. Rebuilding on LangGraph dropped
 * that in favour of calling Skyescraper's own listing endpoints instead —
 * one fewer credential this app has to hold, and reads now get exactly the
 * same validation/shaping the CRM's own UI gets. Writes already went through
 * the API only; that rule is unchanged.
 *
 * Every write function returns a plain, honest result: { ok: true, data } or
 * { ok: false, error }. Agents are told, in their system prompt, to never
 * claim success except when `ok` is actually true — this is what makes that
 * rule checkable instead of just requested.
 */
import { skyescraperConfig } from '@/lib/real-estate-live';

type ApiEnvelope<T> = { status?: number | boolean; message?: string; data?: T };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
  const cfg = skyescraperConfig();
  if (!cfg) return { ok: false, error: 'SKYESCRAPER_API_TOKEN is not set in .env.local' };
  try {
    const res = await fetch(`${cfg.baseUrl}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!res.ok) return { ok: false, error: json.message ?? `Skyescraper HTTP ${res.status}` };
    return { ok: true, data: (json.data as T) ?? (undefined as T) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const sky = {
  // Reads
  leadListing: (body: { page_no: number; limit?: number; search_key?: string }) =>
    call<{ current_page: number; total: number; leads: unknown[] }>('POST', 'lead/listing', body),
  projectListing: (body: { page_no: number; limit?: number; search_key?: string }) =>
    call<{ current_page: number; total: number; projects: unknown[] }>('POST', 'project/listing', body),
  /** Not a plain paginated list — Skyescraper stores a project's units as a
   *  spreadsheet import, so this returns one "sheet" per project: dynamic
   *  `headers`/`heading` columns plus `records` (raw rows), each row carrying
   *  an injected `__unit_status` (Available/Held/Sold). There is no fixed
   *  unit_number/status_id field — whatever columns that project's sheet was
   *  imported with are what's there. Only `project_id` is accepted. */
  unitListing: (body: { project_id: number }) => call<Record<string, { id: number; project_id: number; headers: string[]; heading: string[]; records: Record<string, unknown>[] }>>('POST', 'unit/listing', body),
  reminderListing: (body: { page_no: number; lead_id: number; limit?: number; search_key?: string }) =>
    call<{ current_page: number; total: number; reminders: unknown[] }>('POST', 'reminder/listing', body),
  leadNoteListing: (body: { page_no: number; lead_id: number; limit?: number; search_key?: string }) =>
    call<{ current_page: number; total: number; notes: unknown[] }>('POST', 'lead-notes/listing', body),
  projectNoteListing: (body: { page_no: number; project_id: number; limit?: number; search_key?: string }) =>
    call<{ current_page: number; total: number; notes: unknown[] }>('POST', 'project-notes/listing', body),
  /** DataTables-shaped, unlike every other listing here: start/length/search,
   *  not page_no/limit/search_key. Lists agents (users) created by the
   *  authenticated account. Each row's real id field is `id`, not `encrypt_id`. */
  teamListing: (search?: string) =>
    call<{ id: number; name: string; email: string; role: string; phone: string; status: string }[]>('POST', 'agent/team/listing', {
      start: 0,
      length: 50,
      draw: 1,
      search: { value: search ?? '' },
    }),
  // All under the `common` prefix in Skyescraper's routes, not bare paths.
  leadStages: () => call<{ id: number; name: string; lead_type: string }[]>('GET', 'common/lead_stage'),
  reminderTypes: () => call<{ id: number; name: string }[]>('GET', 'common/reminder-type'),
  reminderPriorities: () => call<{ id: number; name: string }[]>('GET', 'common/reminder-priority'),
  unitStatuses: () => call<{ id: number; status_name: string }[]>('GET', 'common/unit-status'),

  // Writes
  updateLeadStage: (body: { lead_id: number; stage_id: number }) => call('POST', 'lead/update-stage', body),
  assignLeadToAgent: (body: { lead_id: number; agent_id: number }) => call('POST', 'lead/agent-assign', body),
  logLeadActivity: (body: { lead_id: number; activity_type: string; activity: string }) => call('POST', 'lead/activity/save', body),
  updateUnitStatus: (body: { unit_id: number; status: number }) => call('POST', 'unit/status-update', body),
  publishToggleProject: (body: { project_id: number; type?: 'publish' | 'archive' }) =>
    call('POST', 'project/publish-toggle', { project_id: body.project_id, ...(body.type ? { type: body.type } : {}) }),
  createReminder: (body: { lead_id: number; reminder_type_id: number; title: string; description?: string; date: string; time: string; priority_id: number; reminder_id?: number }) =>
    call('POST', 'reminder/save', body),
  addLeadNote: (body: { lead_id: number; note: string; note_id?: number }) => call('POST', 'lead-notes/save', body),
  addProjectNote: (body: { project_id: number; note: string; note_id?: number }) => call('POST', 'project-notes/save', body),
};
