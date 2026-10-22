import { describe, expect, it } from 'vitest';
import { titleCase } from '@/lib/lab/clusters';

describe('topic labels (lib/lab/clusters titleCase)', () => {
  it('sentence-cases and keeps known acronyms upper case', () => {
    expect(titleCase('ai video editing')).toBe('AI video editing');
    expect(titleCase('  mcp   servers ')).toBe('MCP servers');
    expect(titleCase('voice cloning')).toBe('Voice cloning');
    expect(titleCase('main street')).toBe('Main street');
  });
});
