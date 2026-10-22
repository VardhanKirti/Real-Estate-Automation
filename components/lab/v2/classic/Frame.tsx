'use client';
/**
 * The Classic frame (01 4): back link, the six page tabs with the underlined active title, search, the menu
 * button, the quick actions and the create menu, the dry chip, the mode banner, the not-configured card,
 * and the sheet host. Every page renders inside it. The `/lab` layout's LabRoot (lane U1) renders the one
 * `.lab[data-lab-root]` root, the Aurora, the intro script and the glass budget for both trees (01 1, 03.19).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { ActionPill, Glass, PlusButton, RoundButton, SearchPill, type PlusMenuItem } from '@/components/lab/v2/shared';
import { prefersReducedMotion } from '@/components/lab/v2/shared/motion/useReducedMotion';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { OutsideScoreDialog } from './dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { RunControl } from './progress/RunControl';
import { SheetHost } from './sheets/SheetHost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

export type FrameProps = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  children?: ReactNode;
  /** Draft scripts for Log an outside score (Ledger and Studio pass theirs; empty elsewhere). */
  outsideScripts?: { id: string; label: string }[];
};

function withSample(href: string, sample: boolean): string {
  if (!sample || href.startsWith('?') || href.includes('sample=1')) return href;
  return href + (href.includes('?') ? '&' : '?') + 'sample=1';
}

/** 03.11: the underline flies from the old tab to the clicked one (WAAPI, 280 ms), starting on click. */
function flyUnderline(nav: HTMLElement, from: HTMLElement, to: HTMLElement) {
  if (prefersReducedMotion() || typeof nav.animate !== 'function') return;
  const n = nav.getBoundingClientRect(), a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const ink = document.createElement('span');
  ink.className = 'lab2c-tab-ink';
  ink.setAttribute('aria-hidden', 'true');
  Object.assign(ink.style, { left: `${a.left - n.left + nav.scrollLeft}px`, width: `${a.width}px` });
  nav.appendChild(ink);
  const anim = ink.animate(
    [{ transform: 'translateX(0) scaleX(1)' }, { transform: `translateX(${b.left - a.left}px) scaleX(${b.width / Math.max(1, a.width)})` }],
    { duration: LAB_DUR.m + 20, easing: LAB_EASE.out, fill: 'forwards' },
  );
  anim.finished.catch(() => {}).finally(() => window.setTimeout(() => ink.remove(), 400));
}

/** Pages mounted in this document: the route rise plays from the second on (client navigation), never on a hard load. */
let pagesMounted = 0;

