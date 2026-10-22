import { describe, expect, test } from 'vitest';
import {
  CAMPAIGN_STAGES,
  CampaignSchema,
  activeCampaign,
  contentCampaigns,
} from '@/lib/content-campaigns';

describe('contentCampaigns', () => {
  test('every campaign validates against the schema', () => {
    for (const c of contentCampaigns()) {
      expect(() => CampaignSchema.parse(c)).not.toThrow();
    }
  });

  test('stage values are legal', () => {
    for (const c of contentCampaigns()) {
      expect(CAMPAIGN_STAGES).toContain(c.stage);
    }
  });

  test('carries both real campaigns', () => {
    const ids = contentCampaigns().map((c) => c.id);
    expect(ids).toContain('higgsfield-api-reel');
    expect(ids).toContain('openai-gpt6-astra-launch');
  });

  test('the active campaign is the Higgsfield API reel, in production', () => {
    const active = activeCampaign();
    expect(active).not.toBeNull();
    expect(active?.id).toBe('higgsfield-api-reel');
    expect(active?.stage).toBe('production');
  });

  test('Higgsfield campaign carries both allowed disclosure hashtags', () => {
    const c = contentCampaigns().find((x) => x.id === 'higgsfield-api-reel');
    expect(c?.requirements.hashtags).toEqual(
      expect.arrayContaining(['#HiggsfieldPartner', '#HiggsfieldCreator']),
    );
    expect(c?.requirements.hashtags.length).toBe(2);
  });

  test('Higgsfield campaign carries exactly the four brief don\'ts', () => {
    const c = contentCampaigns().find((x) => x.id === 'higgsfield-api-reel');
    expect(c?.donts).toHaveLength(4);
    expect(c?.donts.join(' ')).toMatch(/setup look complicated/i);
    expect(c?.donts.join(' ')).toMatch(/skip the comment CTA/i);
    expect(c?.donts.join(' ')).toMatch(/broken.*low-quality/i);
    expect(c?.donts.join(' ')).toMatch(/hide likes/i);
  });

  test('the OpenAI campaign is confidential and not active', () => {
    const c = contentCampaigns().find((x) => x.id === 'openai-gpt6-astra-launch');
    expect(c?.confidential).toBe(true);
    expect(c?.active).toBe(false);
    expect(c?.dueDate).toBe('2026-09-02');
  });
});
