import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { setupHrefFor } from '@/lib/integrations-catalog';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Setup-affordance contract : anything unconfigured shows
 * a Set up button that routes to the fix — never a raw config hint ("set
 * INBOX_1_HOST…") on a dashboard. The hint survives as the hover title; the
 * full guidance lives in the destination's connect flow.
 */
describe('every unconfigured surface routes to setup', () => {
  test('setupHrefFor deep-links known connectors and falls back to the board', () => {
    expect(setupHrefFor('whatsapp')).toBe('/integrations#whatsapp');
    expect(setupHrefFor('email')).toBe('/integrations#gmail');
    expect(setupHrefFor('slack')).toBe('/integrations#slack');
    expect(setupHrefFor('attio')).toBe('/integrations#attio');
    expect(setupHrefFor('zernio')).toBe('/integrations#zernio');
    expect(setupHrefFor('no-such-connector')).toBe('/integrations');
  });

  test('integration tiles carry slug anchors for the deep links', () => {
    const card = read('components/ConnectionCard.tsx');
    expect(card).toMatch(/id=\{entry\.slug\}/);
    expect(card).toContain('scroll-mt-24');
  });

  test('inbox channels show a Set up link when a connector is not configured', () => {
    // The old /comms page carried this guarantee; it retired into /inbox, and
    // the affordance has to travel with it — an unconfigured channel must
    // still route somewhere that fixes it.
    const triage = read('components/inbox/InboxTriage.tsx');
    expect(triage).toContain('SetupLink');
    expect(triage).toContain('setupHrefFor(s.id)');
    expect(triage).toMatch(/!connected\[s\.id\]/);
  });

  test('analytics pending metrics each carry a SetupLink', () => {
    const analytics = read('app/analytics/page.tsx');
    expect(analytics).toContain('SetupLink');
    expect(analytics).toContain('PENDING_CONNECTOR');
  });

  test('finances: a not-configured processor is a real SetupLink, not a "Connect →" badge (H11)', () => {
    const fin = read('app/finances/FinancesClient.tsx');
    expect(fin).toContain('<SetupLink href={processorSetupHref(a.id)}');
    expect(fin).not.toContain('Connect →');
    // the Stripe balance tile routes to setup when Stripe is not live
    expect(fin).toContain("processorSetupHref('stripe')");
  });

  test('clients and lead magnets: Attio, Superset and Trakyo route to their Set up links when unkeyed (founderos-ui B5)', () => {
    expect(read('app/clients/page.tsx')).toContain("setupHrefFor('attio')");
    expect(read('app/clients/page.tsx')).toContain("setupHrefFor('superset')");
    for (const f of ['components/clients/ClientsG.tsx', 'components/clients/ClientsClassic.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/Attio not configured/);
      expect(src, f).toMatch(/setup\.attio/);
      expect(src, f).toMatch(/setup\.superset/);
    }
    expect(read('app/lead-magnets/page.tsx')).toContain("setupHrefFor('trakyo')");
    expect(read('components/lead-magnets/LeadMagnetsG.tsx')).toContain('captures.setupHref');
    expect(read('components/lead-magnets/LeadMagnetsClassic.tsx')).toContain('<SetupLink href={captures.setupHref}');
  });

  test('brand deals: bdpilot not reporting routes to setup (H7)', () => {
    const board = read('components/brand-deals/DealBoard.tsx');
    expect(board).toMatch(/bdpilot is not reporting[\s\S]{0,400}<SetupLink href="\/setup"/);
  });

  test('funnel source chips link to their connect flow when down', () => {
    const funnel = read('app/funnel/page.tsx');
    expect(funnel).toContain('setupHrefFor(status.id)');
  });

  test('brain doctor-offline states and the radial empty state route to /setup', () => {
    expect(read('app/brain/page.tsx')).toMatch(/Doctor offline\s*<SetupLink/);
    expect(read('components/BrainCore.tsx')).toMatch(/Doctor offline\s*<SetupLink/);
    expect(read('components/GBrainRadial.tsx')).toMatch(/brain-store not mounted[\s\S]{0,300}SetupLink/);
  });

  test('the home hero offers setup when anything is degraded', () => {
    const home = read('components/Home6Console.tsx');
    expect(home).toMatch(/tone === 'warn' \|\| s\.tone === 'err'/);
    expect(home).toContain('<SetupLink');
  });

  test('home empty states (chart, audience, freshness) each offer setup (S10)', () => {
    const home = read('components/Home6Console.tsx');
    expect(home).toMatch(/No posting or comms history yet\s*<SetupLink href=\{setupHrefFor\('zernio'\)\}/);
    expect(home).toMatch(/No audience history yet\s*<SetupLink href=\{setupHrefFor\('zernio'\)\}/);
    expect(home).toMatch(/Brain store not mounted\s*<SetupLink/);
    expect(setupHrefFor('zernio')).toBe('/integrations#zernio');
  });

  test('AdPilot routes a missing ad account and missing Foreplay to setup (S01 F6, F19, F20, F23)', () => {
    expect(setupHrefFor('meta-ads')).toBe('/integrations#meta');
    const deck = read('components/adpilot/AdPilotDeck.tsx');
    expect(deck).toContain("setupHrefFor('meta-ads')");
    expect(deck).toMatch(/No ad account connected<\/span>\s*<SetupLink/);
    const lib = read('components/adpilot/AdLibrary.tsx');
    expect(lib).toContain("setupHrefFor('foreplay')");
    // <Setup> picks the Classic SetupLink or the kit button by style (GP4)
    expect(lib).toMatch(/Not configured <Setup href=\{FOREPLAY_SETUP\}/);
    expect(lib).toMatch(/kind="unconfigured"[\s\S]{0,200}setupHref=\{FOREPLAY_SETUP\}/);
    const deckG = read('components/adpilot/AdPilotDeckG.tsx');
    expect(deckG).toMatch(/No ad account connected[\s\S]{0,300}setupHref=\{setupHrefFor\('meta-ads'\)\}|setupHrefFor\('meta-ads'\)[\s\S]{0,300}No ad account connected/);
    expect(lib).not.toMatch(/['"]not connected['"]/);
  });

  test('creative engine surfaces route Foreplay and Arcads gaps to setup', () => {
    expect(setupHrefFor('foreplay')).toBe('/integrations#foreplay');
    expect(setupHrefFor('arcads')).toBe('/integrations#arcads');
    for (const file of ['components/creative-engine/Dashboard.tsx', 'components/creative-engine/CreativeGenerator.tsx', 'components/creative-engine/UgcStudio.tsx', 'components/creative-engine/MotionConsole.tsx', 'components/creative-engine/Drawers.tsx']) {
      expect(read(file), `${file} must import SetupLink`).toContain('SetupLink');
    }
    // the home never shows a bare "not connected" string for a connector gap
    expect(read('components/creative-engine/Dashboard.tsx')).not.toMatch(/['"]not connected['"]/);
  });

  test('the Creative generator "No products yet" line routes to Connect Arcads or to Set up (S03 FR-12)', () => {
    const gen = read('components/creative-engine/CreativeGenerator.tsx');
    expect(gen).toContain('No products yet.');
    expect(gen).toContain('Choose an Arcads product');
    expect(gen).toMatch(/SetupLink href=\{arcadsSetupHref\} hint="ARCADS_BASIC_AUTH"/);
  });

  test('Growth: /social pill, unconnected platform and Beehiiv header route to setup (H15, H19)', () => {
    const social = read('app/social/page.tsx');
    expect(social).toContain("setupHref: setupHrefFor('zernio')");
    expect(social).toMatch(/pill\.setupHref && <SetupLink/);
    const platform = read('app/social/[platform]/page.tsx');
    expect(platform).toMatch(/is not connected[\s\S]{0,300}<SetupLink href=\{setupHrefFor\('zernio'\)\}/);
    expect(platform).not.toContain('.env.local');
    expect(platform).not.toContain('<main');
    const beehiiv = read('app/social/beehiiv/page.tsx');
    expect(beehiiv).toContain("<SetupLink href={setupHrefFor('beehiiv')}");
    expect(beehiiv).not.toContain('BEEHIIV_API_KEY for live');
  });

  test('Content Lab: unconfigured Apify is Not configured with Set up in both trees, and on /integrations (content-lab AC10)', () => {
    expect(setupHrefFor('apify')).toBe('/integrations#apify');
    // v2 (01 4.5, D12): the frame's not-configured card renders Set up through SetupLink to ?setup=keys
    const g = read('components/lab/v2/g/Frame.tsx');
    expect(g).toMatch(/frame\.emptyCard[\s\S]{0,600}<SetupLink href=\{frame\.emptyCard\.setupHref\}/);
    expect(read('lib/lab/view/frame.ts')).toMatch(/emptyCard: notConfigured \? \{[^}]*setupHref: '\?setup=keys'/);
    // the view carries the href; the context resolves it from the catalog, never a literal
    expect(read('lib/lab/context.ts')).toContain("setupHref: setupHrefFor('apify')");
  });

  test('Knowledge and System (GladOS trees): every unconfigured surface is a GEmpty with a Set up link (S05 F05.4, §10)', () => {
    // brain-store missing: the radial stage (edge 1); gbrain CLI unreachable: the Doctor sheet (edge 2)
    const brain = read('components/brain/BrainG.tsx');
    expect(brain).toMatch(/kind="unconfigured" title="No brain-store mounted"[^>]*setupHref="\/setup"/);
    expect(brain).toMatch(/kind="unconfigured" title="The engine CLI is unreachable"[^>]*setupHref="\/setup"/);
    // drift pipeline not running (edge 8)
    expect(read('components/knowledge/DriftG.tsx')).toMatch(/kind="unconfigured"\s+title="Drift detection is not running yet"[\s\S]{0,300}setupHref="\/setup"/);
    // compute without a MIOSA key, brain files without a folder
    expect(read('app/compute/page.tsx')).toMatch(/kind="unconfigured"\s+title="No MIOSA key on this machine"[\s\S]{0,300}setupHref="\/setup"/);
    expect(read('app/database/page.tsx')).toMatch(/kind="unconfigured"\s+title="No brain folder found on this machine"[\s\S]{0,300}setupHref="\/setup"/);
    // the GEmpty unconfigured kind always renders the Set up button
    const states = read('components/g/States.tsx');
    expect(states).toMatch(/props\.kind === 'unconfigured' && \(\s*<GButton variant="sm" href=\{props\.setupHref\}/);
  });

  test('workforce under the GladOS style: run outcomes, the Wizard engine and an all-disconnected inbox route to setup (S04 AC04.38)', () => {
    expect(read('components/tasks/TasksG.tsx')).toMatch(/kind="unconfigured"[\s\S]{0,120}title="No agent runs recorded yet"[\s\S]{0,160}setupHref="\/agents"/);
    expect(read('components/wizard/WizardG.tsx')).toMatch(/kind="unconfigured" title="Claude binary not found on this host"[\s\S]{0,120}setupHref="\/setup"/);
    const inbox = read('components/inbox/InboxG.tsx');
    expect(inbox).toMatch(/caption="Connect a channel" setupHref="\/integrations"/);
    expect(inbox).toContain('href={setupHrefFor(s.id)}');
  });

  test('home under the GladOS style: both heroes, every empty card and the degraded status line route to setup (S01 §10)', () => {
    const home = read('components/home/HomeG.tsx');
    const kit = read('components/g/Surfaces.tsx');
    // an unconfigured hero renders the kit Set up button (div mode, no nested anchors)
    expect(kit).toMatch(/unconfigured && \(\s*<GButton variant="sm" href=\{setupHref\}/);
    expect(home).toMatch(/status="No payment processor connected"\s+setupHref=\{setupHrefFor\('stripe'\)\}/);
    expect(home).toMatch(/status="Comms not connected"\s+setupHref=\{setupHrefFor\('email'\)\}/);
    expect(home).toMatch(/title="No posting or comms history yet"[\s\S]{0,120}setupHref=\{setupHrefFor\('zernio'\)\}/);
    expect(home).toMatch(/title="No audience history yet"[\s\S]{0,120}setupHref=\{setupHrefFor\('zernio'\)\}/);
    expect(home).toMatch(/title="Brain store not mounted"[\s\S]{0,160}setupHref="\/setup"/);
    expect(home).toMatch(/title="No agent runs recorded yet"[\s\S]{0,160}setupHref="\/agents"/);
    expect(home).toMatch(/title="No agents live"[\s\S]{0,160}setupHref="\/agents"/);
    // the G-Brain health card left Home (founderos-ui F1): no health empty state remains
    expect(home).not.toContain('No health score yet');
    expect(home).toMatch(/status\.degraded && \(\s*<GButton variant="sm" href="\/setup"/);
  });
});

describe('Content Lab Radar sources (05 AC-05-38)', () => {
  test('every not-configured Radar source carries a Set up href', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { LAB_DDL } = await import('@/lib/db');
    const { labStore } = await import('@/lib/lab/store');
    const { radarView } = await import('@/lib/lab/radar/view');
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const v = radarView(labStore(db), new Date('2026-10-11T10:00:00Z'), { dry: false, sample: false, paused: null, tz: 'UTC', apifyConfigured: false, githubToken: false, phToken: false, env: {} });
    const notConfigured = v.sources.filter((s) => s.status === 'not_configured' || /Not configured/.test(s.note ?? ''));
    expect(notConfigured.map((s) => s.source).sort()).toEqual(['github', 'producthunt', 'tiktok_cc', 'x']);
    for (const s of notConfigured) expect(s.setupHref, s.source).toMatch(/^\/(integrations|lab\?setup=)/);
  });
});

describe('Content Lab plan panel (09 AC-09-29)', () => {
  test('an assumed Apify tier label renders a SetupLink to ?setup=keys', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
    const { LAB_DDL } = await import('@/lib/db');
    const { labStore } = await import('@/lib/lab/store');
    const { seedLabFixtures } = await import('@/lib/lab/fixtures');
    const { buildSheet } = await import('@/lib/lab/view/build');
    const { labParams } = await import('@/lib/lab/context');
    const { PlanPanel } = await import('@/components/lab/v2/g/setup/PlanPanel');
    const NOW = new Date('2026-10-11T15:00:00.000Z');
    const db = new Database(':memory:');
    db.exec(LAB_DDL);
    const store = labStore(db);
    seedLabFixtures(store, NOW);
    const flags = { configured: true, sample: false, filming: false, dry: false, dryReason: null, dryLabel: null, setupHref: '/lab?setup=keys', fixtureName: null, agentName: 'Content Lab' } as const;
    const sheet = await buildSheet('setup', 'sources', store, labParams(() => null), { ...flags }, NOW, { env: { GLADOS_TZ: 'UTC' } });
    const setup = (sheet.view as { setup?: unknown } | null)?.setup as { planner: { tier: Record<string, unknown> }; gates: never[] } | undefined;
    expect(setup, 'setup view').toBeTruthy();
    const planner = { ...setup!.planner, tier: { ...setup!.planner.tier, source: 'assumed' } };
    const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
    const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(PlanPanel, { planner: planner as never, gates: setup!.gates, record: null, sample: false })));
    expect(html).toMatch(/href="\?setup=keys"[^>]*>Set up/);
  });
});
