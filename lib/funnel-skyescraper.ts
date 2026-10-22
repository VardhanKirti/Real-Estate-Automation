/**
 * Live funnel provider — real Skyescraper leads mapped into the same
 * FunnelJourney shape the seeded funnel uses, following the exact pattern of
 * lib/funnel-live.ts (Attio). Honest by construction: returns null when
 * SKYESCRAPER_API_TOKEN is missing or the API is unreachable, so /funnel
 * falls back to local/sample and says so. Lost leads are excluded, same as
 * Attio's Closed Lost.
 */
import { FunnelJourneySchema, type FunnelJourney, type FunnelStage, type FunnelTouch } from '@/lib/schemas';
import { rawLeads, type SkyLead } from '@/lib/real-estate-live';

/** Skyescraper's pipeline stage names → the 5 canonical funnel hubs. Anything
 *  with lead_type 'won' always converts; lead_type 'lost' is excluded entirely
 *  (same treatment as Attio's Closed Lost). Unrecognised open-type stage names
 *  (custom/test stages an agency added) fall back to 'engaged' rather than
 *  being dropped — real leads never vanish just because of an unfamiliar label. */
const NAME_STAGE_MAP: Record<string, FunnelStage> = {
  open: 'first_touch',
  new: 'first_touch',
  contacted: 'engaged',
  'site visit': 'nurtured',
  negotiation: 'opted_in',
  'follow up': 'opted_in',
  closed: 'converted',
};

function mapStage(stage: SkyLead['stage']): FunnelStage | null {
  if (!stage) return 'first_touch';
  if (stage.lead_type === 'lost') return null;
  if (stage.lead_type === 'won') return 'converted';
  return NAME_STAGE_MAP[stage.name.trim().toLowerCase()] ?? 'engaged';
}

/** budget_range is a free-text range like "60L - 80L" or "1.2Cr-1.5Cr" — take
 *  the first number found as a rough amount; null when nothing parses. */
function parseAmount(budgetRange: string | null): number | null {
  if (!budgetRange) return null;
  const m = budgetRange.match(/[\d,.]+/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = budgetRange.toLowerCase();
  if (unit.includes('cr')) return n * 10_000_000;
  if (unit.includes('l')) return n * 100_000;
  return n;
}

const day = (iso: string | undefined | null, fallback: string): string => (iso ?? fallback).slice(0, 10);

const ACTIVITY_LABELS: Record<string, string> = {
  new_lead: 'Lead created',
  client_call: 'Client call',
  site_visit_completed: 'Site visit completed',
  email_sent: 'Email sent',
  deal_closed: 'Deal closed',
  client_meeting: 'Client meeting',
  follow_up_call: 'Follow-up call',
  document_submitted: 'Document submitted',
  lead_lost: 'Lead marked lost',
  visit_scheduled: 'Visit scheduled',
  lead_updated: 'Lead updated',
  lead_assigned: 'Lead assigned',
  lead_rotated: 'Lead auto-rotated',
};

/** Pure mapper: raw Skyescraper leads → validated journeys. */
export function mapSkyescraperLeads(leads: SkyLead[]): { journeys: FunnelJourney[]; excludedLost: number; total: number } {
  let excludedLost = 0;
  const journeys: FunnelJourney[] = [];

  for (const lead of leads) {
    const canonical = mapStage(lead.stage);
    if (canonical === null) {
      excludedLost++;
      continue;
    }

    const id = `sky-${lead.id}`;
    const name = lead.buyer_name?.trim() || `Lead #${lead.id}`;
    const createdAt = day(lead.created_at, '1970-01-01');

    const activities = [...(lead.activities ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const touches: FunnelTouch[] = activities.length
      ? activities.map((act, i) => ({
          id: `${id}-t${i + 1}`,
          contactId: id,
          seq: i + 1,
          stage: canonical,
          channel: 'crm' as const,
          label: ACTIVITY_LABELS[act.activity_type ?? ''] ?? act.activity?.slice(0, 80) ?? 'Activity logged',
          source: 'manual' as const,
          at: day(act.created_at, createdAt),
        }))
      : [
          {
            id: `${id}-t1`,
            contactId: id,
            seq: 1,
            stage: canonical,
            channel: 'crm' as const,
            label: 'Lead created in Skyescraper',
            source: 'manual' as const,
            at: createdAt,
          },
        ];

    try {
      journeys.push(
        FunnelJourneySchema.parse({
          id,
          name,
          venture: 'skyescraper',
          status: canonical,
          product: lead.project?.project_name ?? null,
          amountUsd: parseAmount(lead.budget_range),
          relationship: canonical === 'converted' ? 'hot' : canonical === 'first_touch' ? 'cold' : 'warm',
          likelihood: canonical === 'converted' ? 90 : canonical === 'opted_in' ? 70 : canonical === 'nurtured' ? 55 : canonical === 'engaged' ? 40 : 20,
          url: null,
          email: lead.buyer_email ?? null,
          phone: lead.buyer_phone ?? null,
          person: lead.buyer_name ?? null,
          company: lead.project?.project_name ?? null,
          role: lead.agent?.name ? `Agent: ${lead.agent.name}` : null,
          linkedin: null,
          createdAt,
          touches,
        }),
      );
    } catch {
      // a malformed row is skipped, never fatal
    }
  }

  journeys.sort((a, b) => (b.touches.at(-1)?.at ?? '').localeCompare(a.touches.at(-1)?.at ?? ''));
  return { journeys, excludedLost, total: leads.length };
}

/**
 * Fetch the live Skyescraper pipeline. Null = not available (no token / API
 * error) — the caller falls back to the local DB / sample and labels the
 * page accordingly, same contract as attioFunnelJourneys.
 *
 * Reads through lib/real-estate-live.ts's cached rawLeads() — the SAME
 * cached call the real-estate dashboard's leads/brokers panels use, so
 * visiting /funnel never fires a second, independent fetch for identical
 * data; whichever page loads first warms it for the other.
 */
export async function skyescraperFunnelJourneys(
  _now = new Date(),
): Promise<{ journeys: FunnelJourney[]; excludedLost: number; total: number } | null> {
  const raw = await rawLeads();
  if (!raw) return null;
  return mapSkyescraperLeads(raw.leads);
}
