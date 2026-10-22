/**
 * Every live Skyescraper read, in one place, each behind the same
 * stale-while-revalidate cache every other connector in this app uses
 * (lib/swr.ts) — the architectural fix for "the app is slow": a page was
 * never slow because of its own code, it was slow because every render
 * re-fetched Skyescraper's API fresh. Now a render is served a real answer
 * at most 30s old instantly, with one background refresh, and
 * lib/warm.ts pre-populates this cache at boot, so even the first click
 * after a restart is already warm.
 *
 * The leads and projects reads are each fetched ONCE and shared: the real
 * estate dashboard's "leads" and "brokers" panels both need the lead list,
 * so brokers is derived from the SAME cached call, not a second network
 * round trip.
 *
 * RULE FOR ANY NEW LIVE EXTERNAL READ ADDED TO THIS APP: wrap it in swr()
 * with a sensible TTL (lib/swr.ts), and add it to lib/warm.ts's warmTasks()
 * so it's warm before the first user ever sees it. Never call fetch()
 * directly from a page or API route for a live source — always through a
 * cached function here (or in lib/funnel-live.ts, lib/connectors/*, etc.,
 * the same pattern Attio/GHL/Stripe already use).
 */
import { TTL, swr } from '@/lib/swr';
import type { Booking, BookingStatus, Broker, LeadSource, Property, PropertyStatus, PropertyType } from '@/lib/real-estate';

/** Exported for lib/agents/skyescraper-api.ts — the LangGraph agents' tool
 *  layer shares this exact config resolution, so "not configured" means the
 *  same thing everywhere in the app. */
export function skyescraperConfig(): { token: string; baseUrl: string } | null {
  const token = process.env.SKYESCRAPER_API_TOKEN;
  if (!token) return null;
  return { token, baseUrl: process.env.SKYESCRAPER_API_URL ?? 'http://skyescraper-laravel.test/api' };
}

export type SkyLead = {
  id: number;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  budget_range: string | null;
  stage_id: number | null;
  created_at: string;
  stage: { id: number; name: string; lead_type: 'open' | 'won' | 'lost' } | null;
  project: { id: number; project_name: string | null } | null;
  agent: { id: number; name: string } | null;
  activities?: { id: number; activity_type: string | null; activity: string | null; created_at: string }[];
};
type SkyProject = {
  id: number;
  project_name: string | null;
  location: string | null;
  starting_price: string | number | null;
  bedrooms_min?: number | null;
  bedrooms_max?: number | null;
  is_publish: 0 | 1;
  units_count: number;
  sold_units_count: number;
  available_units_count: number;
  projectType: { name: string } | null;
  projectStatus: { name: string } | null;
  highlights: { name: string }[];
};

/** The one real fetch for leads, cached 30s — shared by leads, brokers AND
 *  lib/funnel-skyescraper.ts (same cache key, same shape, one network call
 *  serves all three instead of each fetching the identical data itself). */
export async function rawLeads(): Promise<{ leads: SkyLead[]; total: number } | null> {
  const cfg = skyescraperConfig();
  if (!cfg) return null;
  return swr('skyescraper:leads', TTL.skyescraper, async () => {
    const res = await fetch(`${cfg.baseUrl}/lead/listing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_no: 1, limit: 200 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Skyescraper HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { leads?: SkyLead[]; total?: number } };
    return { leads: body.data?.leads ?? [], total: body.data?.total ?? 0 };
  });
}

async function rawProjects(): Promise<{ projects: SkyProject[]; total: number } | null> {
  const cfg = skyescraperConfig();
  if (!cfg) return null;
  return swr('skyescraper:projects', TTL.skyescraper, async () => {
    const res = await fetch(`${cfg.baseUrl}/project/listing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_no: 1, limit: 12 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Skyescraper HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { projects?: SkyProject[]; total?: number } };
    return { projects: body.data?.projects ?? [], total: body.data?.total ?? 0 };
  });
}

function mapStatus(stage: SkyLead['stage']): BookingStatus {
  if (!stage) return 'pending';
  if (stage.lead_type === 'won') return 'confirmed';
  if (stage.lead_type === 'lost') return 'cancelled';
  if (stage.name.trim().toLowerCase() === 'site visit') return 'site_visit';
  return 'pending';
}
const SOURCE: LeadSource = 'whatsapp'; // no per-lead channel tracked in Skyescraper yet — labelled placeholder, not a guess dressed as fact

