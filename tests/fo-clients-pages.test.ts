/**
 * /clients and /lead-magnets pages (founderos-ui pages/clients.md, lead-magnets.md;
 * lane fo/clients). View models are pure and server-built; both trees render
 * every state: blank (Not configured + Set up), sample (badge), populated.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { describe, expect, test } from 'vitest';
import { renderWithRouter } from './helpers/render-client';
import { buildClientsView, launchBlockedReason, slackHrefFor, writeBlockedReason, ageLabel } from '@/lib/clients-view';
import type { ClientsPayload } from '@/lib/clients-data';
import { buildLeadMagnetsPage, linkLabel } from '@/lib/lead-magnets';
import { sampleClients, sampleLeadMagnets } from '@/lib/fo-sample';
import { ClientsG } from '@/components/clients/ClientsG';
import { ClientsClassic } from '@/components/clients/ClientsClassic';
import { LeadMagnetsG } from '@/components/lead-magnets/LeadMagnetsG';
import { LeadMagnetsClassic } from '@/components/lead-magnets/LeadMagnetsClassic';
import { G_READY, G_TREE_FILES } from '@/lib/g-ready';
import { validateForm, EMPTY_FORM } from '@/components/lead-magnets/use-lead-magnets';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const NOW = new Date('2026-10-12T15:00:00Z');
const SETUP = { attio: '/integrations#attio', superset: '/integrations#superset' };

function payload(over: Partial<ClientsPayload> = {}): ClientsPayload {
  return {
    roster: [],
    work: [],
    candidates: [],
    attio: { state: 'not_configured' },
    superset: { id: 'superset', name: 'Superset', kind: 'orchestration', state: 'not_configured', detail: 'Set SUPERSET_API_KEY' },
    writes: false,
    counts: { draft: 0, queued: 0, running: 0, done: 0, failed: 0 },
    mode: 'live',
    sample: false,
    ...over,
  };
}

function live(): ClientsPayload {
  const s = sampleClients(NOW);
  return payload({
    roster: s.roster.map((r) => ({ ...r, clientId: r.clientId.replace('sample-', 'c-') })),
    work: s.work.map((w) => ({ ...w, clientId: w.clientId.replace('sample-', 'c-') })),
    attio: { state: 'connected' },
    candidates: [{ clientId: 'deal-9', name: 'Unconfirmed Deal Co', status: 'Proposal' }],
  });
}

const render = (el: ReactElement) => renderWithRouter(el);

describe('clients view model', () => {
  test('CL-1: an Attio deal that is not confirmed is never on the roster (it only feeds the picker)', () => {
    const v = buildClientsView(live(), { now: NOW });
    expect(v.roster.map((r) => r.name)).not.toContain('Unconfirmed Deal Co');
    expect(v.candidates.map((c) => c.name)).toEqual(['Unconfirmed Deal Co']);
  });

  test('CL-4: the view carries no fee, contract or revenue field', () => {
    const json = JSON.stringify(buildClientsView(live(), { now: NOW }));
    expect(json).not.toMatch(/fee|revenue|contract|amount|usd|price/i);
  });

  test('activity, volume and rhythm come from client_work only', () => {
    const v = buildClientsView(live(), { now: NOW });
    expect(v.activity.created).toHaveLength(14);
    expect(v.activity.total14).toBe(4);
    expect(v.volume).toMatchObject({ open: 2, total: 4 });
    expect(v.rhythm.reduce((a, r) => a + r.count, 0)).toBe(4);
    expect(v.busiestDay).not.toBeNull();
    const blank = buildClientsView(payload(), { now: NOW });
    expect(blank.volume).toEqual({ open: 0, doneThisMonth: 0, failedThisMonth: 0, thisMonth: 0, total: 0 });
    expect(blank.busiestDay).toBeNull();
  });

  test('?client= selects only a confirmed client', () => {
    expect(buildClientsView(live(), { now: NOW, selected: 'c-acme' }).selected).toBe('c-acme');
    expect(buildClientsView(live(), { now: NOW, selected: 'deal-9' }).selected).toBeNull();
  });

  test('CL-3: launch is blocked with the reason until writes are on and Superset is configured', () => {
    const v = buildClientsView(live(), { now: NOW });
    expect(launchBlockedReason(v)).toBe('Launching is off on this instance (GLADOS_WRITES)');
    const on = buildClientsView({ ...live(), writes: true }, { now: NOW });
    expect(launchBlockedReason(on)).toBe('Superset is not configured');
    const ready = buildClientsView({ ...live(), writes: true, superset: { ...live().superset, state: 'connected' } }, { now: NOW });
    expect(launchBlockedReason(ready)).toBeNull();
    const running = ready.work.find((w) => w.status === 'running')!;
    expect(launchBlockedReason(ready, running)).toBe('Already running');
    const filming = buildClientsView({ ...live(), mode: 'filming', sample: true }, { now: NOW });
    expect(launchBlockedReason(filming)).toBe('Filming mode: read only');
    expect(writeBlockedReason(filming)).toBe('Filming mode: read only');
  });

  test('a Slack channel id links; a bare name stays text', () => {
    expect(slackHrefFor('C0123ABCDE')).toBe('https://slack.com/app_redirect?channel=C0123ABCDE');
    expect(slackHrefFor('#client-acme')).toBeNull();
    expect(slackHrefFor(null)).toBeNull();
  });

  test('ages are compact', () => {
    expect(ageLabel('2026-10-12T14:57:00Z', NOW)).toBe('3 min');
    expect(ageLabel('2026-10-10T15:00:00Z', NOW)).toBe('2 d');
  });
});

describe('/clients trees', () => {
  test('blank install, Attio and Superset unkeyed: Not configured with a Set up link, no zero roster, New request disabled', () => {
    const v = buildClientsView(payload(), { now: NOW });
    for (const html of [render(createElement(ClientsG, { view: v, setup: SETUP })), render(createElement(ClientsClassic, { view: v, setup: SETUP }))]) {
      expect(html).toContain('Attio not configured');
      expect(html).toContain('href="/integrations#attio"');
      expect(html).toContain('Confirm or add a client first');
      expect(html).toContain('No work requests yet.');
      expect(html).not.toContain('data-sample-badge');
    }
  });

  test('keyed, none confirmed: the empty line names Attio deals', () => {
    const v = buildClientsView(payload({ attio: { state: 'connected' } }), { now: NOW });
    expect(render(createElement(ClientsG, { view: v, setup: SETUP }))).toContain('Confirm a client from your Attio deals.');
    expect(render(createElement(ClientsClassic, { view: v, setup: SETUP }))).toContain('Confirm a client from your Attio deals.');
  });

  test('sample: badge on both trees, rows are the fixture', () => {
    const s = sampleClients(NOW);
    const v = buildClientsView(payload({ ...s, mode: 'sample', sample: true, attio: { state: 'connected' } }), { now: NOW });
    const g = render(createElement(ClientsG, { view: v, setup: SETUP }));
    const c = render(createElement(ClientsClassic, { view: v, setup: SETUP }));
    for (const html of [g, c]) {
      expect(html).toContain('data-sample-badge');
      expect(html).toContain('Northwind Studio');
    }
    expect(g).toContain('data-g="GHeroCard"');
  });

  test('populated: copy from the spec, launch disabled with the GLADOS_WRITES reason', () => {
    const v = buildClientsView(live(), { now: NOW });
    const g = render(createElement(ClientsG, { view: v, setup: SETUP }));
    for (const t of ['Clients', 'Client work · draft first', 'Request activity', 'Roster', 'Work requests', 'Request rhythm', 'Open requests']) expect(g).toContain(t);
    const c = render(createElement(ClientsClassic, { view: v, setup: SETUP }));
    for (const t of ['Request activity', 'Request volume', 'Roster', 'Work requests', 'Request rhythm']) expect(c).toContain(t);
    expect(c).not.toMatch(/data-g=/);
  });

  test('launch copy and gate live in the shared hook (AC-13)', () => {
    const hook = read('components/clients/use-clients.ts');
    expect(hook).toContain("{ confirm: true }");
    expect(hook).toContain('An agent drafts in a new workspace. Nothing is sent to the client.');
  });
});

describe('lead magnets page model', () => {
  test('LM-3: captures are "Not tracked" with a Trakyo Set up link when unkeyed, never 0', () => {
    const p = buildLeadMagnetsPage(sampleLeadMagnets(NOW), { filter: null, mode: 'live', trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: NOW });
    expect(p.capturesNote).toBe('Not tracked');
    expect(p.view.captures.setupHref).toBe('/integrations#trakyo');
    const keyed = buildLeadMagnetsPage(sampleLeadMagnets(NOW), { filter: null, mode: 'live', trakyoConfigured: true, trakyoSetupHref: '/integrations#trakyo', now: NOW });
    expect(keyed.capturesNote).toBe('Not tracked');
    expect(keyed.capturesReason).toMatch(/per content item, not per landing URL/);
    expect(keyed.view.captures.setupHref).toBeNull();
  });

  test('subtitle, filter and link label', () => {
    const p = buildLeadMagnetsPage(sampleLeadMagnets(NOW), { filter: 'live', mode: 'sample', trakyoConfigured: false, trakyoSetupHref: '/x', now: NOW });
    expect(p.subtitle).toBe('4 pages · 2 live');
    expect(p.rows.map((r) => r.status)).toEqual(['live', 'live']);
    expect(p.rows.every((r) => r.sample)).toBe(true);
    expect(linkLabel('https://www.example.com/kit/')).toBe('example.com/kit');
    expect(p.weeks.counts).toHaveLength(12);
  });

  test('LM-1: the form rejects an empty name and a non-https URL before sending', () => {
    expect(validateForm(EMPTY_FORM)).toMatchObject({ name: expect.any(String), liveUrl: expect.any(String) });
    expect(validateForm({ ...EMPTY_FORM, name: 'Kit', liveUrl: 'http://example.com' }).liveUrl).toMatch(/https/);
    expect(validateForm({ ...EMPTY_FORM, name: 'Kit', liveUrl: 'https://example.com/kit' })).toEqual({});
  });
});

describe('/lead-magnets trees', () => {
  const blank = buildLeadMagnetsPage([], { filter: null, mode: 'live', trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: NOW });
  const sample = buildLeadMagnetsPage(sampleLeadMagnets(NOW), { filter: null, mode: 'sample', trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: NOW });
  const liveRows = sampleLeadMagnets(NOW).map((m) => ({ ...m, id: m.id.replace('sample-', 'lm-') }));
  const populated = buildLeadMagnetsPage(liveRows, { filter: null, mode: 'live', trakyoConfigured: false, trakyoSetupHref: '/integrations#trakyo', now: NOW });

  test('fresh install: the empty line and Register, no sample badge', () => {
    for (const html of [render(createElement(LeadMagnetsG, { page: blank })), render(createElement(LeadMagnetsClassic, { page: blank }))]) {
      expect(html).toContain('No lead magnets yet.');
      expect(html).toContain('Register the first page you send people to.');
      expect(html).toContain('0 pages · 0 live');
      expect(html).not.toContain('data-sample-badge');
    }
  });

  test('sample: badged, rows are read only', () => {
    for (const html of [render(createElement(LeadMagnetsG, { page: sample })), render(createElement(LeadMagnetsClassic, { page: sample }))]) {
      expect(html).toContain('data-sample-badge');
      expect(html).toContain('Automation starter kit');
    }
  });

  test('populated: Captures say Not tracked with the Trakyo Set up link; never a 0 capture', () => {
    const g = render(createElement(LeadMagnetsG, { page: populated }));
    const c = render(createElement(LeadMagnetsClassic, { page: populated }));
    for (const html of [g, c]) {
      expect(html).toContain('Not tracked');
      expect(html).toContain('href="/integrations#trakyo"');
      expect(html).toContain('Where leads land');
      expect(html).toContain('Pages shipped');
    }
    expect(g).toContain('aria-label="Status of Automation starter kit"');
  });

  test('filtered empty offers Clear filter', () => {
    const p = buildLeadMagnetsPage(liveRows, { filter: 'archived', mode: 'live', trakyoConfigured: false, trakyoSetupHref: '/x', now: NOW });
    const html = render(createElement(LeadMagnetsG, { page: p }));
    expect(html).toContain('No archived pages.');
    expect(html).toContain('Clear filter');
  });
});

describe('wiring', () => {
  test('both routes fork on treeFor and are G_READY with their tree files listed', () => {
    expect(read('app/clients/page.tsx')).toMatch(/const tree = treeFor\(getAppearance\(\), '\/clients'\);[\s\S]*tree === 'glados'[\s\S]*tree === 'legacy'/);
    expect(read('app/lead-magnets/page.tsx')).toMatch(/const tree = treeFor\(getAppearance\(\), '\/lead-magnets'\);[\s\S]*tree === 'glados'[\s\S]*tree === 'legacy'/);
    for (const r of ['/clients', '/lead-magnets']) {
      expect(G_READY).toContain(r);
      expect(G_TREE_FILES[r]?.length).toBeGreaterThan(0);
    }
  });

  test('no raw hex in the new trees, the Classic kit or the fo/clients CSS block', () => {
    for (const f of ['components/clients/ClientsG.tsx', 'components/clients/ClientsClassic.tsx', 'components/lead-magnets/LeadMagnetsG.tsx', 'components/lead-magnets/LeadMagnetsClassic.tsx', 'components/fo-classic/kit.tsx']) {
      expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    const css = read('app/globals.css');
    const block = css.slice(css.indexOf('/* ── fo/clients'), css.indexOf('/* ── end fo/clients ── */'));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
