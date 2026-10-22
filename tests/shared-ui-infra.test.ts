import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchEscape,
  escapeDepth,
  isTopEscape,
  pushEscape,
  resetEscapeStackForTests,
  topEscapeId,
} from '@/lib/escape-stack';
import { FOCUSABLE_SELECTOR, isCloseLabel, lockBodyScroll, trapTabIndex } from '@/components/ui/use-dialog';
import { TOAST_DEFAULT_MS, TOAST_MAX, ToastProvider, ToastStack, pushToast, toToastItem } from '@/components/ui/Toast';

/** Shared UI infrastructure from SPEC §4: X1 (Escape stack, dialog helpers) and X2 (toasts). */

function key(k: string, extra: Partial<KeyboardEvent> = {}) {
  let prevented = false;
  return {
    key: k,
    isComposing: false,
    get defaultPrevented() {
      return prevented || !!extra.defaultPrevented;
    },
    preventDefault() {
      prevented = true;
    },
    ...Object.fromEntries(Object.entries(extra).filter(([k2]) => k2 !== 'defaultPrevented')),
  } as unknown as KeyboardEvent;
}

describe('X1 escape stack', () => {
  afterEach(() => resetEscapeStackForTests());

  it('Escape closes only the innermost layer, in order of opening (ACG4.1)', () => {
    const closed: string[] = [];
    const disposers: Record<string, () => void> = {};
    const open = (id: string) => {
      disposers[id] = pushEscape(() => {
        closed.push(id);
        disposers[id]();
      }, { id });
    };
    open('console');
    open('palette');
    open('gate');
    expect(topEscapeId()).toBe('gate');
    expect(dispatchEscape(key('Escape'))).toBe(true);
    expect(closed).toEqual(['gate']);
    dispatchEscape(key('Escape'));
    dispatchEscape(key('Escape'));
    expect(closed).toEqual(['gate', 'palette', 'console']);
    expect(escapeDepth()).toBe(0);
    expect(dispatchEscape(key('Escape'))).toBe(false);
  });

  it('marks the event handled and ignores other keys', () => {
    const h = vi.fn();
    pushEscape(h, { id: 'a' });
    expect(dispatchEscape(key('Enter'))).toBe(false);
    const e = key('Escape');
    dispatchEscape(e);
    expect(h).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves Escape to an element that already handled it (an input clearing its answer)', () => {
    const h = vi.fn();
    pushEscape(h, { id: 'dialog' });
    expect(dispatchEscape(key('Escape', { defaultPrevented: true }))).toBe(false);
    expect(dispatchEscape(key('Escape', { isComposing: true }))).toBe(false);
    expect(h).not.toHaveBeenCalled();
  });

  it('re-registering an id replaces its handler in place, not on top', () => {
    const first = vi.fn();
    const second = vi.fn();
    pushEscape(first, { id: 'sheet' });
    pushEscape(vi.fn(), { id: 'popover' });
    pushEscape(second, { id: 'sheet' });
    expect(escapeDepth()).toBe(2);
    expect(isTopEscape('popover')).toBe(true);
  });

  it('a disposer removes only its own entry and is idempotent', () => {
    const offA = pushEscape(vi.fn(), { id: 'a' });
    pushEscape(vi.fn(), { id: 'b' });
    offA();
    offA();
    expect(escapeDepth()).toBe(1);
    expect(topEscapeId()).toBe('b');
  });

  it('a stale disposer does not remove a newer registration under the same id', () => {
    const off = pushEscape(vi.fn(), { id: 'x' });
    const newer = vi.fn();
    pushEscape(newer, { id: 'x' });
    off();
    expect(escapeDepth()).toBe(1);
    dispatchEscape(key('Escape'));
    expect(newer).toHaveBeenCalledTimes(1);
  });
});

describe('X1 dialog helpers', () => {
  it('Tab wraps at both ends and pulls focus in from outside', () => {
    expect(trapTabIndex(3, 2, false)).toBe(0);
    expect(trapTabIndex(3, 0, true)).toBe(2);
    expect(trapTabIndex(3, 1, false)).toBeNull();
    expect(trapTabIndex(3, 1, true)).toBeNull();
    expect(trapTabIndex(3, -1, false)).toBe(0);
    expect(trapTabIndex(3, -1, true)).toBe(2);
    expect(trapTabIndex(0, -1, false)).toBeNull();
  });

  it('default initial focus looks for the close or Cancel button', () => {
    expect(isCloseLabel('Close')).toBe(true);
    expect(isCloseLabel('Cancel')).toBe(true);
    expect(isCloseLabel('close dossier')).toBe(true);
    expect(isCloseLabel('Delete')).toBe(false);
    expect(isCloseLabel(null)).toBe(false);
  });

  it('focusable selector skips disabled controls and tabindex -1', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it('scroll lock is ref-counted across stacked dialogs', () => {
    const body = { style: { overflow: 'auto' } };
    vi.stubGlobal('document', { body });
    try {
      const a = lockBodyScroll();
      const b = lockBodyScroll();
      expect(body.style.overflow).toBe('hidden');
      a();
      a();
      expect(body.style.overflow).toBe('hidden');
      b();
      expect(body.style.overflow).toBe('auto');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('X2 toasts', () => {
  const item = (id: number, tone: 'info' | 'ok' | 'err' = 'info') => toToastItem({ text: `t${id}`, tone }, id);

  it('keeps at most three, dropping the oldest', () => {
    let list = [item(1), item(2), item(3)];
    list = pushToast(list, item(4));
    expect(TOAST_MAX).toBe(3);
    expect(list.map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it('defaults: info tone, 4 s', () => {
    const t = toToastItem({ text: 'Saved' }, 7);
    expect(t).toMatchObject({ id: 7, text: 'Saved', tone: 'info', ms: TOAST_DEFAULT_MS });
    expect(TOAST_DEFAULT_MS).toBe(4000);
  });

  it('err is an alert, others are status; the action and dismiss are real buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ToastStack, {
        items: [
          toToastItem({ text: 'Removed', tone: 'ok', action: { label: 'Undo', onClick: () => {} } }, 1),
          toToastItem({ text: 'Failed', tone: 'err' }, 2),
        ],
        onDismiss: () => {},
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button type="button" class="ui-toast-action">Undo<\/button>/);
    expect(html).toContain('aria-label="Dismiss notification"');
    expect(html).not.toContain('data-anchor');
  });

  it('an anchored stack is marked for container positioning', () => {
    const html = renderToStaticMarkup(createElement(ToastStack, { items: [item(1)], anchor: true, onDismiss: () => {} }));
    expect(html).toContain('data-anchor=""');
  });

  it('the provider renders its children and no empty stack', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement('p', null, 'page')));
    expect(html).toBe('<p>page</p>');
  });

  it('is mounted once in the root layout', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout.match(/<ToastProvider>/g)?.length).toBe(1);
  });

  it('styles use tokens only, with a reduced-motion rule (ACG5.2)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const start = css.indexOf('/* ── Shared toasts (SPEC X2');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('@keyframes ui-toast-in', start));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(block).toContain('var(--o-toast-bg)');
    expect(css.slice(start)).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ui-toast \{ animation: none; \}/);
    expect(css).toMatch(/\.ae-octane \{[^}]*--o-toast-bg:/);
  });
});
