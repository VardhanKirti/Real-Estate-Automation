/**
 * Deterministic sample journeys for the funnel page.
 *
 * Used ONLY when no CRM is keyed and the local database holds no journeys —
 * and always rendered under a visible "Sample data" badge with a Set up link
 * (house rule: honest or absent). Same shape as the live/seeded rows, so the
 * page code never branches on where the data came from.
 */
import { FunnelJourneySchema, type FunnelJourney, type FunnelStage } from '@/lib/schemas';

type Channel = FunnelJourney['touches'][number]['channel'];
type Source = FunnelJourney['touches'][number]['source'];

const PEOPLE: [string, string, string][] = [
  ['Mara Lindqvist', 'Northwind Dental', 'Owner'],
  ['Devon Okafor', 'Okafor Legal', 'Managing partner'],
  ['Priya Raman', 'Lumen Fitness', 'Founder'],
  ['Tomas Weber', 'Weber Roofing Co', 'Operations lead'],
  ['Aisha Bello', 'Bello Realty Group', 'Broker'],
  ['Jonah Feld', 'Feld Accounting', 'Partner'],
  ['Sofia Marchetti', 'Marchetti Studio', 'Creative director'],
  ['Caleb Nguyen', 'Nguyen Consulting', 'Principal'],
  ['Ingrid Solberg', 'Solberg Media', 'CEO'],
  ['Rafael Duarte', 'Duarte Labs', 'CTO'],
  ['Hannah Kim', 'Kim & Park Clinic', 'Practice manager'],
  ['Liam O’Connor', 'Harbor Capital', 'Managing director'],
  ['Yusuf Demir', 'Demir Systems', 'Founder'],
  ['Elena Petrova', 'Petrova Agency', 'Head of growth'],
  ['Marcus Hale', 'Hale Partners', 'Partner'],
  ['Naomi Tanaka', 'Tanaka Ventures', 'GP'],
  ['Owen Bright', 'Bright Solutions', 'Director'],
  ['Zara Hussain', 'Hussain Law', 'Attorney'],
  ['Felix Brandt', 'Brandt Group', 'COO'],
  ['Amara Osei', 'Osei Tech', 'CEO'],
  ['Nikolai Voss', 'Voss Services', 'Owner'],
  ['Chloe Martin', 'Martin Clinic', 'Owner'],
  ['Idris Farah', 'Farah Media', 'Producer'],
  ['Greta Holm', 'Holm Consulting', 'Principal'],
  ['Santiago Ruiz', 'Ruiz Realty', 'Broker'],
  ['Beatrice Lang', 'Lang Studio', 'Founder'],
  ['Kwame Mensah', 'Mensah Capital', 'Partner'],
  ['Olivia Reyes', 'Reyes Fitness', 'Owner'],
  ['Henrik Dahl', 'Dahl Systems', 'CTO'],
  ['Layla Haddad', 'Haddad Agency', 'CEO'],
  ['Ethan Cole', 'Cole & Sons', 'Owner'],
  ['Mei Lin', 'Lin Dental', 'Owner'],
  ['Arjun Patel', 'Patel Labs', 'Founder'],
  ['Freya Nilsen', 'Nilsen Group', 'Director'],
  ['Diego Alvarez', 'Alvarez Legal', 'Partner'],
  ['Ruth Adeyemi', 'Adeyemi Consulting', 'Principal'],
  ['Viktor Novak', 'Novak Media', 'CEO'],
  ['Sienna Walsh', 'Walsh Roofing', 'Owner'],
  ['Kenji Sato', 'Sato Ventures', 'GP'],
  ['Adaeze Umeh', 'Umeh Tech', 'Founder'],
  ['Paulo Ferreira', 'Ferreira Services', 'Owner'],
  ['Nora Fischer', 'Fischer Studio', 'Creative director'],
];

const STAGES: FunnelStage[] = ['first_touch', 'engaged', 'nurtured', 'opted_in', 'converted'];

const TOUCHES: Record<FunnelStage, { channel: Channel; source: Source; label: string }[]> = {
  first_touch: [
    { channel: 'organic', source: 'trakyo', label: 'IG reel: 3 offers that close themselves' },
    { channel: 'organic', source: 'trakyo', label: 'YouTube: the one-person agency stack' },
    { channel: 'ads', source: 'meta-ads', label: 'Meta ad: AI receptionist demo' },
    { channel: 'ads', source: 'meta-ads', label: 'Meta ad: 14-day install offer' },
    { channel: 'crm', source: 'attio', label: 'Inbound form: website' },
  ],
  engaged: [
    { channel: 'dm', source: 'manual', label: 'DM thread: asked about pricing' },
    { channel: 'email', source: 'manual', label: 'Replied to welcome email' },
    { channel: 'dm', source: 'manual', label: 'Sent the case-study reel' },
  ],
  nurtured: [
    { channel: 'email', source: 'manual', label: 'Sequence: install walkthrough' },
    { channel: 'webinar', source: 'manual', label: 'Attended the Thursday build call' },
  ],
  opted_in: [
    { channel: 'call', source: 'attio', label: 'Discovery call booked' },
    { channel: 'call', source: 'attio', label: 'Proposal reviewed on call' },
  ],
  converted: [
    { channel: 'checkout', source: 'attio', label: 'Paid: Agent install' },
    { channel: 'checkout', source: 'attio', label: 'Paid: Operating system' },
  ],
};

const PRODUCTS = ['Agent install', 'Operating system', 'Audit'];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** ~40 journeys spread over the last five months, a handful decayed past the
 *  archive line so every view on the page has something to show. */
export function sampleFunnelJourneys(now: Date, venture = 'default'): FunnelJourney[] {
  const rnd = mulberry32(20260917);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return PEOPLE.map(([person, company, role], i) => {
    // furthest stage: weighted so the funnel actually narrows
    const roll = rnd();
    const stageIdx = roll < 0.2 ? 0 : roll < 0.45 ? 1 : roll < 0.65 ? 2 : roll < 0.8 ? 3 : 4;
    const status = STAGES[stageIdx];
    // a few old, quiet leads decay into the archive
    const decayed = stageIdx < 4 && i % 9 === 4;
    const startDaysAgo = decayed ? between(120, 160) : between(4, 130);
    let at = today - startDaysAgo * DAY;
    const touches: FunnelJourney['touches'] = [];
    for (let s = 0; s <= stageIdx; s++) {
      if (s > 0) at += between(2, 11) * DAY;
      if (at > today) at = today;
      const t = pick(TOUCHES[STAGES[s]]);
      touches.push({
        id: `sample-t-${i}-${s}`,
        contactId: `sample-${i}`,
        seq: s + 1,
        stage: STAGES[s],
        channel: t.channel,
        label: t.label,
        source: t.source,
        at: iso(at),
      });
    }
    const converted = status === 'converted';
    const likelihood = converted ? 100 : decayed ? between(10, 45) : between(15, 95);
    const id = `sample-${i}`;
    return FunnelJourneySchema.parse({
      id,
      name: `${company} — ${PRODUCTS[i % PRODUCTS.length]}`,
      venture,
      status,
      product: converted ? PRODUCTS[i % PRODUCTS.length] : null,
      amountUsd: converted ? between(3, 28) * 500 : stageIdx >= 3 ? between(3, 20) * 500 : null,
      relationship: likelihood >= 70 ? 'hot' : likelihood >= 40 ? 'warm' : 'cold',
      likelihood,
      url: null,
      email: `${person.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
      phone: null,
      person,
      company,
      role,
      linkedin: null,
      createdAt: touches[0].at,
      touches,
    });
  });
}
