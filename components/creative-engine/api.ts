import type { Campaign, ConsoleControls, CreditsSnapshot, Depth, EngineSettings, Framework, ScriptControls, VideoModel, Workflow } from '@/lib/creative-engine/schemas';
import { ENGINE_API } from '@/lib/creative-engine/name';
import type { GraphProblem, NodeStatus, TemplateSummary } from '@/lib/creative-engine/workflow';
import type { Layout, RunScope } from '@/lib/creative-engine/workflow-edit';
import type { RunPlan } from '@/lib/creative-engine/workflow-run';
import type { WorkflowVersion } from '@/lib/creative-engine/store';
import type { AssetResponse, ArcadsSituation } from '@/lib/arcads/client';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import type { Catalog } from '@/lib/arcads/catalog';

/** Thin client for ENGINE_API (/api/creative-engine). Every call returns {ok} or throws with the server's error text. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public kind: string | null, public body: Record<string, unknown>) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; kind?: string };
  if (!res.ok || body.ok === false) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.kind ?? null, body as Record<string, unknown>);
  return body;
}

export type { CampaignSummary } from '@/lib/creative-engine/pick';
import type { CampaignSummary } from '@/lib/creative-engine/pick';

export const api = {
  campaigns: () => call<{ campaigns: CampaignSummary[]; dry: boolean }>(`${ENGINE_API}/campaigns`),
  createCampaign: (concept: Campaign['concept']) => call<{ campaign: Campaign }>(`${ENGINE_API}/campaigns`, { method: 'POST', body: JSON.stringify(concept) }),
  campaign: (id: string) => call<{ campaign: Campaign; runs: ResolvedRun[] }>(`${ENGINE_API}/campaigns/${id}`),
  patchCampaign: (id: string, patch: { selectedAngleIds?: string[]; adsWanted?: number; name?: string }) => call<{ campaign: Campaign }>(`${ENGINE_API}/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCampaign: (id: string) => call<{ ok: true }>(`${ENGINE_API}/campaigns/${id}`, { method: 'DELETE' }),
  research: (campaignId: string, depth: Depth) => call<{ campaign: Campaign }>(`${ENGINE_API}/research`, { method: 'POST', body: JSON.stringify({ campaignId, depth }) }),
  angles: (campaignId: string) => call<{ campaign: Campaign; dropped: number; by: string }>(`${ENGINE_API}/angles`, { method: 'POST', body: JSON.stringify({ campaignId }) }),
  script: (campaignId: string, angleId: string, framework: Framework, controls: Partial<ScriptControls>) => call<{ campaign: Campaign; scriptId: string }>(`${ENGINE_API}/scripts`, { method: 'POST', body: JSON.stringify({ campaignId, angleId, framework, controls }) }),
  patchScript: (scriptId: string, body: Record<string, unknown>) => call<{ campaign: Campaign }>(`${ENGINE_API}/scripts/${scriptId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  brief: (campaignId: string, scriptId: string) => call<{ campaign: Campaign; briefId: string }>(`${ENGINE_API}/briefs`, { method: 'POST', body: JSON.stringify({ campaignId, scriptId }) }),
  patchBrief: (id: string, body: { status: 'draft' | 'ready' | 'sent' }) => call<{ campaign: Campaign }>(`${ENGINE_API}/briefs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  catalog: (refresh = false) => call<Catalog & { setupHref: string }>(`${ENGINE_API}/arcads/catalog${refresh ? '?refresh=1' : ''}`),
  health: () => call<HealthSnapshot>(`${ENGINE_API}/arcads/health`),
  probe: () => call<{ health: HealthMap; credits: CreditsSnapshot | null }>(`${ENGINE_API}/arcads/health`, { method: 'POST' }),
  probeModel: (model: VideoModel, override = false) => call<{ runId: string; health: HealthMap }>(`${ENGINE_API}/arcads/health`, { method: 'POST', body: JSON.stringify({ model, override }) }),
  setup: () => call<SetupState>(`${ENGINE_API}/arcads/setup`),
  setupAction: (body: { action: 'verify' } | { action: 'product'; productId: string; productName: string } | { action: 'createProduct'; name: string; description: string } | { action: 'settings'; ugcPath?: 'v2' | 'v1'; sessionCreditCap?: number; sessionStartedAt?: string | null } | { action: 'newSession' }) => call<{ health?: HealthMap; credits?: CreditsSnapshot | null; settings?: EngineSettings; product?: { id: string; name: string } }>(`${ENGINE_API}/arcads/setup`, { method: 'POST', body: JSON.stringify(body) }),
  connectKey: (slug: 'arcads' | 'foreplay', values: Record<string, string>) => call<{ keySaved: boolean }>('/api/connections/connect', { method: 'POST', body: JSON.stringify({ slug, values }) }),
  ugc: (body: { campaignId: string; scriptId: string; situationId: string; voiceId?: string | null; productId?: string | null; override?: boolean }) => call<{ generationId: string; runId: string }>(`${ENGINE_API}/arcads/ugc`, { method: 'POST', body: JSON.stringify(body) }),
  motion: (body: { campaignId: string; controls: Partial<ConsoleControls>; productId?: string | null; scriptId?: string | null; override?: boolean }) => call<{ generationId: string | null; runIds: string[]; submitted: string[]; failed: { runId: string; kind: string; reason: string }[]; prompt: string }>(`${ENGINE_API}/arcads/motion`, { method: 'POST', body: JSON.stringify(body) }),
  runs: (campaignId?: string | null) => call<{ runs: ResolvedRun[]; advanced: number }>(`${ENGINE_API}/runs${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`),
  abandon: (id: string) => call<{ ok: true }>(`${ENGINE_API}/runs/${id}/abandon`, { method: 'POST' }),
  workflows: (campaignId: string) => call<{ workflows: Workflow[]; templates: TemplateSummary[]; approvedScript: boolean; dry: boolean }>(`${ENGINE_API}/workflows?campaignId=${encodeURIComponent(campaignId)}`),
  createWorkflow: (body: { campaignId: string; name?: string; template?: string }) => call<{ workflow: Workflow }>(`${ENGINE_API}/workflows`, { method: 'POST', body: JSON.stringify(body) }),
  workflow: (id: string) => call<WorkflowView>(`${ENGINE_API}/workflows/${id}`),
  patchWorkflow: (id: string, body: { name?: string; layout?: Layout; baseUpdatedAt?: string; force?: boolean; reset?: boolean; restoreRunSnapshot?: boolean }, init?: RequestInit) => call<WorkflowView>(`${ENGINE_API}/workflows/${id}`, { ...init, method: 'PATCH', body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) => call<{ ok: true }>(`${ENGINE_API}/workflows/${id}`, { method: 'DELETE' }),
  runWorkflow: (id: string, opts: { override?: boolean; scope?: RunScope; nodeId?: string | null } = {}) => call<{ workflow: Workflow; status: Record<string, NodeStatus>; problems: GraphProblem[] }>(`${ENGINE_API}/workflows/${id}/run`, { method: 'POST', body: JSON.stringify(opts) }),
  planWorkflow: (id: string, scope: RunScope = 'all', nodeId?: string | null) => call<{ plan: RunPlan }>(`${ENGINE_API}/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ dryRunPlan: true, scope, nodeId: nodeId ?? null }) }),
  stopWorkflow: (id: string) => call<WorkflowView>(`${ENGINE_API}/workflows/${id}/stop`, { method: 'POST' }),
  workflowVersions: (id: string) => call<{ versions: WorkflowVersion[] }>(`${ENGINE_API}/workflows/${id}/versions`),
  saveWorkflowVersion: (id: string, note?: string) => call<{ version: WorkflowVersion; versions: WorkflowVersion[] }>(`${ENGINE_API}/workflows/${id}/versions`, { method: 'POST', body: JSON.stringify({ note }) }),
  restoreWorkflowVersion: (id: string, n: number) => call<WorkflowView>(`${ENGINE_API}/workflows/${id}/versions/${n}/restore`, { method: 'POST' }),
  duplicateWorkflow: (id: string) => call<{ workflow: Workflow }>(`${ENGINE_API}/workflows/${id}/duplicate`, { method: 'POST' }),
  library: (q: { q?: string; kind?: 'video' | 'photo' } = {}) => call<{ count: number; items: AssetResponse[]; state: string }>(`${ENGINE_API}/arcads/assets?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>)}`),
  presetTemplates: (type: string) => call<{ templates: ArcadsSituation[]; state: string }>(`${ENGINE_API}/arcads/presets?type=${encodeURIComponent(type)}`),
  presets: () => call<{ presets: { id: string; name: string; builtin: boolean; controls: Partial<ConsoleControls> }[] }>(`${ENGINE_API}/presets`),
  savePreset: (name: string, controls: Partial<ConsoleControls>) => call<{ preset: { id: string } }>(`${ENGINE_API}/presets`, { method: 'POST', body: JSON.stringify({ name, controls }) }),
  deletePreset: (id: string) => call<{ ok: true }>(`${ENGINE_API}/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** stat a host-local reference path: exists, kind from the extension, size (S05a FR-10) */
  checkAsset: (p: string) => call<{ exists: boolean; kind: 'image' | 'video' | 'audio' | null; bytes: number | null }>(`${ENGINE_API}/arcads/assets?check=${encodeURIComponent(p)}`),
};

/** Moved to lib/creative-engine/schemas.ts in S02 phase B (lib must not import a component); re-exported for the UI. */
export type { HealthMap, HealthSnapshot } from '@/lib/creative-engine/schemas';
import type { HealthMap, HealthSnapshot } from '@/lib/creative-engine/schemas';

export type SetupState = { ok: true; dry: boolean; configured: boolean; health: HealthMap; balance: CreditsSnapshot | null; products: { id: string; name: string; description?: string }[]; productsError: string | null; settings: EngineSettings };

export type WorkflowView = { ok: true; workflow: Workflow; status: Record<string, NodeStatus>; problems: GraphProblem[]; runs: ResolvedRun[] };
