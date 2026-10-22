import { z } from 'zod';

/**
 * Brand-deal campaigns the Creative Director is steering. These are REAL
 * campaigns — every fact below is verbatim from the actual sponsor briefs.
 * Do not embellish, do not invent requirements that are not in the brief.
 */

export const CAMPAIGN_STAGES = ['brief', 'concept', 'production', 'review', 'posted'] as const;
export const CampaignStageSchema = z.enum(CAMPAIGN_STAGES);
export type CampaignStage = z.infer<typeof CampaignStageSchema>;

export const CampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sponsor: z.string().min(1),
  product: z.string().nullable(),
  deliverable: z.string().min(1),
  /** ISO date the deliverable must go live (launch day / deadline), if fixed. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  stage: CampaignStageSchema,
  active: z.boolean(),
  confidential: z.boolean(),
  /** The content angle, straight from the brief. */
  angle: z.string().min(1),
  /** How the piece must feel, straight from the brief. */
  framing: z.string().nullable(),
  /** Verbatim quote from the brief worth keeping in front of the writer. */
  briefQuote: z.string().nullable(),
  /** Example apps / references named in the media kit. */
  references: z.array(z.string()),
  requirements: z.object({
    /** Account that must be tagged in the caption. */
    mention: z.string().nullable(),
    /** Disclosure hashtags — at least one must appear in the caption. */
    hashtags: z.array(z.string()),
    /** Comment-keyword CTA driving DM automation, if required. */
    commentCta: z.boolean(),
    /** The spoken/on-screen CTA, if the brief names one. */
    cta: z.string().nullable(),
    /** Deliverable duration bounds in seconds, if the brief sets them. */
    durationSec: z.tuple([z.number().positive(), z.number().positive()]).nullable(),
  }),
  /** Brief do's, verbatim. */
  dos: z.array(z.string()),
  /** Brief don'ts, verbatim. */
  donts: z.array(z.string()),
});
export type Campaign = z.infer<typeof CampaignSchema>;

const RAW_CAMPAIGNS: Campaign[] = [
  {
    id: 'higgsfield-api-reel',
    name: 'Higgsfield API reel',
    sponsor: 'Higgsfield',
    product: 'Higgsfield API (open.higgsfield.ai)',
    deliverable: 'Instagram Reel, 40–150 seconds',
    dueDate: null,
    stage: 'production',
    active: true,
    confidential: false,
    angle:
      '"Find any App that makes real money, re-create it, and sell it" — show app revenue stats (AppTracker / AppMagic), then how you\'d build the same with the Higgsfield API, then distribution and scaling.',
    framing: 'Must feel organic — "no promo intros, no sponsored energy in the first seconds".',
    briefQuote: null,
    references: ['Bettershot', 'FitCheck', 'Love Story'],
    requirements: {
      mention: '@higgsfield.ai',
      hashtags: ['#HiggsfieldPartner', '#HiggsfieldCreator'],
      commentCta: true,
      cta: 'Comment KEY WORD (drives DM automation)',
      durationSec: [40, 150],
    },
    dos: [
      'Caption includes @higgsfield.ai plus one of #HiggsfieldPartner / #HiggsfieldCreator',
      'Comment-keyword CTA ("comment KEY WORD") driving DM automation',
      'UTM link to the landing page',
      'Trending IG audio',
      'Upload highest quality',
    ],
    donts: [
      "Don't make setup look complicated",
      "Don't skip the comment CTA",
      "Don't show broken or low-quality outputs as the main result",
      "Don't hide likes, views, or comments",
    ],
  },
  {
    id: 'openai-gpt6-astra-launch',
    name: 'OpenAI GPT-6 Astra creator launch',
    sponsor: 'OpenAI',
    product: 'GPT-6 Astra',
    deliverable: 'Launch-day creator video',
    dueDate: '2026-09-02',
    stage: 'concept',
    active: false,
    confidential: true,
    angle:
      'Announce GPT-6 Astra and "show one authentic workflow: start with a real goal, not a scripted demo" — capture the full arc: ask → context → work in progress → course correction → finished result.',
    framing: 'One small memorable use case, with a genuine reaction.',
    briefQuote: '"GPT-6 Astra just does it. It\'s the model to choose when intelligence matters."',
    references: [],
    requirements: {
      mention: null,
      hashtags: [],
      commentCta: false,
      cta: 'Try GPT-6 Astra in ChatGPT',
      durationSec: null,
    },
    dos: [
      'Start with a real goal, not a scripted demo',
      'Capture the full arc: ask → context → work in progress → course correction → finished result',
      'One small memorable use case',
      'Genuine reaction',
      'CTA: "Try GPT-6 Astra in ChatGPT"',
    ],
    donts: ['Confidential brief — nothing goes public before launch day (September 2, 2026)'],
  },
];

/** All campaigns, schema-validated on the way out. Active campaign first. */
export function contentCampaigns(): Campaign[] {
  return RAW_CAMPAIGNS.map((c) => CampaignSchema.parse(c)).sort(
    (a, b) => Number(b.active) - Number(a.active),
  );
}

/** The campaign the Creative Director is currently steering, if any. */
export function activeCampaign(): Campaign | null {
  return contentCampaigns().find((c) => c.active) ?? null;
}
