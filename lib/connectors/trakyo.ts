/**
 * Trakyo connector: organic attribution (content → clicks → visits → forms →
 * bookings → revenue). Trakyo API v1 is live (memory `os-merge-founderos`;
 * OpenAPI at https://api.trakyo.io/openapi.json). The old "no API yet" claim
 * here was stale and is gone (FounderOS merge, pages/feature-additions.md F6).
 *
 *   Base URL  https://api.trakyo.io/v1
 *   Auth      Authorization: Bearer tky_live_…  (scoped keys: a valid key
 *             without an endpoint's scope answers 403, which surfaces as an
 *             honest `error` naming the scope, never as connected)
 *   Agencies  X-Trakyo-Account: <id> on reads (TRAKYO_ACCOUNT_ID, optional)
 *
 * Reads (status, the link workspace) are free GETs. Writes (create content,
 * create link) spend nothing but publish a public short link, so they are only
 * reachable through POST /api/trakyo/links behind GLADOS_WRITES=1 and an
 * explicit confirm. Ported from FounderOS v2 `connectors/trakyo/links.go` and
 * the 2026-10-06 parts bin. fetch is injectable for offline tests.
 */
import { resolveCred, CRED_FILES } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';

const KEY = 'TRAKYO_API_KEY';
const ACCOUNT = 'TRAKYO_ACCOUNT_ID';
export const TRAKYO_API = 'https://api.trakyo.io/v1';

type Fetch = typeof fetch;

