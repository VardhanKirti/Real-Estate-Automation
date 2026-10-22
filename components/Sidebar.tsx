'use client';

/**
 * The app sidebar (SPEC S09 on the S12 nav model). One DOM for every width:
 * the same <aside> is the labelled sidebar (184 to 320px) and the 64px icon
 * rail, switched by `html[data-sidebar]` in CSS ("S09 resizable sidebar"
 * block in app/globals.css). The width is `--sidebar-w` on <html>, painted
 * before first paint by SIDEBAR_INIT_SCRIPT (lib/sidebar.ts) and owned here
 * after hydration.
 *
 * The user sets it on every page: drag the right edge (snaps to the rail
 * under 124px), double-click the edge, the edge chevron, Cmd/Ctrl+\, or
 * "Toggle sidebar" in the palette. One width is stored for every page
 * (localStorage `glados-sidebar`, per browser; FounderOS UI SPEC 4.2): no page
 * collapses or expands it, workspace routes only change the layout. What is shown can be
 * narrower than what is stored: small windows, and the Wizard dock leaving
 * under 560px of content (effectiveWidth), never rewrite the preference.
 *
 * Under the GladOS style (S00 §5.5, GSidebar) the same DOM and behaviour get
 * the kit's look: grey ground, no border, pill rows, a GButton edge toggle.
 * `ui` comes from the root layout and then follows html[data-ui] live.
 */
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { activeHref, navTooltip } from '@/lib/nav';
import { visibleGroups } from '@/lib/modules';
import { useDigestUnread } from '@/components/comms-fo/useDigestUnread';
import {
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_DEFAULT_W,
  SIDEBAR_MAX_W,
  SIDEBAR_RAIL_VIEWPORT,
  SIDEBAR_RAIL_W,
  SIDEBAR_STORAGE_KEY,
  applySidebarState,
  commitWidth,
  effectiveWidth,
  isWorkspaceRoute,
  keyWidth,
  parseSidebarPrefs,
  readSidebarPrefs,
  sidebarMode,
  snapWidth,
  storedWidth,
  toggleWidth,
  writeSidebarPrefs,
  type SidebarPrefs,
  viewportWidth,
} from '@/lib/sidebar';
import { pushEscape } from '@/lib/escape-stack';
import { CONDUCTOR_STATE_EVENT, type ConductorStateDetail } from '@/lib/conductor-launcher';
import { NavTooltip, type NavTip } from '@/components/NavTooltip';
import { GButton } from '@/components/g';
import type { UiStyle } from '@/lib/appearance';
import { useUiStyle } from '@/lib/use-ui-style';
import { LegacySideFoot, LegacySideHead } from '@/components/legacy/Shell';

/** The product name and mark for this deployment (lib/brand.ts, read on the server). */
export type BrandMark = { name: string; mark: string };

/** Window events: in, run the toggle (palette); out, a committed width change. */
export const SIDEBAR_TOGGLE_EVENT = 'sidebar:toggle';
export const SIDEBAR_RESIZE_EVENT = 'sidebar:resize';