export function Frame({ frame, sheet, children, outsideScripts }: FrameProps) {
  const page = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  // 03.11: the page's .lab2-page rises 6px over 240 ms on client navigation between the six pages.
  useLayoutEffect(() => {
    const el = page.current;
    pagesMounted += 1;
    if (!el || pagesMounted === 1 || prefersReducedMotion()) return;
    el.setAttribute('data-lab-enter', '');
    const done = () => el.removeAttribute('data-lab-enter');
    el.addEventListener('animationend', done, { once: true });
    const t = window.setTimeout(done, 600);
    return () => window.clearTimeout(t);
  }, []);
  const onTab = (e: MouseEvent<HTMLAnchorElement>) => {
    const cur = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav.current && cur && cur !== e.currentTarget) flyUnderline(nav.current, cur, e.currentTarget);
  };
  const scripts = outsideScripts ?? frame.outsideScripts ?? [];
  const router = useRouter();
  const { post } = useLabPost();
  const [outside, setOutside] = useState(false);
  const sample = frame.mode.sample;
  const onToday = frame.page === 'today';
  const runNow = frame.quickActions.find((a) => a.id === 'run_now');

  const menuItems: PlusMenuItem[] = frame.createMenu.map((m) => ({
    id: m.id,
    label: m.label,
    href: m.href ? withSample(m.href, sample) : undefined,
    disabled: !!m.disabledReason,
    disabledReason: m.disabledReason ?? undefined,
    onSelect:
      m.id === 'log_outside_score'
        ? () => setOutside(true)
        : m.id === 'run_intel'
          ? () => void post('/api/lab/intel', {}, { key: 'intel' })
          : undefined,
  }));

  // The sheet layer and the dialog sit beside the page, not inside it: the page's rise animation sets a
  // transform, which would make their position: fixed resolve against the page (a full-height sheet below
  // the header for 240 ms on a deep link, then a jump). Same structure as the GladOS PageShell.
  return (
    <>
    <div ref={page} className="lab2-page lab2c-page" data-lab-page={frame.page} data-lab-tree="classic">
      <a href="#lab-main" className="lab2c-skip">{C.skip}</a>
      <header className="lab2-head lab2c-head">
        {onToday ? (
          <span className="lab2-back" data-lab-ink="">{frame.title}</span>
        ) : (
          <Link href={withSample('/lab', sample)} className="lab2-back" data-lab-ink="">{frame.title}</Link>
        )}
        <nav ref={nav} className="lab2-tabs" aria-label={C.pagesNav}>
          {frame.pages.map((p) =>
            p.active ? (
              <Link key={p.id} href={p.href} className="lab2-tab" aria-current="page" data-lab-ink="">
                <h1 className="lab2c-h1">{p.label}</h1>
              </Link>
            ) : (
              <Link key={p.id} href={p.href} className="lab2-tab" onClick={onTab}>
                <span data-lab-ink="">{p.label}</span>
                {p.badge !== null && p.badge > 0 && <span className="lab2c-badge" data-lab-ink="">{p.badge}</span>}
              </Link>
            ),
          )}
        </nav>
        <div className="lab2-head-tools">
          {sample && <span className="lab2-chip lab2-hide-phone" data-sample-badge="" title={frame.mode.fixtureName ?? undefined} data-lab-ink="">{C.sampleBadge}</span>}
          <SearchPill placeholder={frame.search.placeholder} onSubmit={(q) => { const u = new URL(window.location.href); u.searchParams.set('ask', q); openSheetHref(u.pathname + u.search); }} />
          <RoundButton label={C.setup} icon="menu" href={frame.menuHref} sharedId="setup-menu" />
        </div>
      </header>

      <div className="lab2-actions lab2c-actions">
        {frame.quickActions.filter((a) => a.id !== 'run_now').map((a) => (
          <span key={a.id} className="lab2-hide-phone">
            <ActionPill label={a.label} href={a.href ? withSample(a.href, sample) : undefined} disabled={!!a.disabledReason} disabledReason={a.disabledReason ?? undefined} sharedId={`qa-${a.id}`} />
          </span>
        ))}
        {runNow && <RunControl run={frame.run} label={runNow.label} readOnly={frame.readOnly} dryLabel={frame.mode.dryLabel} />}
        <PlusButton label={C.create} items={menuItems} />
        <span className="lab2c-sync lab2-hide-phone" data-lab-ink="">{frame.lastSyncText}</span>
      </div>

      {frame.banner && (
        <div className="lab2c-banner" data-tone={frame.banner.tone} role="status">
          <span data-lab-ink="">{frame.banner.text}</span>
          {frame.banner.action && <Link href={frame.banner.action.href} className="lab2-pill lab2-seeall" data-lab-ink="" scroll={false}>{frame.banner.action.label}</Link>}
        </div>
      )}

      <main id="lab-main" className="lab2c-main" tabIndex={-1}>
        {frame.emptyCard ? (
          <Glass tone="strong" radius="narrative" priority={2} className="lab2-empty lab2c-emptycard" data-lab-empty="">
            <h2 className="lab2-empty-title" data-lab-ink="">{frame.emptyCard.title}</h2>
            <p className="lab2-empty-text" data-lab-ink="">{frame.emptyCard.body}</p>
            <span className="lab2-empty-actions">
              <SetupLink href={frame.emptyCard.setupHref} label={C.setUp} className="lab2-setup" />
              {frame.emptyCard.sampleHref && (
                <Link href={frame.emptyCard.sampleHref} className="lab2-textlink" data-lab-ink="" onClick={() => router.refresh()}>
                  {C.previewSample}
                </Link>
              )}
            </span>
          </Glass>
        ) : (
          children
        )}
      </main>
    </div>
    <SheetHost initial={sheet} frame={frame} />
    <OutsideScoreDialog open={outside} onClose={() => setOutside(false)} scripts={scripts} readOnly={frame.readOnly} />
    </>
  );
}
