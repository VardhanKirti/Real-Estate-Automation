/**
 * Screen context for the Wizard panel — a short, honest summary of what
 * the operator is looking at, resolved per route and handed to the agent so
 * it can talk about the screen (Notion-agent style). The funnel gets the
 * full live read; other views get cheap repo-backed counts; unknown paths
 * degrade to the route name. Never blocks a chat: resolvers that fail return
 * a plain title line.
 */
import { BRAND } from '@/lib/brand';
import { NAV_EXTRA, NAV_ITEMS, activeHref } from '@/lib/nav';
import { getDb } from '@/lib/data';
import { funnelSummary, journeyMeta, splitFunnelJourneys, FUNNEL_STAGES } from '@/lib/funnel';
import { attioFunnelJourneys } from '@/lib/funnel-live';
import { ghlFunnelJourneys } from '@/lib/funnel-ghl';
import type { LabStore } from '@/lib/lab/store';

/** The fallback line when a view has no richer summary: names the product by
 *  this deployment's BRAND.name, never a literal (glados-ui §3.6). */
export function plainScreenContext(title: string): string {
  return `${title} view of ${BRAND.name}.`;
}

/** The screen's name: a palette-only view by its own label first (so /org
 *  reads "Org Chart", not the Agents item it highlights), then the sidebar
 *  item activeHref() picks, then the raw path. */
export function screenTitleFor(path: string): string {
  const clean = path.split('?')[0] || '/';
  const extra = NAV_EXTRA.find((n) => clean === n.href || clean.startsWith(`${n.href}/`));
  if (extra) return extra.label;
  const href = activeHref(clean);
  return NAV_ITEMS.find((n) => n.href === href)?.label ?? clean;
}

export type FunnelContextInput = {
  clients: number;
  converted: number;
  revenueUsd: number;
  stageCounts: [string, number][];
  archived: number;
  sources: string;
  decaying: number;
  reddest: { name: string; days: number }[];
};

/** Pure formatter — what the Wizard reads about the funnel screen. */
export function describeFunnelContext(d: FunnelContextInput): string {
  return [
    `Funnel: ${d.clients} active leads across ${d.sources}; ${d.converted} converted ($${Math.round(d.revenueUsd).toLocaleString('en-US')}); ${d.archived} archived (>90d quiet).`,
    `Current stage counts — ${d.stageCounts.map(([label, n]) => `${label}: ${n}`).join(' · ')}.`,
    `${d.decaying} fading toward the 90-day archive (quiet >21d).`,
    d.reddest.length > 0
      ? `Most at risk: ${d.reddest.map((r) => `${r.name} (${r.days}d quiet)`).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function funnelContext(): Promise<string> {
  const now = new Date();
  const [attioLive, ghlLive] = await Promise.all([attioFunnelJourneys(now), ghlFunnelJourneys(now)]);
  const live = [...(attioLive?.journeys ?? []), ...(ghlLive?.journeys ?? [])];
  const all = live.length > 0 ? live : getDb().funnel.journeys();
  const { active, archived } = splitFunnelJourneys(all, now);
  const summary = funnelSummary(active);
  const metas = active.map((j) => ({ j, meta: journeyMeta(j, now) }));
  const decaying = metas.filter(({ j, meta }) => j.status !== 'converted' && meta.daysSinceLastTouch > 21).length;
  const reddest = metas
    .filter(({ j }) => j.status !== 'converted')
    .sort((a, b) => b.meta.daysSinceLastTouch - a.meta.daysSinceLastTouch)
    .slice(0, 5)
    .map(({ j, meta }) => ({ name: j.name, days: meta.daysSinceLastTouch }));
  const stageCounts = new Map<string, number>();
  for (const j of active) {
    const label = FUNNEL_STAGES.find((s) => s.id === j.status)?.label ?? j.status;
    stageCounts.set(label, (stageCounts.get(label) ?? 0) + 1);
  }
  const sources =
    live.length > 0
      ? [
          attioLive?.journeys.length ? `Attio ${attioLive.total}` : null,
          ghlLive?.journeys.length ? `GHL ${ghlLive.total}` : null,
        ]
          .filter(Boolean)
          .join(' + ') + ' (live)'
      : 'KB snapshot (CRM not keyed)';
  return describeFunnelContext({
    clients: summary.clients,
    converted: summary.converted,
    revenueUsd: summary.revenueUsd,
    stageCounts: FUNNEL_STAGES.map((s) => [s.label, stageCounts.get(s.label) ?? 0]),
    archived: archived.length,
    sources,
    decaying,
    reddest,
  });
}

/** Content Lab (content-lab SPEC §5.1): tracked creators, posts scraped, new breakouts this week, open trends, ideas queued. */
export function describeLabContext(title: string, lab: LabStore, now: Date = new Date()): string {
  const sources = lab.sources.all().filter((s) => s.status === 'active');
  const owned = sources.filter((s) => s.kind === 'owned').length;
  const tracked = sources.filter((s) => s.kind === 'tracked').length;
  if (owned + tracked === 0 && lab.posts.count() === 0) return `${title}: nothing added yet. No accounts or tracked creators; Apify scraping starts once accounts are added.`;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const measures = new Map(lab.measures.all().map((m) => [m.postId, m]));
  const posts = lab.posts.all();
  const fresh = posts.filter((p) => !p.isOwned && (p.postedAt ?? '') >= weekAgo && measures.get(p.id)?.isBreakout).length;
  const latest = new Map<string, string | null>();
  for (const s of lab.trendSnapshots.all()) latest.set(s.clusterId, s.timing);
  const open = [...latest.values()].filter((t) => t === 'early' || t === 'open').length;
  const ideas = lab.ideas.all('open').length;
  return `${title}: ${owned} of your accounts, ${tracked} tracked creators, ${posts.length} posts scraped; ${fresh} new breakouts this week; ${open} open trends; ${ideas} ideas queued.`;
}

/** Route-aware context. Cheap everywhere except the funnel (the flagship). */
export async function screenContextFor(path: string): Promise<{ title: string; context: string }> {
  const title = screenTitleFor(path);
  const clean = path.split('?')[0] || '/';
  try {
    if (clean.startsWith('/funnel')) {
      return { title, context: await funnelContext() };
    }
    const db = getDb();
    if (clean === '/' || clean.startsWith('/agents') || clean.startsWith('/org')) {
      const agents = db.agents.all();
      const active = agents.filter((a) => a.status === 'active').length;
      return {
        title,
        context: `${title}: agent roster — ${agents.length} agents (${active} active) across ${db.departments.all().length} pillars.`,
      };
    }
    if (clean.startsWith('/integrations')) {
      const tools = db.tools.all();
      return {
        title,
        context: `${title}: connections board — ${tools.length} integrations tracked (${tools.filter((t) => t.status === 'connected').length} connected).`,
      };
    }
    if (clean.startsWith('/roadmap')) {
      return { title, context: `${title}: ${db.roadmap.all().length} roadmap items across quarters.` };
    }
    if (clean.startsWith('/brand-deals')) {
      const { getBrandDeals } = await import('@/lib/brand-deals');
      const s = await getBrandDeals();
      return {
        title,
        context: `${title}: brand-deal pipeline — ${s.counts.approval} drafts need Telegram approval, ${s.counts.sent} sent awaiting brand, ${s.counts.unique} flagged unique. Read-only board; the send gate is the operator's Telegram tap.`,
      };
    }
    if (clean.startsWith('/lab')) {
      return { title, context: describeLabContext(title, db.lab) };
    }
    return { title, context: plainScreenContext(title) };
  } catch {
    return { title, context: plainScreenContext(title) };
  }
}