const TRANSITION_MS = 220; // width / margin / left glide (app/globals.css)
const TIP_DELAY_MS = 250;
const DRAG_SLOP = 3; // px of travel before a press on the handle counts as a drag

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The width the init script (or the last apply) painted. */
function paintedWidth(fallback: number): number {
  try {
    const v = parseFloat(document.documentElement.style.getPropertyValue('--sidebar-w'));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function Sidebar({ brand, ui = 'classic', off = [] }: { brand: BrandMark; ui?: UiStyle; /** modules switched off in Settings (lib/modules.ts) */ off?: string[] }) {
  const g = useUiStyle(ui) === 'glados';
  // Bennett Legacy: FounderOS's lockup and footer strip; the same DOM and behaviour otherwise
  const legacy = useUiStyle(ui) === 'legacy';
  const pathname = usePathname() ?? '/';
  const workspace = isWorkspaceRoute(pathname);
  const active = activeHref(pathname);
  // F3: an unread morning digest puts a dot on Comms until it is opened.
  const digestUnread = useDigestUnread();

  const prefsRef = useRef<SidebarPrefs>({ ...DEFAULT_SIDEBAR_PREFS });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // the same default on every route: the init script painted the stored width
  // before hydration and the first effect reads it back (paintedWidth)
  const shownRef = useRef<number>(SIDEBAR_DEFAULT_W);
  // read by the tooltip callback, which is memoised once
  const offRef = useRef(off);
  offRef.current = off;
  const conductorRef = useRef<ConductorStateDetail>({ open: false, width: 0 });
  // The user widened the sidebar on purpose while the Wizard dock was taking
  // the room: honour it until the dock opens or closes again.
  const overrideRef = useRef(false);
  const [shown, setShown] = useState<number>(SIDEBAR_DEFAULT_W);
  const [tooNarrow, setTooNarrow] = useState(false);
  const notifyTimer = useRef<number | undefined>(undefined);
  const labelsTimer = useRef<number | undefined>(undefined);
  /** The labels fade in only when the sidebar opens from the rail, never on a page load (34 running animations per load otherwise). */
  const labelsIn = useCallback((from: string | null, to: string) => {
    if (from !== 'rail' || to !== 'full') return;
    const root = document.documentElement;
    root.classList.add('sidebar-labels-in');
    window.clearTimeout(labelsTimer.current);
    labelsTimer.current = window.setTimeout(() => root.classList.remove('sidebar-labels-in'), 400);
  }, []);

  /** Tell width-dependent canvases after the glide ends (FR-17); never per drag frame. */
  const notify = useCallback((width: number) => {
    window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(
      () => {
        window.dispatchEvent(new CustomEvent(SIDEBAR_RESIZE_EVENT, { detail: { width } }));
        // canvases that only listen to window resize (Blueprint, workflow editor) refit
        window.dispatchEvent(new Event('resize'));
      },
      prefersReducedMotion() ? 0 : TRANSITION_MS + 20,
    );
  }, []);

  /** Show the effective width for this route and window; returns it. */
  const apply = useCallback(
    (force = false): number => {
      const vw = viewportWidth();
      const c = conductorRef.current;
      const width = effectiveWidth(
        storedWidth(prefsRef.current),
        vw,
        overrideRef.current ? 0 : c.open ? c.width : 0,
      );
      const changed = width !== shownRef.current;
      labelsIn(document.documentElement.getAttribute('data-sidebar'), sidebarMode(width));
      applySidebarState(document.documentElement, { width, mode: sidebarMode(width), workspace: workspaceRef.current });
      shownRef.current = width;
      setShown(width);
      setTooNarrow(vw < SIDEBAR_RAIL_VIEWPORT);
      if (changed || force) notify(width);
      return width;
    },
    [notify],
  );

  const persist = useCallback((next: SidebarPrefs) => {
    prefsRef.current = next;
    // blocked storage (private window): the in-memory value carries the session
    writeSidebarPrefs(next);
  }, []);

  /** After an explicit change: a labelled width chosen while the dock squeezes the content wins. */
  const settle = useCallback(
    (prefs: SidebarPrefs) => {
      persist(prefs);
      const want = storedWidth(prefs);
      overrideRef.current = sidebarMode(want) === 'full' && conductorRef.current.open;
      apply();
    },
    [apply, persist],
  );

  const toggle = useCallback(() => {
    if (viewportWidth() < SIDEBAR_RAIL_VIEWPORT) return; // no room for a labelled sidebar
    settle(toggleWidth(prefsRef.current, shownRef.current));
  }, [settle]);

  // First mount reads the preference; a route change re-applies it only to
  // move data-canvas (layout). The width is the same on every page, so it
  // does not change on navigation.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prefsRef.current = readSidebarPrefs();
      shownRef.current = paintedWidth(shownRef.current);
    }
    apply();
  }, [pathname, apply]);

  // window size (rAF-throttled), the Wizard dock, other tabs, the palette, Cmd/Ctrl+\
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => apply());
    };
    const onConductor = (e: Event) => {
      const d = (e as CustomEvent<ConductorStateDetail>).detail;
      if (!d) return;
      if (d.open !== conductorRef.current.open) overrideRef.current = false;
      conductorRef.current = { open: d.open, width: d.open ? d.width : 0 };
      apply();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIDEBAR_STORAGE_KEY) return;
      prefsRef.current = parseSidebarPrefs(e.newValue);
      apply();
    };
    const onToggle = () => toggle();
    const onKey = (e: KeyboardEvent) => {
      // Cmd+\ (macOS) / Ctrl+\: no text meaning, so it works while typing too
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener(CONDUCTOR_STATE_EVENT, onConductor);
    window.addEventListener('storage', onStorage);
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener(CONDUCTOR_STATE_EVENT, onConductor);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [apply, toggle]);

  useEffect(() => () => window.clearTimeout(notifyTimer.current), []);

  // ── drag (FR-4): the variable moves 1:1, no React state per frame ──
  const dragRef = useRef<{ id: number; startX: number; startW: number; w: number; moved: boolean; dispose: () => void } | null>(null);

  const endDrag = useCallback(
    (commit: boolean, target?: Element) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      d.dispose();
      const root = document.documentElement;
      root.classList.remove('sidebar-dragging');
      try {
        if (target && 'releasePointerCapture' in target) (target as HTMLElement).releasePointerCapture(d.id);
      } catch {
        /* already released */
      }
      if (!d.moved) return;
      if (commit) settle(commitWidth(prefsRef.current, snapWidth(d.w)));
      else apply(); // Escape: back to the start width
    },
    [apply, settle],
  );

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tooNarrow) return;
    e.preventDefault();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer: move events still track */
    }
    const dispose = pushEscape(() => endDrag(false, target), { id: 'sidebar-drag' });
    dragRef.current = { id: e.pointerId, startX: e.clientX, startW: shownRef.current, w: shownRef.current, moved: false, dispose };
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      d.moved = true;
      document.documentElement.classList.add('sidebar-dragging');
      setTip(null);
    }
    const w = Math.round(Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_RAIL_W, d.startW + dx)));
    d.w = w;
    const root = document.documentElement;
    root.style.setProperty('--sidebar-w', `${w}px`);
    labelsIn(root.getAttribute('data-sidebar'), sidebarMode(w));
    root.setAttribute('data-sidebar', sidebarMode(w)); // labels hide/show live at 120px
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
      return;
    }
    const next = keyWidth(shownRef.current, e.key, e.shiftKey);
    if (next === null || tooNarrow) return;
    e.preventDefault();
    settle(commitWidth(prefsRef.current, next));
  };

  // ── tooltips (FR-14): rail always, labelled sidebar only for a truncated label ──
  const [tip, setTip] = useState<NavTip | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const hideTip = useCallback(() => {
    window.clearTimeout(tipTimer.current);
    setTip(null);
  }, []);
  const showTip = useCallback((el: HTMLElement, href: string) => {
    if (dragRef.current?.moved) return;
    const rail = document.documentElement.getAttribute('data-sidebar') === 'rail' || sidebarMode(shownRef.current) === 'rail';
    const label = el.querySelector<HTMLElement>('.os-nav-label');
    const truncated = !!label && label.scrollWidth > label.clientWidth + 1;
    if (!rail && !truncated) return;
    const t = navTooltip(href, rail ? 'rail' : 'full', offRef.current);
    if (!t) return;
    const r = el.getBoundingClientRect();
    setTip({ ...t, top: Math.round(r.top + r.height / 2) });
  }, []);
  useEffect(() => hideTip(), [pathname, hideTip]);
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(null); // hides only; never consumes the key
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tip]);
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  // ── scroll fades (FR-16): a soft edge where the nav can scroll further ──
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const updateFades = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const up = nav.scrollTop > 1;
    const down = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1;
    nav.toggleAttribute('data-fade-top', up);
    nav.toggleAttribute('data-fade-bottom', down);
  }, []);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    updateFades();
    const onScroll = () => {
      updateFades();
      hideTip();
    };
    nav.addEventListener('scroll', onScroll, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateFades());
      ro.observe(nav);
      if (listRef.current) ro.observe(listRef.current);
    }
    return () => {
      nav.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [updateFades, hideTip]);
  useEffect(() => {
    updateFades();
  }, [shown, updateFades]);

  const rail = sidebarMode(shown) === 'rail';
  const toggleLabel = rail ? 'Expand sidebar' : 'Collapse sidebar';
  const toggleTitle = tooNarrow ? 'The window is too narrow for a labelled sidebar' : `${toggleLabel} (⌘\\)`;

  return (
    <>
      <aside
        id="os-sidebar"
        aria-label="Primary"
        // layout only (no topbar before the init script runs); never the width
        data-canvas={workspace ? '1' : undefined}
        data-g={g ? 'GSidebar' : undefined}
        // z 26: above the workflow editor canvas (.wfc, z 25) so the edge
        // handle and chevron stay reachable there; below every overlay (z 45+)
        className={
          g
            ? 'os-sidebar g-side fixed inset-y-0 left-0 z-[26] flex w-[var(--sidebar-w)] flex-col'
            : 'os-sidebar fixed inset-y-0 left-0 z-[26] flex w-[var(--sidebar-w)] flex-col border-r border-os-border bg-os-bg2'
        }
      >
        {legacy ? (
          <div className="os-side-head l-side-head">
            <LegacySideHead />
          </div>
        ) : (
          <div className="os-side-head">
            {/* the deployment's mark; its glow is CSS (.os-mark) so the asset stays clean */}
            <Link href="/" className="os-mark-link" title={brand.name}>
              <Image src={brand.mark} alt={brand.name} width={56} height={42} priority className="os-mark" />
            </Link>
          </div>
        )}
        <nav ref={navRef} className="os-nav" aria-label="Views">
          <div ref={listRef} className="os-nav-list">
            {visibleGroups(off).map((group) => (
              <div key={group.id} role="group" aria-label={group.label} className="os-nav-group">
                {group.title && (
                  <>
                    <span aria-hidden className="os-nav-divider" />
                    <div aria-hidden className="os-nav-group-title truncate">
                      {group.title}
                    </div>
                  </>
                )}
                {group.items.map(({ href, label, icon: Icon, accent }) => {
                  const on = href === active;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={on ? 'page' : undefined}
                      onPointerEnter={(e) => {
                        if (e.pointerType === 'touch') return;
                        const el = e.currentTarget;
                        window.clearTimeout(tipTimer.current);
                        tipTimer.current = window.setTimeout(() => showTip(el, href), prefersReducedMotion() ? 0 : TIP_DELAY_MS);
                      }}
                      onPointerLeave={hideTip}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        let visible = true;
                        try {
                          visible = el.matches(':focus-visible');
                        } catch {
                          /* older engines: show on any focus */
                        }
                        if (visible) showTip(el, href);
                      }}
                      onBlur={hideTip}
                      data-g={g ? 'GSidebarItem' : undefined}
                      className={
                        g
                          ? // GladOS: 40px pill rows; active is a raised fill, never an accent tint (C30: no AdPilot override)
                            'os-nav-link g-side-item group flex items-center gap-3'
                          : `os-nav-link group flex items-center gap-3 rounded-md-t px-2.5 py-[7px] text-[13.5px] transition-colors ${
                              on ? 'bg-[var(--accent-soft)] text-os-text' : 'text-os-muted hover:bg-os-surface hover:text-os-text'
                            }${accent === 'adpilot' ? ' os-nav-adpilot' : ''}`
                      }
                      // AdPilot and Creative Engine: the active pill reads the theme's
                      // --adpilot-* tokens (.os-nav-adpilot[aria-current='page'],
                      // SPEC G1 and §5 C32).
                    >
                      <Icon aria-hidden className="os-nav-icon h-4 w-4 shrink-0" strokeWidth={1.5} />
                      <span className="os-nav-label min-w-0 truncate">{label}</span>
                      {href === '/inbox' && digestUnread && <span className="os-nav-unread" data-unread-dot role="img" aria-label="Unread morning digest" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
        {legacy && <LegacySideFoot />}

        {/* edge toggle (FR-7): rail ↔ last labelled width, same recipe as the Wizard dock's edge arrows */}
        {g ? (
          <GButton
            variant="icon"
            size="sm"
            onClick={toggle}
            disabled={tooNarrow}
            disabledReason={toggleTitle}
            aria-label={toggleLabel}
            aria-controls="os-sidebar"
            aria-expanded={!rail}
            title={toggleTitle}
            className="os-side-toggle g-side-toggle"
          >
            <ChevronLeft aria-hidden className="os-side-chev-collapse" size={14} strokeWidth={1.75} />
            <ChevronRight aria-hidden className="os-side-chev-expand" size={14} strokeWidth={1.75} />
          </GButton>
        ) : (
          <button
            type="button"
            onClick={toggle}
            disabled={tooNarrow}
            aria-label={toggleLabel}
            aria-controls="os-sidebar"
            aria-expanded={!rail}
            title={toggleTitle}
            className="os-side-toggle grid place-items-center rounded-full border border-os-border-strong bg-os-surface text-os-dim transition-colors hover:text-os-text disabled:opacity-40"
          >
            <ChevronLeft aria-hidden className="os-side-chev-collapse h-3.5 w-3.5" strokeWidth={1.7} />
            <ChevronRight aria-hidden className="os-side-chev-expand h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
        )}

        {/* drag handle (FR-4, FR-8): the sidebar's right edge on every page */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-controls="os-sidebar"
          aria-valuemin={SIDEBAR_RAIL_W}
          aria-valuemax={SIDEBAR_MAX_W}
          aria-valuenow={shown}
          aria-valuetext={rail ? `Icon rail, ${shown} pixels` : `${shown} pixels`}
          aria-disabled={tooNarrow || undefined}
          className="os-side-handle"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={(e) => endDrag(true, e.currentTarget)}
          onPointerCancel={(e) => endDrag(false, e.currentTarget)}
          onLostPointerCapture={(e) => endDrag(true, e.currentTarget)}
          onDoubleClick={toggle}
          onKeyDown={onHandleKey}
        />
      </aside>
      <NavTooltip tip={tip} />
    </>
  );
}
