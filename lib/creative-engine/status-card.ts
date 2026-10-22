import type { CampaignOrigin } from '@/lib/creative-engine/schemas';

/**
 * The Creative Engine status card copy (SPEC §5 C8). One precedence, so the
 * card never claims more than is true:
 *   sample > CREATIVE_ENGINE_DRY session > loaded campaign is dry > Filming >
 *   Foreplay missing > live.
 * Filming forces every paid action dry (Q-ENG-7, lib/creative-engine/dry.ts), so
 * its card says so: claiming "Live · Credits in play" there would be false.
 */

export type StatusKind = 'sample' | 'dry-session' | 'dry-campaign' | 'filming' | 'arcads-only' | 'live';

export type StatusCard = { kind: StatusKind; badge: string; title: string; body: string };

export type StatusInput = {
  sample: boolean;
  /** CREATIVE_ENGINE_DRY=1 (or legacy AD_ENGINE_DRY=1) for this process (not the Filming force). */
  dryEnv: boolean;
  /** Which of the two names is set, so the card quotes it; defaults to the new name. */
  dryEnvName?: string;
  filming: boolean;
  foreplayConfigured: boolean;
  campaign: { origin: CampaignOrigin; assets: number } | null;
};

const SPENDS = 'Research spends Foreplay credits; generation spends Arcads credits, read after the charge.';

export function statusCard(i: StatusInput): StatusCard {
  if (i.sample) return { kind: 'sample', badge: 'Sample data', title: 'A fictional preview', body: 'Every brand, ad and figure here is made up. Nothing is stored and actions are off.' };
  if (i.dryEnv) return { kind: 'dry-session', badge: 'Dry run', title: 'Fixtures, nothing charged', body: `Foreplay, Arcads and Claude return fixtures while ${i.dryEnvName ?? 'CREATIVE_ENGINE_DRY'}=1.` };
  if (i.campaign?.origin === 'dry') {
    return {
      kind: 'dry-campaign',
      badge: 'Dry run',
      title: 'Dry-run data',
      body: `This campaign's research came from fixtures.${i.campaign.assets > 0 ? ' Its delivered videos are real.' : ''}`,
    };
  }
  if (i.filming) return { kind: 'filming', badge: 'Filming', title: 'Dry runs, nothing charged', body: 'Filming mode forces every Foreplay, Arcads and Claude call to return fixtures. No credits are spent.' };
  if (!i.foreplayConfigured) return { kind: 'arcads-only', badge: 'Live', title: 'Arcads only', body: 'Generation spends Arcads credits. Research needs the Foreplay key.' };
  return { kind: 'live', badge: 'Live', title: 'Credits in play', body: SPENDS };
}

/** The dry tag shown beside the H1 and in the Angles, Proof strength and Proof library headers (S03 FR-3). */
export const DRY_CAMPAIGN_TAG = 'Dry-run research · fixtures, not real ads';
