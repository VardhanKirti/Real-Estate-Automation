/**
 * Rollout progress for the new UI style (SPEC S00 FR-13, FR-14).
 *
 * Settings states honestly how many pages already render their new-style
 * widgets: "{n} of {m} pages use the new widgets". `m` is every page the
 * rollout covers, which is the audit's route list (scripts/audit-routes.mjs
 * AUDIT_ROUTES, Phase 4 exit: G_READY holds every one of them) as distinct
 * pathnames. tests/appearance-picker.test.ts keeps the two lists equal.
 */
import { G_READY } from './g-ready';

export const G_ROLLOUT_ROUTES: readonly string[] = [
  '/', '/wizard', '/inbox', '/funnel', '/brand-deals', '/workflows', '/social', '/social/beehiiv', '/adpilot',
  '/creative-engine', '/finances', '/trading', '/agents', '/chats', '/tasks', '/skills', '/blueprint',
  '/database', '/compute', '/usage', '/brain', '/knowledge', '/drift', '/org', '/analytics', '/lab', '/roadmap',
  '/integrations', '/integrations/whatsapp', '/setup', '/login',
  '/clients', '/lead-magnets',
];

export type RolloutProgress = { ready: number; total: number };

/** Converted pages out of the rollout's pages; a G_READY entry outside the list does not count. */
export function rolloutProgress(ready: readonly string[] = G_READY): RolloutProgress {
  const set = new Set(ready);
  return { ready: G_ROLLOUT_ROUTES.filter((r) => set.has(r)).length, total: G_ROLLOUT_ROUTES.length };
}

/** The Settings line, or null once every page is converted (the line is removed at G-final). */
export function rolloutLine({ ready, total }: RolloutProgress): string | null {
  if (ready >= total) return null;
  return `${ready} of ${total} pages use the new widgets; the rest keep Classic widgets in your colours.`;
}
