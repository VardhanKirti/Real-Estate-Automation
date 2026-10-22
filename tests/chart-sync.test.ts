import { describe, expect, test, vi } from 'vitest';
import { getCursor, setCursor, stepCursor, subscribeCursor } from '@/lib/chart-sync';

describe('chart-sync (GP3 syncId, ACGP3.5)', () => {
  test('two charts in one group see one cursor move from one pointer move', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeCursor('social', a);
    const offB = subscribeCursor('social', b);
    setCursor('social', 4, 'area');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(getCursor('social')).toEqual({ index: 4, source: 'area' });
    offA();
    offB();
  });

  test('groups are isolated, unchanged writes do not notify, clearing resets', () => {
    const fn = vi.fn();
    const off = subscribeCursor('g1', fn);
    setCursor('g2', 1);
    expect(fn).not.toHaveBeenCalled();
    setCursor('g1', 2, 'x');
    setCursor('g1', 2, 'x');
    expect(fn).toHaveBeenCalledTimes(1);
    setCursor('g1', null);
    expect(getCursor('g1').index).toBeNull();
    off();
  });

  test('one keypress moves the shared cursor one bucket', () => {
    expect(stepCursor(null, 'ArrowLeft', 7)).toBe(6);
    expect(stepCursor(null, 'ArrowRight', 7)).toBe(0);
    expect(stepCursor(3, 'ArrowLeft', 7)).toBe(2);
    expect(stepCursor(6, 'ArrowRight', 7)).toBe(6);
    expect(stepCursor(3, 'Home', 7)).toBe(0);
    expect(stepCursor(3, 'End', 7)).toBe(6);
    expect(stepCursor(3, 'x', 7)).toBeNull();
    expect(stepCursor(null, 'ArrowLeft', 0)).toBeNull();
  });
});
