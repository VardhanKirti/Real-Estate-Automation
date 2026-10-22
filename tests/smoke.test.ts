import { renderWithRouter } from './helpers/render-client';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The smoke net renders the GladOS trees.
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: () => {
    const all = [{ name: 'glados-appearance', value: 'glados.ice.dark' }];
    return { get: (n: string) => all.find((c) => c.name === n), getAll: () => all, has: (n: string) => all.some((c) => c.name === n) };
  },
}));

// Pages read the DB path at first access, so point it at a fresh seeded temp DB
// before any page module is imported. FUNNEL_PROVIDER keeps /funnel off the
// live GHL API in tests.
beforeAll(() => {
  process.env.GLADOS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'glados-smoke-')), 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.GBRAIN_BIN = path.join(tmpdir(), 'glados-no-gbrain-cli');
});

type PageEntry = {
  file: string; // path relative to app/, the source of truth for coverage
  // props is `any` so strongly-typed page components (e.g. /org's searchParams)
  // remain assignable to this generic invoker.
  load: () => Promise<{ default: (props?: any) => unknown }>;
  props?: unknown;
  /** client components use hooks and cannot be invoked as plain functions —
      still covered here so the "no page escapes" net stays complete */
  clientOnly?: boolean;
};

// Every app/**/page.tsx currently in the Real Estate Agent build, with the props each needs.
const PAGES: PageEntry[] = [
  { file: 'page.tsx', load: () => import('@/app/page') },
  { file: 'agents/page.tsx', load: () => import('@/app/agents/page') },
  { file: 'agents/setup/[id]/page.tsx', load: () => import('@/app/agents/setup/[id]/page'), props: { params: { id: 'crm-pulse' } } },
  { file: 'blueprint/page.tsx', load: () => import('@/app/blueprint/page') },
  { file: 'brain/page.tsx', load: () => import('@/app/brain/page') },
  { file: 'chats/page.tsx', load: () => import('@/app/chats/page'), props: { searchParams: {} } },
  { file: 'clients/page.tsx', load: () => import('@/app/clients/page'), props: { searchParams: {} } },
  { file: 'database/page.tsx', load: () => import('@/app/database/page') },
  { file: 'dev/g-kit/page.tsx', load: () => import('@/app/dev/g-kit/page') },
  { file: 'dev/l-kit/page.tsx', load: () => import('@/app/dev/l-kit/page') },
  { file: 'funnel/page.tsx', load: () => import('@/app/funnel/page'), props: { searchParams: {} } },
  { file: 'inbox/page.tsx', load: () => import('@/app/inbox/page') },
  { file: 'integrations/page.tsx', load: () => import('@/app/integrations/page') },
  { file: 'integrations/whatsapp/page.tsx', load: () => import('@/app/integrations/whatsapp/page') },
  { file: 'knowledge/page.tsx', load: () => import('@/app/knowledge/page') },
  { file: 'login/page.tsx', load: () => import('@/app/login/page'), clientOnly: true },
  { file: 'org/page.tsx', load: () => import('@/app/org/page'), props: { searchParams: {} } },
  { file: 'roadmap/page.tsx', load: () => import('@/app/roadmap/page') },
  { file: 'setup/page.tsx', load: () => import('@/app/setup/page') },
  { file: 'skills/page.tsx', load: () => import('@/app/skills/page') },
  { file: 'tasks/page.tsx', load: () => import('@/app/tasks/page') },
  { file: 'wizard/page.tsx', load: () => import('@/app/wizard/page') },
  { file: 'workflows/page.tsx', load: () => import('@/app/workflows/page') },
];

function discoverPages(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...discoverPages(path.join(dir, entry.name), rel));
    else if (entry.name === 'page.tsx') out.push(rel);
  }
  return out;
}

describe('platform smoke — every page renders without throwing', () => {
  // 20s: pages that shell out to the gbrain CLI or distill the brain-store
  // (/, /brain) legitimately exceed vitest's 5s default under a loaded
  // parallel suite — this is a does-it-throw net, not a performance gate.
  test.each(PAGES)('$file renders', async ({ load, props, clientOnly }) => {
    const mod = await load();
    const Page = mod.default;
    if (clientOnly) {
      // module loads and exports a component; rendering needs a DOM
      expect(typeof Page).toBe('function');
      return;
    }
    // Server components run their body (DB reads, data fetch) when invoked;
    // a throw here is exactly the failure we want to catch.
    await expect(Promise.resolve(Page(props))).resolves.toBeTruthy();
  }, 20_000);

  test('the smoke net covers every app/**/page.tsx (no page escapes)', () => {
    const discovered = discoverPages(path.join(process.cwd(), 'app')).sort();
    const covered = PAGES.map((p) => p.file).sort();
    expect(covered).toEqual(discovered);
  });
});
