import { describe, expect, it } from 'vitest';
import { popularNotConnected } from '@/lib/integrations-catalog';

/** glados-ui SPEC S05 F05.71, AC05.14: no tool shows in both "Your connected tools" and "Popular". */
describe('popular tools on the GladOS Connections board', () => {
  it('drops connected entries and keeps only popular ones', () => {
    const catalog = [
      { slug: 'slack', popular: true, connected: true },
      { slug: 'zoom', popular: true, connected: false },
      { slug: 'gmail', popular: true, connected: true },
      { slug: 'linear', popular: false, connected: false },
    ];
    expect(popularNotConnected(catalog).map((c) => c.slug)).toEqual(['zoom']);
  });

  it('is empty when every popular tool is connected, so the section hides (edge 12)', () => {
    expect(popularNotConnected([{ slug: 'slack', popular: true, connected: true }])).toEqual([]);
  });
});
