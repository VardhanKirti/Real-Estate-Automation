/**
 * Workflow step tools are stored as short ids ('ghl', 'calendar', 'gmail');
 * the map cards render them with the actual company logo. This is the id →
 * brand bridge: every id used by seeded workflows has an explicit entry
 * (enforced by tests/workflow-tool-brands.test.ts against hasBrandMark), and
 * unknown ids degrade to an identity that BrandLogo renders as a lettermark.
 * Pure data — safe to import anywhere; the logo rendering itself stays
 * server-side (BrandLogo pulls simple-icons, which must not enter the client
 * bundle).
 */

export type ToolBrand = { slug: string; name: string };

export const TOOL_BRANDS: Record<string, ToolBrand> = {
  attio: { slug: 'attio', name: 'Attio' },
  calendar: { slug: 'googlecalendar', name: 'Google Calendar' },
  camera: { slug: 'camera', name: 'Camera' },
  'claude-code': { slug: 'anthropic', name: 'Claude Code' },
  ghl: { slug: 'gohighlevel', name: 'GoHighLevel' },
  gmail: { slug: 'gmail', name: 'Gmail' },
  gsend: { slug: 'gsend', name: 'gsend' },
  instagram: { slug: 'instagram', name: 'Instagram' },
  linkedin: { slug: 'linkedin', name: 'LinkedIn' },
  notion: { slug: 'notion', name: 'Notion' },
  premiere: { slug: 'premiere', name: 'Premiere Pro' },
  slack: { slug: 'slack', name: 'Slack' },
  telegram: { slug: 'telegram', name: 'Telegram' },
  youtube: { slug: 'youtube', name: 'YouTube' },
};

export function toolBrand(toolId: string): ToolBrand {
  return TOOL_BRANDS[toolId] ?? { slug: toolId, name: toolId };
}
