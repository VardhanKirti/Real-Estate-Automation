import { afterEach, describe, expect, test } from 'vitest';
import { engineEnv, engineEnvName } from '@/lib/creative-engine/env';
import { dryLabel, envDry } from '@/lib/creative-engine/dry';
import { statusCard } from '@/lib/creative-engine/status-card';

const NAMES = ['CREATIVE_ENGINE_DRY', 'AD_ENGINE_DRY', 'CREATIVE_ENGINE_CREDIT_CAP', 'AD_ENGINE_CREDIT_CAP'] as const;
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

function clear() {
  for (const n of NAMES) delete process.env[n];
}

describe('engineEnv: CREATIVE_ENGINE_* with the AD_ENGINE_* fallback (S02 FR-12)', () => {
  test('unset reads undefined and names the new variable', () => {
    clear();
    expect(engineEnv('DRY')).toBeUndefined();
    expect(engineEnvName('DRY')).toBe('CREATIVE_ENGINE_DRY');
    expect(envDry()).toBe(false);
  });

  test('the old name alone still works', () => {
    clear();
    process.env.AD_ENGINE_DRY = '1';
    expect(engineEnv('DRY')).toBe('1');
    expect(envDry()).toBe(true);
    expect(engineEnvName('DRY')).toBe('AD_ENGINE_DRY');
    expect(dryLabel()).toContain('AD_ENGINE_DRY=1');
  });

  test('the new name wins over the old one', () => {
    clear();
    process.env.AD_ENGINE_DRY = '1';
    process.env.CREATIVE_ENGINE_DRY = '0';
    expect(engineEnv('DRY')).toBe('0');
    expect(envDry()).toBe(false);
    process.env.CREATIVE_ENGINE_CREDIT_CAP = '50';
    process.env.AD_ENGINE_CREDIT_CAP = '999';
    expect(engineEnv('CREDIT_CAP')).toBe('50');
  });

  test('the dry status card quotes whichever name is set', () => {
    const base = { sample: false, dryEnv: true, filming: false, foreplayConfigured: true, campaign: null };
    expect(statusCard(base).body).toContain('CREATIVE_ENGINE_DRY=1');
    expect(statusCard({ ...base, dryEnvName: 'AD_ENGINE_DRY' }).body).toContain('AD_ENGINE_DRY=1');
  });
});