export async function skyescraperLiveLeads(): Promise<{ bookings: Booking[]; source: 'live' | 'none' | 'error'; detail?: string; total?: number }> {
  try {
    const raw = await rawLeads();
    if (!raw) return { bookings: [], source: 'none', detail: 'SKYESCRAPER_API_TOKEN not set in .env.local' };
    const bookings: Booking[] = raw.leads.map((lead) => ({
      id: `SKY-${lead.id}`,
      client: lead.buyer_name?.trim() || `Lead #${lead.id}`,
      phone: lead.buyer_phone ?? undefined,
      property: lead.project?.project_name ?? 'Unassigned project',
      budget: lead.budget_range ?? 'Not specified',
      src: SOURCE,
      broker: lead.agent?.name ?? 'Unassigned',
      visit: lead.stage?.name ?? 'Not scheduled',
      status: mapStatus(lead.stage),
      createdAt: lead.created_at,
    }));
    return { bookings, source: 'live', total: raw.total };
  } catch (err) {
    return { bookings: [], source: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

const BROKER_PALETTE = ['#1A6BFF', '#12B76A', '#F79009', '#7C3AED', '#DC2626', '#0E7C86'];

export async function skyescraperLiveBrokers(): Promise<{ brokers: Broker[]; source: 'live' | 'none' | 'error'; detail?: string }> {
  try {
    const raw = await rawLeads(); // shared cache with skyescraperLiveLeads — no extra network call
    if (!raw) return { brokers: [], source: 'none', detail: 'SKYESCRAPER_API_TOKEN not set in .env.local' };
    const byAgent = new Map<number, { name: string; leads: number; closed: number }>();
    for (const lead of raw.leads) {
      if (!lead.agent) continue;
      const entry = byAgent.get(lead.agent.id) ?? { name: lead.agent.name, leads: 0, closed: 0 };
      entry.leads += 1;
      if (lead.stage?.lead_type === 'won') entry.closed += 1;
      byAgent.set(lead.agent.id, entry);
    }
    const brokers: Broker[] = [...byAgent.entries()]
      .sort((a, b) => b[1].leads - a[1].leads)
      .map(([id, v], i) => ({
        id: `SKY-AGENT-${id}`,
        name: v.name,
        init: v.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '??',
        color: BROKER_PALETTE[i % BROKER_PALETTE.length],
        spec: `${v.leads} lead${v.leads === 1 ? '' : 's'} assigned`,
        phone: '',
        tg: '',
        exp: '',
        leads: v.leads,
        closed: v.closed,
        rev: '—',
        rating: '—',
        status: 'active' as const,
      }));
    return { brokers, source: 'live' };
  } catch (err) {
    return { brokers: [], source: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

function mapType(name: string | undefined | null): PropertyType {
  const n = (name ?? '').toLowerCase();
  if (n.includes('commercial') || n.includes('shop') || n.includes('office')) return 'Commercial';
  if (n.includes('plot') || n.includes('land')) return 'Plot';
  return 'Residential';
}
function mapPropStatus(p: SkyProject): PropertyStatus {
  if (p.units_count > 0 && p.available_units_count === 0) return 'sold';
  return 'available';
}
function formatPrice(starting: string | number | null): string {
  if (starting === null || starting === undefined) return 'Price on request';
  const n = typeof starting === 'string' ? parseFloat(starting) : starting;
  if (!Number.isFinite(n) || n <= 0) return 'Price on request';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr+`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L+`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export async function skyescraperLiveProperties(): Promise<{ properties: Property[]; source: 'live' | 'none' | 'error'; detail?: string; total?: number }> {
  try {
    const raw = await rawProjects();
    if (!raw) return { properties: [], source: 'none', detail: 'SKYESCRAPER_API_TOKEN not set in .env.local' };
    const properties: Property[] = raw.projects.map((p) => ({
      id: `SKY-P${p.id}`,
      name: p.project_name?.trim() || `Project #${p.id}`,
      loc: p.location ?? 'Location not set',
      price: formatPrice(p.starting_price),
      bhk: p.bedrooms_min && p.bedrooms_max ? (p.bedrooms_min === p.bedrooms_max ? `${p.bedrooms_min} BHK` : `${p.bedrooms_min}-${p.bedrooms_max} BHK`) : 'N/A',
      area: `${p.units_count} unit${p.units_count === 1 ? '' : 's'}`,
      floor: 'N/A',
      status: mapPropStatus(p),
      type: mapType(p.projectType?.name),
      parking: 'N/A',
      tags: [p.projectStatus?.name, p.is_publish ? 'Published' : 'Unpublished', `${p.available_units_count} available`, ...p.highlights.slice(0, 2).map((h) => h.name)].filter(
        (t): t is string => Boolean(t),
      ),
    }));
    return { properties, source: 'live', total: raw.total };
  } catch (err) {
    return { properties: [], source: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}
