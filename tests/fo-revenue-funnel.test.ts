/**
 * fo/revenue lane: F6 Trakyo link studio and F7 channel analytics on /funnel
 * (docs/projects/founderos-ui/pages/feature-additions.md). Offline: every
 * Trakyo call goes through an injected or stubbed fetch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseTrakyoLead, trakyoLeads, type TrakyoLead } from '@/lib/connectors/trakyo';
import { leadToEvent, mergeTrakyoTouches, trakyoTouches } from '@/lib/funnel-trakyo';
import { channelAnalytics, channelOfJourney, classifyChannel, isBooked } from '@/lib/funnel-channels';
import { CONFIRM_TITLE, EMPTY_LINK_FORM, linkFormError, linkRequestBody } from '@/components/funnel/links-model';
import { sampleFunnelJourneys } from '@/components/funnel/sample';
import { G_TREE_FILES } from '@/lib/g-ready';
import type { FunnelJourney } from '@/lib/schemas';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const fetchOf = (fn: (url: string, init?: RequestInit) => Response) => vi.fn(async (url: string | URL | Request, init?: RequestInit) => fn(String(url), init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const leadRow = (id: string, name: string, touch: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: '2026-10-01T10:00:00Z',
  identifiers: { names: [name], emails: [`${id}@example.com`], phones: [] },
  has_booking: false,
  has_transaction: false,
  first_touch: touch,
  ...extra,
});

const journey = (id: string, name: string, over: Partial<FunnelJourney> = {}, touches?: FunnelJourney['touches']): FunnelJourney => ({
  id, name, venture: 'default', status: 'engaged', product: null, amountUsd: null, relationship: 'warm', likelihood: 50,
  url: null, email: null, phone: null, person: null, company: null, role: null, linkedin: null, createdAt: '2026-09-01',
  touches: touches ?? [
    { id: `${id}-1`, contactId: id, seq: 1, stage: 'first_touch', channel: 'crm', label: 'Deal created in Attio', source: 'attio', at: '2026-09-01' },
  ],
  ...over,
});

describe('F7 Trakyo touches: GET /v1/leads', () => {
  test('parses a lead and drops a row without an id', () => {
    const l = parseTrakyoLead(leadRow('lead_1', 'Ada Park', { type: 'youtube', name: 'Agency stack', source_name: null, occurred_at: '2026-09-20T08:00:00Z' }, { has_booking: true }));
    expect(l).toMatchObject({ id: 'lead_1', names: ['Ada Park'], hasBooking: true, firstTouch: { type: 'youtube', name: 'Agency stack', sourceName: null } });
    expect(parseTrakyoLead({ created_at: 'x' })).toBeNull();
    expect(parseTrakyoLead(leadRow('lead_2', 'B', { type: 'weird', name: 'x', occurred_at: 'not a date' }))?.firstTouch).toBeNull();
  });

  test('no key: no request, no leads', async () => {
    vi.stubEnv('TRAKYO_API_KEY', '');
    const f = fetchOf(() => new Response('{}'));
    expect(await trakyoLeads({ fetchFn: f })).toEqual({ leads: [], truncated: false });
    expect(f).not.toHaveBeenCalled();
    expect(await trakyoTouches()).toEqual([]);
  });

  test('follows the cursor and stops at max', async () => {
    vi.stubEnv('TRAKYO_API_KEY', 'tky_x');
    const urls: string[] = [];
    const f = fetchOf((url) => {
      urls.push(url);
      const second = url.includes('starting_after=c1');
      return new Response(JSON.stringify({ data: [leadRow(second ? 'lead_b' : 'lead_a', second ? 'B' : 'A', null)], has_more: !second, next_cursor: second ? null : 'c1' }));
    });
    const out = await trakyoLeads({ fetchFn: f, max: 200 });
    expect(out.leads.map((l) => l.id)).toEqual(['lead_a', 'lead_b']);
    expect(out.truncated).toBe(false);
    expect(urls[0]).toContain('/v1/leads?limit=100&sort=date');
    expect(urls[1]).toContain('starting_after=c1');
  });

  test('a lead becomes one attributed first-touch event; leads with no touch or no identity yield none', () => {
    const lead = parseTrakyoLead(leadRow('lead_1', 'Ada Park', { type: 'youtube', name: 'Agency stack', occurred_at: '2026-09-20T08:00:00Z' })) as TrakyoLead;
    expect(leadToEvent(lead)).toEqual({ lead: 'Ada Park', label: 'YouTube: Agency stack', channel: 'organic', at: '2026-09-20' });
    const ad = parseTrakyoLead(leadRow('lead_2', 'Bo', { type: 'meta_ad', name: 'Install offer', source_name: 'Spring campaign', occurred_at: '2026-09-21T08:00:00Z' })) as TrakyoLead;
    expect(leadToEvent(ad)).toMatchObject({ channel: 'ads', label: 'Spring campaign: Install offer' });
    expect(leadToEvent(parseTrakyoLead(leadRow('lead_3', 'Cy', null)) as TrakyoLead)).toBeNull();
    expect(leadToEvent({ ...lead, names: [], emails: [] })).toBeNull();
  });

  test('trakyoTouches reads Trakyo once, and a failed read yields no events rather than a guess', async () => {
    vi.stubEnv('TRAKYO_API_KEY', 'tky_failing');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await trakyoTouches()).toEqual([]);
  });

  test('merged events feed the channel of the journey', () => {
    const lead = parseTrakyoLead(leadRow('lead_1', 'Ada Park', { type: 'instagram', name: 'Reel: 3 offers', occurred_at: '2026-09-20T08:00:00Z' })) as TrakyoLead;
    const [j] = mergeTrakyoTouches([journey('j1', 'Ada Park')], [leadToEvent(lead)!]);
    expect(j.touches[0].source).toBe('trakyo');
    expect(channelOfJourney(j)).toBe('instagram');
  });
});

describe('F7 channel analytics', () => {
  test('classifier names channels from the touch label', () => {
    expect(classifyChannel('YouTube: Agency stack')).toBe('youtube');
    expect(classifyChannel('IG reel: 3 offers')).toBe('instagram');
    expect(classifyChannel('Anything', true)).toBe('paid');
    expect(classifyChannel('Beehiiv newsletter')).toBe('newsletter');
    expect(classifyChannel('Some custom post')).toBe('other');
  });

  test('a CRM first touch is Unattributed, never guessed from the deal title', () => {
    expect(channelOfJourney(journey('j', 'YouTube fan'))).toBe('unattributed');
  });

  test('leads, bookings and revenue per channel; Unattributed sorts last; parts sum to leads', () => {
    const yt = (id: string, over: Partial<FunnelJourney>, extra: FunnelJourney['touches'] = []) =>
      journey(id, id, over, [{ id: `${id}-1`, contactId: id, seq: 1, stage: 'first_touch', channel: 'organic', label: 'YouTube: stack', source: 'trakyo', at: '2026-09-01' }, ...extra]);
    const js = [
      yt('a', {}),
      yt('b', { status: 'opted_in' }, [{ id: 'b-2', contactId: 'b', seq: 2, stage: 'opted_in', channel: 'call', label: 'Discovery call booked', source: 'attio', at: '2026-09-05' }]),
      yt('c', { status: 'converted', amountUsd: 4000 }),
      journey('d', 'd'),
    ];
    const a = channelAnalytics(js);
    expect(a.total).toBe(4);
    expect(a.attributed).toBe(3);
    expect(a.rows.map((r) => r.id)).toEqual(['youtube', 'unattributed']);
    expect(a.rows[0]).toMatchObject({ leads: 3, booked: 1, converted: 1, bookings: 2, revenueUsd: 4000 });
    for (const r of a.rows) expect(r.leads - r.bookings + r.booked + r.converted).toBe(r.leads);
    expect(isBooked(js[1])).toBe(true);
    expect(isBooked(js[0])).toBe(false);
  });

  test('the badged sample set spreads over several channels', () => {
    const a = channelAnalytics(sampleFunnelJourneys(new Date('2026-10-09T12:00:00Z'), 'default'));
    expect(a.rows.length).toBeGreaterThan(2);
    expect(a.rows.reduce((n, r) => n + r.leads, 0)).toBe(a.total);
  });

  test('page: unkeyed Trakyo is Not configured outside the sample and Filming fixtures', () => {
    const page = read('app/funnel/page.tsx');
    expect(page).toMatch(/trakyoKeyed \|\| fixture/);
    expect(page).toContain("state: 'not_configured', setupHref: trakyoSetup");
    for (const f of ['components/funnel/FunnelChannelsG.tsx', 'components/funnel/FunnelChannels.tsx']) {
      expect(read(f)).toMatch(/Not configured|kind="unconfigured"/);
    }
    expect(read('components/funnel/FunnelChannelsG.tsx')).toMatch(/GStackedBar[\s\S]*GLegend|GLegend[\s\S]*GStackedBar/);
  });
});

describe('F6 link studio', () => {
  const ok = { url: 'https://example.com/offer', source: 'Instagram', campaign: 'October reel', contentId: '', domain: '' };

  test('form checks: URL, a custom source, a campaign, or a ci_ content id', () => {
    expect(linkFormError(EMPTY_LINK_FORM)?.field).toBe('url');
    expect(linkFormError({ ...ok, source: 'youtube' })?.field).toBe('source');
    expect(linkFormError({ ...ok, campaign: ' ' })?.field).toBe('campaign');
    expect(linkFormError({ ...ok, source: '', campaign: '', contentId: 'abc' })?.field).toBe('contentId');
    expect(linkFormError({ ...ok, source: '', campaign: '', contentId: 'ci_123' })).toBeNull();
    expect(linkFormError(ok)).toBeNull();
  });

  test('the body creates content first without an id, joins the content with one, and always carries confirm', () => {
    expect(linkRequestBody(ok)).toEqual({ link: { url: ok.url }, content: { source: 'Instagram', name: 'October reel' }, confirm: true });
    expect(linkRequestBody({ ...ok, contentId: 'ci_9', domain: 'd1' })).toEqual({ link: { url: ok.url, domain: 'd1', contentItemId: 'ci_9' }, confirm: true });
  });

  test('both trees confirm before the POST, gate on writes and read the studio route', () => {
    expect(CONFIRM_TITLE).toBe('Create link in Trakyo?');
    for (const f of ['components/funnel/FunnelLinksG.tsx', 'components/funnel/FunnelLinks.tsx']) {
      const src = read(f);
      expect(src).toContain('CONFIRM_TITLE');
      expect(src).toContain("fetch('/api/trakyo/links', { method: 'POST'");
      expect(src).toContain('WRITES_OFF_REASON');
      expect(src).toMatch(/Not configured|kind="unconfigured"/);
      // the POST only runs from the confirm step
      expect(src).toMatch(/(onConfirm|onClick)={\(\) => void create\(\)}/);
    }
    expect(read('lib/connectors/trakyo.ts')).toContain('Trakyo API v1 is live');
  });

  test('the GladOS files are registered for the Classic-control guard', () => {
    expect(G_TREE_FILES['/funnel']).toEqual(expect.arrayContaining(['components/funnel/FunnelLinksG.tsx', 'components/funnel/FunnelChannelsG.tsx']));
  });
});
