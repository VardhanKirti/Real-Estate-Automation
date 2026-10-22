/**
 * Campaign rename rules (SPEC §5 C7, S03 FR-4): the name is a label, the
 * concept text does not change. Max 60 characters (what the store names a
 * campaign from its concept), whitespace collapsed, empty refused, and an
 * unchanged name sends no request.
 */
export const CAMPAIGN_NAME_MAX = 60;

export type NameCheck = { kind: 'ok'; name: string } | { kind: 'unchanged' } | { kind: 'error'; message: string };

export function validateCampaignName(input: string, current: string): NameCheck {
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name) return { kind: 'error', message: 'Name cannot be empty' };
  if (name.length > CAMPAIGN_NAME_MAX) return { kind: 'error', message: `Keep it to ${CAMPAIGN_NAME_MAX} characters` };
  if (name === current.trim()) return { kind: 'unchanged' };
  return { kind: 'ok', name };
}
