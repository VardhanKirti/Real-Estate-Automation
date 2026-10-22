import type { ConnectorCapability, ConnectorStatus } from '@/lib/connectors/types';
import {
  INTEGRATION_CATEGORIES,
  type Integration,
  type IntegrationCategory,
} from '@/lib/schemas';

/**
 * The connections marketplace catalog. Larp-first: a rich, honest catalog of
 * popular tools. `connectorId` ties an entry to a real connector so its live
 * "connected" state is never faked; everything else reads as "not connected"
 * with a Connect affordance. Logos resolve from `slug` via lib/brand-logos
 * (simple-icons + a few hand-authored marks + intentional lettermarks).
 */
export const INTEGRATIONS: Integration[] = [
  // Communication
  { slug: 'gmail', name: 'Gmail', tagline: 'Send & read email', category: 'Communication', connectorId: 'email', popular: true, envKeys: [] },
  { slug: 'whatsapp', name: 'WhatsApp', tagline: 'Client messages & broadcasts', category: 'Communication', connectorId: 'whatsapp', popular: true, envKeys: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] },
  { slug: 'zoom', name: 'Zoom', tagline: 'Meetings & property tours', category: 'Communication', popular: true },
  { slug: 'telegram', name: 'Telegram', tagline: 'Chats & bots', category: 'Communication' },

  // Productivity
  { slug: 'notion', name: 'Notion', tagline: 'Docs & databases', category: 'Productivity', connectorId: 'notion', popular: true, envKeys: ['NOTION_API_KEY'] },
  { slug: 'googlesheets', name: 'Google Sheets', tagline: 'Read & write spreadsheets', category: 'Productivity' },
  { slug: 'googledocs', name: 'Google Docs', tagline: 'Create & edit documents', category: 'Productivity' },
  { slug: 'airtable', name: 'Airtable', tagline: 'Bases & records', category: 'Productivity' },
  { slug: 'clickup', name: 'ClickUp', tagline: 'Docs, tasks & goals', category: 'Productivity' },
  { slug: 'obsidian', name: 'Notes', tagline: 'Markdown vault', category: 'Productivity', connectorId: 'obsidian', envKeys: [] },

  // CRM & Sales
  { slug: 'gohighlevel', name: 'GoHighLevel', tagline: 'Buyer & seller pipeline', category: 'CRM & Sales', connectorId: 'ghl', popular: true, envKeys: ['GHL_API_KEY', 'GHL_LOCATION_ID'] },
  { slug: 'hubspot', name: 'HubSpot', tagline: 'Contacts & deals', category: 'CRM & Sales' },

  // Scheduling
  { slug: 'googlecalendar', name: 'Google Calendar', tagline: 'Showings & availability', category: 'Scheduling', connectorId: 'calendar', popular: true, envKeys: [] },
  { slug: 'calendly', name: 'Calendly', tagline: 'Booking links', category: 'Scheduling' },
  { slug: 'caldotcom', name: 'Cal.com', tagline: 'Open scheduling', category: 'Scheduling' },
  { slug: 'googlemeet', name: 'Google Meet', tagline: 'Video calls', category: 'Scheduling' },

  // AI & Automation
  { slug: 'anthropic', name: 'Anthropic', tagline: 'Claude models', category: 'AI & Automation', popular: true },
  { slug: 'openai', name: 'OpenAI', tagline: 'GPT models & embeddings', category: 'AI & Automation' },
  { slug: 'zapier', name: 'Zapier', tagline: 'Automate anything', category: 'AI & Automation' },
  { slug: 'make', name: 'Make', tagline: 'Visual workflows', category: 'AI & Automation' },
  { slug: 'n8n', name: 'n8n', tagline: 'Self-hosted automation', category: 'AI & Automation' },

  // Storage
  { slug: 'googledrive', name: 'Google Drive', tagline: 'Files & folders', category: 'Storage' },
  { slug: 'dropbox', name: 'Dropbox', tagline: 'Sync & share', category: 'Storage' },
  { slug: 'onedrive', name: 'OneDrive', tagline: 'Microsoft files', category: 'Storage' },
];

export type CatalogEntry = Integration & {
  connected: boolean;
  keySaved: boolean;
  /** A deeper settings page, when the connector has real choices to make. */
  configHref?: string;
  /** Per-capability states, when one green dot would overstate what works. */
  capabilities?: ConnectorCapability[];
};

/** The env var names the connect flow may write for an entry. Explicit
 *  envKeys win; no envKeys = a generic <SLUG>_API_KEY; [] = guidance only
 *  (the tool connects through something other than a pasted key). */
export function connectKeysFor(entry: Integration): string[] {
  if (entry.envKeys) return entry.envKeys;
  return [`${entry.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`];
}

/** Merge live connector state onto the catalog. `connected` is true only when a
 *  linked connector actually reports 'connected' — never faked. `keySaved`
 *  means every connect-flow key for the entry sits in .env.local (pass a fresh
 *  readEnvLocal()); a saved key on a connector-less tile shows as stored, not
 *  connected. */
export function connectionCatalog(
  statuses: ConnectorStatus[],
  savedEnv: Record<string, string> = {},
): CatalogEntry[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return INTEGRATIONS.map((i) => {
    const keys = connectKeysFor(i);
    return {
      ...i,
      connected: i.connectorId ? byId.get(i.connectorId)?.state === 'connected' : false,
      keySaved: keys.length > 0 && keys.every((k) => Boolean(savedEnv[k])),
      configHref: i.connectorId ? byId.get(i.connectorId)?.configHref : undefined,
      capabilities: i.connectorId ? byId.get(i.connectorId)?.capabilities : undefined,
    };
  });
}

/** Catalog grouped by category, in the canonical category order, skipping any
 *  category with no tools. */
export function integrationsByCategory(
  entries: Integration[] = INTEGRATIONS,
): Map<IntegrationCategory, Integration[]> {
  const out = new Map<IntegrationCategory, Integration[]>();
  for (const cat of INTEGRATION_CATEGORIES) {
    const tools = entries.filter((i) => i.category === cat);
    if (tools.length) out.set(cat, tools);
  }
  return out;
}

/**
 * "Popular" on the GladOS Connections board (glados-ui SPEC S05 F05.71): the
 * popular tools that are not connected yet, so a connected tool never shows
 * twice. Empty means the section hides.
 */
export function popularNotConnected<T extends { popular?: boolean; connected: boolean }>(catalog: readonly T[]): T[] {
  return catalog.filter((c) => c.popular && !c.connected);
}

/**
 * Deep-link for "Set up" buttons across the OS: the integrations board tile
 * for this connector (cards carry id={slug} anchors), else the tile whose
 * slug matches, or the board itself when nothing in the catalogue matches.
 */
export function setupHrefFor(connectorId: string): string {
  // a catalogue-only tool (no connector yet, e.g. vidalytics) deep-links by its slug
  const entry = INTEGRATIONS.find((e) => e.connectorId === connectorId) ?? INTEGRATIONS.find((e) => e.slug === connectorId);
  return entry ? `/integrations#${entry.slug}` : '/integrations';
}
