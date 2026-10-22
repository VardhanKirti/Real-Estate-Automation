import type { Campaign, CampaignOrigin } from '@/lib/creative-engine/schemas';

/**
 * Which campaign the Creative Engine opens on first paint (S03 FR-2), and the
 * summary row every list (page, route, switcher) is built from. Pure and
 * client-safe: type imports only.
 */

export type CampaignSummary = {
  id: string;
  name: string;
  origin: CampaignOrigin;
  concept: Campaign['concept'];
  hasResearch: boolean;
  angles: number;
  selected: number;
  scripts: number;
  briefs: number;
  assets: number;
  updatedAt: string;
};

export function toSummary(c: Campaign): CampaignSummary {
  return {
    id: c.id,
    name: c.name,
    origin: c.origin,
    concept: c.concept,
    hasResearch: c.research !== null,
    angles: c.angles.length,
    selected: c.angles.filter((a) => a.selected).length,
    scripts: c.scripts.length,
    briefs: c.briefs.length,
    assets: c.assets.length,
    updatedAt: c.updatedAt,
  };
}

export type PickContext = {
  /** CREATIVE_ENGINE_DRY is on for this process: a deliberate test session. */
  dry: boolean;
  /** Filming mode: the store is the demo world. */
  filming: boolean;
};

/** May this campaign open on its own, without the operator asking for it? */
export function autoOpenable(c: Pick<CampaignSummary, 'origin'>, ctx: PickContext): boolean {
  if (ctx.dry) return true;
  if (ctx.filming) return c.origin !== 'dry';
  return c.origin === 'live';
}

function newestFirst<T extends Pick<CampaignSummary, 'updatedAt'>>(list: T[]): T[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The most recently updated campaign that may auto-open: live ones normally,
 * Filming ones (and live) while filming, anything in a dry session. Dry
 * campaigns are never opened as if they were live. Null means the empty state.
 */
export function pickInitialCampaign<T extends Pick<CampaignSummary, 'id' | 'origin' | 'updatedAt'>>(list: T[], ctx: PickContext): T | null {
  const sorted = newestFirst(list);
  if (ctx.filming && !ctx.dry) {
    const film = sorted.find((c) => c.origin === 'filming');
    if (film) return film;
  }
  return sorted.find((c) => autoOpenable(c, ctx)) ?? null;
}

/** Campaigns kept off auto-open, for the "1 dry-run campaign hidden. Show" line (S03 FR-7, FR-20). */
export function hiddenCampaigns<T extends Pick<CampaignSummary, 'origin'>>(list: T[], ctx: PickContext): T[] {
  return list.filter((c) => !autoOpenable(c, ctx));
}

/** "1 dry-run campaign hidden" / "2 dry-run campaigns hidden" / "3 campaigns hidden". */
export function hiddenLine(hidden: Pick<CampaignSummary, 'origin'>[]): string | null {
  if (hidden.length === 0) return null;
  const allDry = hidden.every((c) => c.origin === 'dry');
  const n = hidden.length;
  return `${n} ${allDry ? 'dry-run ' : ''}campaign${n === 1 ? '' : 's'} hidden.`;
}
