import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CAMPAIGN_NAME_MAX, validateCampaignName } from '@/lib/creative-engine/campaign-name';
import { originTag } from '@/components/creative-engine/CampaignSwitcher';

/** SPEC §5 C6 / C7, S03 FR-4, FR-6, FR-10. */

describe('rename rules', () => {
  test('empty is refused, whitespace collapses, same name sends nothing, 60 is the cap', () => {
    expect(validateCampaignName('   ', 'x')).toEqual({ kind: 'error', message: 'Name cannot be empty' });
    expect(validateCampaignName('  Lamp   launch ', 'old')).toEqual({ kind: 'ok', name: 'Lamp launch' });
    expect(validateCampaignName('Same ', 'Same')).toEqual({ kind: 'unchanged' });
    expect(validateCampaignName('x'.repeat(CAMPAIGN_NAME_MAX + 1), 'old').kind).toBe('error');
    expect(validateCampaignName('x'.repeat(CAMPAIGN_NAME_MAX), 'old').kind).toBe('ok');
  });
});

describe('switcher rows', () => {
  test('dry and filming campaigns carry their tag; live carries none', () => {
    expect(originTag('dry')).toBe('Dry run');
    expect(originTag('filming')).toBe('Filming');
    expect(originTag('live')).toBeNull();
  });
});

describe('dashboard wiring', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'components/creative-engine/Dashboard.tsx'), 'utf8');
  test('the campaigns pill opens the switcher, not the generator, when campaigns exist', () => {
    expect(src).toContain('<CampaignSwitcher');
    expect(src).toMatch(/aria-expanded=\{switcherOpen\}/);
  });
  test('delete goes through the in-page confirm, never window.confirm', () => {
    expect(src).toContain('<DeleteCampaignDialog');
    expect(src).not.toMatch(/window\.confirm|\bconfirm\(/);
  });
  test('the H1 has a rename button and a campaign actions menu', () => {
    expect(src).toContain('aria-label="Rename campaign"');
    expect(src).toContain('label="Campaign actions"');
  });
  test('re-run research live is a two-step gate that names the cost (S03 FR-5)', () => {
    expect(src).toContain('function RerunResearch');
    expect(src).toContain('Spends up to ${max} Foreplay credits.');
    expect(src).toMatch(/setPhase\('confirm'\)/);
    expect(src).toMatch(/title="Research needs the Foreplay key"/);
  });
});
