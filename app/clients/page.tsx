import { clientsBlank, clientsPayload } from '@/lib/clients-data';
import { buildClientsView } from '@/lib/clients-view';
import { foMode } from '@/lib/fo-sample';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { ClientsG } from '@/components/clients/ClientsG';
import { ClientsClassic } from '@/components/clients/ClientsClassic';
import { ClientsLegacy } from '@/components/clients/ClientsLegacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /clients (founderos-ui pages/clients.md). One server fetch (SQLite plus the
 * cached Attio deal list for the confirm picker) builds one view model that
 * every tree renders (glados-ui SPEC X5). `?sample=1` on a blank install and
 * Filming mode render the badged fixture and make no outbound request.
 */
export default async function ClientsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const sample = searchParams.sample === '1' ? '?sample=1' : '';
  const mode = foMode(`http://localhost/clients${sample}`, clientsBlank());
  const payload = await clientsPayload(mode);
  const selected = typeof searchParams.client === 'string' ? searchParams.client : null;
  const view = buildClientsView(payload, { selected });
  const setup = { attio: setupHrefFor('attio'), superset: setupHrefFor('superset') };
  const tree = treeFor(getAppearance(), '/clients');
  if (tree === 'glados') return <ClientsG view={view} setup={setup} />;
  if (tree === 'legacy') return <ClientsLegacy view={view} setup={setup} />;
  return <ClientsClassic view={view} setup={setup} />;
}
