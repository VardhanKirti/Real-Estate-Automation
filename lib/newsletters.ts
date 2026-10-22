import { z } from 'zod';
import { beehiivPosts, type Newsletter } from '@/lib/connectors/beehiiv';
import { runtimeEnv } from '@/lib/creds';

export type { Newsletter };

/** Zod guard for a Newsletter crossing the connector/seed boundary. */
export const NewsletterSchema = z.object({
  id: z.string(),
  title: z.string(),
  publishedAt: z.string(),
  webUrl: z.string().nullable(),
  recipients: z.number().nonnegative(),
  delivered: z.number().nonnegative(),
  deliveryRate: z.number(),
  opens: z.number().nonnegative(),
  openRate: z.number(),
  clicks: z.number().nonnegative(),
  clickRate: z.number(),
  unsubscribes: z.number().nonnegative(),
  unsubscribeRate: z.number(),
  spamReports: z.number().nonnegative(),
  webViews: z.number().nonnegative(),
});

/**
 * Intentionally empty: no invented issues. Live Beehiiv posts fill this once
 * BEEHIIV_API_KEY lands; until then the page shows an honest empty state.
 */
export const SEED_NEWSLETTERS: Newsletter[] = [];

/** Live newsletters when the connector has data, else the seeded fallback. */
export async function getNewsletters(
  env: Record<string, string | undefined> = runtimeEnv(),
): Promise<Newsletter[]> {
  const live = await beehiivPosts(env);
  if (live && live.length > 0) return live;
  return SEED_NEWSLETTERS;
}

export type NewsletterSummary = {
  count: number;
  totalRecipients: number;
  /** Null when nothing was sent: no issue, no rate (never a fake 0.0%). */
  avgOpenRate: number | null;
  bestOpenRate: number | null;
};

/** Roll a newsletter list into headline figures. Empty-safe: with no issues
    the open rates are null, not zero (H20). */
export function newsletterSummary(list: Newsletter[]): NewsletterSummary {
  if (list.length === 0) return { count: 0, totalRecipients: 0, avgOpenRate: null, bestOpenRate: null };
  const totalRecipients = list.reduce((s, n) => s + n.recipients, 0);
  const avgOpenRate = list.reduce((s, n) => s + n.openRate, 0) / list.length;
  const bestOpenRate = Math.max(...list.map((n) => n.openRate));
  return {
    count: list.length,
    totalRecipients,
    avgOpenRate: Math.round(avgOpenRate * 100) / 100,
    bestOpenRate,
  };
}