export function trakyoKey(): string | undefined {
  return resolveCred(KEY, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

function trakyoAccount(): string | undefined {
  return resolveCred(ACCOUNT, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

/** A Trakyo call that failed, worded for the person pressing the button.
 *  `uncertain` marks a write whose outcome is unknown: do not retry blindly. */
export class TrakyoError extends Error {
  constructor(message: string, public status: number, public uncertain = false) {
    super(message);
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Trakyo rejected these fields. Check the URL, content and slug.',
  401: 'Trakyo rejected the API key. Reconnect it in Integrations.',
  404: 'The selected Trakyo item no longer exists. Refresh the list.',
  409: 'That slug or item already exists. Choose another slug or use the existing item.',
  429: 'Trakyo rate limit reached. Wait before retrying.',
};

async function request(path: string, opts: { scope?: string; body?: unknown; fetchFn?: Fetch; key?: string } = {}): Promise<unknown> {
  const key = opts.key ?? trakyoKey();
  if (!key) throw new TrakyoError('Connect Trakyo in Integrations first.', 503);
  const write = opts.body !== undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const account = trakyoAccount();
  if (account && !write) headers['X-Trakyo-Account'] = account;
  if (write) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)(`${TRAKYO_API}/${path}`, {
      method: write ? 'POST' : 'GET',
      headers,
      body: write ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    if (write) throw new TrakyoError('Result unconfirmed. Check Trakyo before retrying; the item may have been created.', 502, true);
    throw new TrakyoError('Trakyo is unreachable. Try again shortly.', 502);
  }
  if (!res.ok) {
    let msg = STATUS_MESSAGES[res.status];
    if (res.status === 403) msg = `The Trakyo key needs ${opts.scope ?? 'another scope'}. Enable that scope in Trakyo.`;
    if (!msg) msg = write ? 'Result unconfirmed. Check Trakyo before retrying.' : `Trakyo returned HTTP ${res.status}.`;
    throw new TrakyoError(msg, res.status >= 500 ? 502 : res.status, write && res.status >= 500);
  }
  try {
    return await res.json();
  } catch {
    if (write) throw new TrakyoError('Result unconfirmed. Check Trakyo before retrying.', 502, true);
    throw new TrakyoError('Trakyo returned unreadable data.', 502);
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return 0;
};

/* ── status: GET /v1/metrics ─────────────────────────────────────────── */

export type TrakyoMetrics = { clicks: number; visits: number; formSubmissions: number; bookings: number; revenueUsd: number };

/** Null when the payload has no totals: the caller says so, nothing is invented. */
export function parseTrakyoMetrics(raw: unknown): TrakyoMetrics | null {
  const t = obj(obj(raw)?.totals);
  if (!t) return null;
  return { clicks: num(t.clicks), visits: num(t.visits), formSubmissions: num(t.form_submissions), bookings: num(t.bookings), revenueUsd: num(t.revenue) };
}

export async function trakyoStatus(fetchFn: Fetch = fetch): Promise<ConnectorStatus> {
  const base = { id: 'trakyo', name: 'Trakyo', kind: 'crm' } as const;
  if (!trakyoKey()) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Funnel source: content → clicks → visits → forms → bookings → revenue. Set TRAKYO_API_KEY (Trakyo, Settings, API keys).',
    };
  }
  try {
    const m = parseTrakyoMetrics(await request('metrics', { fetchFn, scope: 'metrics:read' }));
    if (!m) throw new TrakyoError('the metrics response carried no totals', 502);
    const money = m.revenueUsd > 0 ? ` · $${Math.round(m.revenueUsd).toLocaleString('en-US')} revenue` : '';
    return {
      ...base,
      state: 'connected',
      detail: `Trakyo API v1 · ${m.clicks} clicks · ${m.visits} visits · ${m.formSubmissions} forms · ${m.bookings} bookings${money}`,
      meta: { clicks: m.clicks, visits: m.visits, formSubmissions: m.formSubmissions, bookings: m.bookings, revenueUsd: m.revenueUsd },
    };
  } catch (err) {
    return { ...base, state: 'error', detail: `TRAKYO_API_KEY is set but the Trakyo API call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ── link studio reads: GET keys/self, domains, links ─────────────────── */

export type TrakyoDomain = { id: string; hostname: string };
export type TrakyoLink = { key: string; url: string; shortLink: string; domainId: string; contentItemId: string | null; clicks: number };
export type TrakyoLinkWorkspace = {
  state: 'ready' | 'partial' | 'not_configured' | 'error';
  scopes: string[];
  domains: TrakyoDomain[];
  links: TrakyoLink[];
  hasMore: boolean;
  messages: string[];
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A public http(s) URL without credentials, at most 4096 chars. */
export function publicHttpUrl(s: string): boolean {
  if (s.length > 4096) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.host) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function parseTrakyoLink(raw: unknown): TrakyoLink | null {
  const f = obj(raw);
  if (!f) return null;
  const key = typeof f.key === 'string' ? f.key : null;
  const url = typeof f.url === 'string' && publicHttpUrl(f.url) ? f.url : null;
  const shortLink = typeof f.short_link === 'string' && publicHttpUrl(f.short_link) ? f.short_link : null;
  const domainId = typeof f.domain_id === 'string' && UUID_RE.test(f.domain_id) ? f.domain_id : null;
  if (!key || !url || !shortLink || !domainId) return null;
  return { key, url, shortLink, domainId, contentItemId: typeof f.content_item_id === 'string' ? f.content_item_id : null, clicks: num(f.clicks) };
}

function dataRows(raw: unknown): unknown[] {
  const d = obj(raw)?.data;
  if (!Array.isArray(d)) throw new TrakyoError('Trakyo returned unreadable data.', 502);
  return d;
}

/** Scopes, domains and the first 100 saved links. Each part fails on its own. */
export async function trakyoLinkWorkspace(fetchFn: Fetch = fetch): Promise<TrakyoLinkWorkspace> {
  const out: TrakyoLinkWorkspace = { state: 'not_configured', scopes: [], domains: [], links: [], hasMore: false, messages: [] };
  if (!trakyoKey()) return out;
  try {
    const self = obj(await request('keys/self', { fetchFn }));
    if (!self || !Array.isArray(self.scopes)) throw new TrakyoError('Could not read Trakyo permissions.', 502);
    out.scopes = self.scopes.filter((s): s is string => typeof s === 'string');
  } catch (err) {
    return { ...out, state: 'error', messages: [err instanceof Error ? err.message : String(err)] };
  }
  out.state = 'ready';
  if (!out.scopes.includes('links:read')) {
    return { ...out, state: 'partial', messages: ['Enable links:read in Trakyo to list domains and saved links.'] };
  }
  const [domains, links] = await Promise.allSettled([request('domains', { fetchFn, scope: 'links:read' }), request('links?limit=100', { fetchFn, scope: 'links:read' })]);
  if (domains.status === 'fulfilled') {
    try {
      for (const r of dataRows(domains.value)) {
        const f = obj(r);
        if (f && typeof f.id === 'string' && UUID_RE.test(f.id) && typeof f.hostname === 'string') out.domains.push({ id: f.id, hostname: f.hostname });
      }
    } catch (err) {
      out.state = 'partial';
      out.messages.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    out.state = 'partial';
    out.messages.push(domains.reason instanceof Error ? domains.reason.message : 'Could not read Trakyo domains.');
  }
  if (links.status === 'fulfilled') {
    try {
      for (const r of dataRows(links.value)) {
        const l = parseTrakyoLink(r);
        if (l) out.links.push(l);
      }
      out.hasMore = obj(links.value)?.has_more === true;
    } catch (err) {
      out.state = 'partial';
      out.messages.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    out.state = 'partial';
    out.messages.push(links.reason instanceof Error ? links.reason.message : 'Could not read Trakyo links.');
  }
  return out;
}

/* ── writes: POST /content, POST /links (gated by the route) ─────────── */

export type TrakyoContentInput = { source: string; name: string; description?: string; url?: string; publishedAt?: string };
export type TrakyoLinkInput = { url: string; contentItemId: string; domain?: string; slug?: string; appendTrackingParam?: boolean };
export type TrakyoCreatedContent = { id: string; name: string; source: string; type: string };

export class TrakyoValidationError extends Error {
  constructor(public field: string, reason: string) {
    super(`${field}: ${reason}`);
  }
}

export function validateTrakyoContent(input: TrakyoContentInput): TrakyoContentInput {
  const source = input.source?.trim() ?? '';
  const name = input.name?.trim() ?? '';
  const lower = source.toLowerCase();
  if (!source || source.length > 200) throw new TrakyoValidationError('source', 'must be 1 to 200 characters');
  if (lower === 'youtube' || lower === 'other' || /^\d+$/.test(source)) throw new TrakyoValidationError('source', 'choose a custom source such as Instagram');
  if (!name || name.length > 500) throw new TrakyoValidationError('name', 'must be 1 to 500 characters');
  if ((input.description ?? '').length > 5000) throw new TrakyoValidationError('description', 'must be at most 5000 characters');
  if (input.url && !publicHttpUrl(input.url)) throw new TrakyoValidationError('url', 'use a public http or https URL without credentials');
  if (input.publishedAt && !(Number.isFinite(Date.parse(input.publishedAt)) && input.publishedAt.endsWith('Z'))) {
    throw new TrakyoValidationError('publishedAt', 'must be an ISO datetime in UTC');
  }
  return { ...input, source, name };
}

export function validateTrakyoLink(input: TrakyoLinkInput): TrakyoLinkInput {
  const slug = input.slug?.trim() || undefined;
  if (!publicHttpUrl(input.url ?? '')) throw new TrakyoValidationError('url', 'use a public http or https URL without credentials');
  if (!/^ci_[A-Za-z0-9_-]+$/.test(input.contentItemId ?? '')) throw new TrakyoValidationError('contentItemId', 'must be a Trakyo content id (ci_…)');
  if (input.domain && !UUID_RE.test(input.domain)) throw new TrakyoValidationError('domain', 'must be a domain id');
  if (slug && (slug.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(slug))) throw new TrakyoValidationError('slug', 'letters, digits, _ and - only');
  return { ...input, slug, appendTrackingParam: input.appendTrackingParam ?? true };
}

/** POST /content (scope content:write). Validated before anything is sent. */
export async function createTrakyoContent(input: TrakyoContentInput, fetchFn: Fetch = fetch): Promise<TrakyoCreatedContent> {
  const v = validateTrakyoContent(input);
  const raw = obj(
    await request('content', {
      fetchFn,
      scope: 'content:write',
      body: { source: v.source, name: v.name, ...(v.description ? { description: v.description } : {}), ...(v.url ? { url: v.url } : {}), ...(v.publishedAt ? { published_at: v.publishedAt } : {}) },
    }),
  );
  const out = { id: raw?.id, name: raw?.name, source: raw?.source, type: raw?.type };
  if (typeof out.id !== 'string' || !out.id.startsWith('ci_') || typeof out.name !== 'string' || typeof out.source !== 'string' || typeof out.type !== 'string') {
    throw new TrakyoError('Result unconfirmed. Check Trakyo before retrying.', 502, true);
  }
  return out as TrakyoCreatedContent;
}

/** POST /links (scope links:write). Validated before anything is sent. */
export async function createTrakyoLink(input: TrakyoLinkInput, fetchFn: Fetch = fetch): Promise<TrakyoLink> {
  const v = validateTrakyoLink(input);
  const link = parseTrakyoLink(
    await request('links', {
      fetchFn,
      scope: 'links:write',
      body: { url: v.url, content_item_id: v.contentItemId, ...(v.domain ? { domain: v.domain } : {}), ...(v.slug ? { slug: v.slug } : {}), append_tracking_param: v.appendTrackingParam },
    }),
  );
  if (!link) throw new TrakyoError('Result unconfirmed. Check Trakyo before retrying.', 502, true);
  return link;
}

/* ── funnel touches: GET /v1/leads (FounderOS merge F7) ──────────────── */

export type TrakyoTouchType = 'youtube' | 'custom' | 'meta_ad' | 'instagram' | 'referrer' | 'other';
/** A lead's first or last attributed touch, as /v1/leads reports it. */
export type TrakyoTouch = { type: TrakyoTouchType; name: string; sourceName: string | null; occurredAt: string };
export type TrakyoLead = {
  id: string;
  createdAt: string;
  names: string[];
  emails: string[];
  hasBooking: boolean;
  hasTransaction: boolean;
  firstTouch: TrakyoTouch | null;
};

const TOUCH_TYPES = new Set<TrakyoTouchType>(['youtube', 'custom', 'meta_ad', 'instagram', 'referrer', 'other']);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

function parseTouch(v: unknown): TrakyoTouch | null {
  const t = obj(v);
  const occurredAt = text(t?.occurred_at);
  if (!t || !occurredAt || !Number.isFinite(Date.parse(occurredAt))) return null;
  return {
    type: TOUCH_TYPES.has(t.type as TrakyoTouchType) ? (t.type as TrakyoTouchType) : 'other',
    name: text(t.name),
    sourceName: text(t.source_name) || null,
    occurredAt,
  };
}

/** One /v1/leads row, or null when it has no id. Unknown fields are ignored, never guessed. */
export function parseTrakyoLead(v: unknown): TrakyoLead | null {
  const r = obj(v);
  if (!r || typeof r.id !== 'string' || !r.id) return null;
  const ids = obj(r.identifiers) ?? {};
  return {
    id: r.id,
    createdAt: text(r.created_at),
    names: texts(ids.names),
    emails: texts(ids.emails),
    hasBooking: r.has_booking === true,
    hasTransaction: r.has_transaction === true,
    firstTouch: parseTouch(r.first_touch),
  };
}

/**
 * Recent leads, newest first, cursor-paginated up to `max` (scope leads:read).
 * A free GET. No key means no request: an empty, untruncated list.
 */
export async function trakyoLeads(opts: { max?: number; fetchFn?: Fetch } = {}): Promise<{ leads: TrakyoLead[]; truncated: boolean }> {
  if (!trakyoKey()) return { leads: [], truncated: false };
  const max = opts.max ?? 200;
  const out: TrakyoLead[] = [];
  let cursor: string | null = null;
  while (out.length < max) {
    const qs = new URLSearchParams({ limit: '100', sort: 'date' });
    if (cursor) qs.set('starting_after', cursor);
    const page = obj(await request(`leads?${qs}`, { fetchFn: opts.fetchFn, scope: 'leads:read' }));
    for (const row of dataRows(page)) {
      const lead = parseTrakyoLead(row);
      if (lead) out.push(lead);
    }
    const next = text(page?.next_cursor);
    if (page?.has_more !== true || !next) return { leads: out.slice(0, max), truncated: false };
    cursor = next;
  }
  return { leads: out.slice(0, max), truncated: true };
}
