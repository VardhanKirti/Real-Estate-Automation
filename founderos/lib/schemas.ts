import { z } from 'zod';

/**
 * GladOS's schemas, plus the few shapes the FounderOS v1 screens in
 * founderos/ were written against and GladOS does not carry (FounderOS v1
 * lib/schemas.ts). Everything else is GladOS's own, from one database.
 */
export * from '@/lib/schemas';

// ── Proposals — client proposals, shown as folders in Deliverables ───────────
export const ProposalBrandSchema = z.enum(['vantage', 'launchpad-cohort']);
export const ProposalStatusSchema = z.enum(['draft', 'sent', 'won', 'lost']);
export const ProposalSchema = z.object({
  id: z.string().min(1),
  client: z.string().min(1),
  brand: ProposalBrandSchema,
  url: z.string().url(),
  status: ProposalStatusSchema,
  amountUsd: z.number().finite().nullable(),
  notes: z.string(),
  createdAt: z.string().min(1),
  origin: z.enum(['seed', 'os']).default('seed'),
  accessCode: z.string().default(''),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalBrand = z.infer<typeof ProposalBrandSchema>;

// ── Deliverable decisions — approve or dismiss a file an agent staged ────────
export const DECISION_KINDS = ['approved', 'dismissed'] as const;
export const DecisionKindSchema = z.enum(DECISION_KINDS);
export const DeliverableDecisionSchema = z.object({
  /** `<workspaceId>/<filename>` for an agent file, `proposal:<id>` for a proposal */
  id: z.string().min(1),
  decision: DecisionKindSchema,
  decidedAt: z.string().min(1),
  /** The revision the call was made against, so an agent rewriting the file reopens it. */
  decidedRevision: z.string().default(''),
  note: z.string().default(''),
});
export type DeliverableDecision = z.infer<typeof DeliverableDecisionSchema>;
export type DecisionKind = z.infer<typeof DecisionKindSchema>;
