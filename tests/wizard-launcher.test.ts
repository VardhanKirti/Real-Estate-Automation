import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { NAV_ITEMS, WizardIcon } from '@/lib/nav';
import { launcherCopy, launcherState, unreadBadge } from '@/lib/conductor-launcher';
import { THEMES } from '@/lib/theme';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('S08 one Wizard glyph', () => {
  test('lib/nav.ts exports WizardIcon and the /wizard item uses it', () => {
    const item = NAV_ITEMS.find((n) => n.href === '/wizard');
    expect(item?.icon).toBe(WizardIcon);
  });

  test('the launcher, the dock header and the Topbar read WizardIcon from @/lib/nav', () => {
    const panel = read('components/ConductorPanel.tsx');
    expect(panel).toMatch(/import \{ WizardIcon \} from '@\/lib\/nav'/);
    expect(panel).not.toContain('SparkIcon');
    expect(panel).toContain('glyph="wand"');
    const topbar = read('components/Topbar.tsx');
    expect(topbar).toMatch(/import \{ WizardIcon \} from '@\/lib\/nav'/);
    expect(topbar).not.toMatch(/\bBot\b/);
    for (const f of ['components/ConductorPanel.tsx', 'components/Topbar.tsx']) expect(read(f)).not.toMatch(/\bWand2\b/);
  });

  test('the launcher has no native title tooltip; its label shows on hover and keyboard focus', () => {
    const panel = read('components/ConductorPanel.tsx');
    const launcher = panel.slice(panel.indexOf('className={`wiz-launch'), panel.indexOf('</button>', panel.indexOf('className={`wiz-launch')));
    expect(launcher).not.toMatch(/\btitle=/);
    expect(launcher).toContain('group-focus-visible:max-w-[180px]');
    expect(launcher).toContain('group-hover:max-w-[180px]');
  });

  test('ConductorPanel has no raw hex and no warning glyph', () => {
    const panel = read('components/ConductorPanel.tsx');
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(panel).not.toContain('⚠');
  });

  test('the Topbar wand toggles the dock and reports aria-expanded', () => {
    const topbar = read('components/Topbar.tsx');
    expect(topbar).toContain('CONDUCTOR_TOGGLE_EVENT');
    expect(topbar).toContain('aria-expanded={dockOpen}');
    expect(topbar).toContain('CONDUCTOR_STATE_EVENT');
  });

  test('dock Escape goes through the one Escape stack (X1), only while open', () => {
    const panel = read('components/ConductorPanel.tsx');
    expect(panel).toContain("pushEscape(() => closeDock(), { id: 'conductor-dock' })");
    expect(panel).not.toMatch(/addEventListener\('keydown'/);
  });
});

describe('S08 launcher state', () => {
  test('precedence: open wins, then error > thinking > unread > idle', () => {
    const base = { open: false, sending: false, unread: 0, error: null };
    expect(launcherState(base)).toBe('idle');
    expect(launcherState({ ...base, unread: 2 })).toBe('unread');
    expect(launcherState({ ...base, unread: 2, sending: true })).toBe('thinking');
    expect(launcherState({ ...base, unread: 2, sending: true, error: 'boom' })).toBe('error');
    expect(launcherState({ open: true, sending: true, unread: 3, error: 'boom' })).toBe('open');
  });

  test('copy and badge', () => {
    expect(launcherCopy('idle', 0)).toEqual({ aria: 'Open the Wizard', pop: 'Ask Wizard' });
    expect(launcherCopy('unread', 1).aria).toBe('Open the Wizard, 1 new reply');
    expect(launcherCopy('unread', 3)).toEqual({ aria: 'Open the Wizard, 3 new replies', pop: '3 new' });
    expect(launcherCopy('unread', 12).pop).toBe('9+ new');
    expect(launcherCopy('thinking', 0).aria).toBe('Open the Wizard (working on your last message)');
    expect(launcherCopy('error', 0).pop).toBe('Failed, open to retry');
    expect(unreadBadge(0)).toBe('');
    expect(unreadBadge(1)).toBe('');
    expect(unreadBadge(4)).toBe('4');
    expect(unreadBadge(10)).toBe('9+');
  });
});

describe('S08 launcher CSS', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('/* ── S08 Wizard launcher'), css.indexOf('/* ── end S08 Wizard launcher ── */'));

  test('one --launcher-clear token, owned by this block (SPEC C13)', () => {
    expect(block).toMatch(/--launcher-clear:\s*56px/);
    expect(css.match(/--launcher-clear:/g)?.length).toBe(1);
  });

  test('--route-ink is defined for every theme', () => {
    for (const t of THEMES) {
      if (t === 'console') continue;
      expect(block, t).toMatch(new RegExp(`:root\\[data-theme='${t}'\\][^{]*\\{[^}]*--route-ink`));
    }
    expect(block).toMatch(/:root,\s*:root\[data-theme='console'\]\s*\{\s*--route-ink/);
  });

  test('reduced motion stops the orbiting arc; White idles at 85%', () => {
    const reduced = block.slice(block.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.wiz-launch\.is-thinking::before \{\s*animation: none/);
    expect(block).toMatch(/:root\[data-theme='light'\] \.wiz-launch \{\s*opacity: 0\.85/);
  });
});
