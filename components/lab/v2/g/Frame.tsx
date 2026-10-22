'use client';
/**
 * The shared frame of every Lab page, GladOS tree (01 section 4): back link, page tabs, search pill,
 * Setup menu button, quick actions with Run now, the Create menu, the dry chip, the sample badge and
 * the one-line mode banner. Everything it prints comes from `LabFrameView` or LAB_COPY.
 */
import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { useToast } from '@/components/g';
import { ActionPill, Glass, PlusButton, RoundButton, SearchPill, type PlusMenuItem } from '@/components/lab/v2/shared';
import { prefersReducedMotion } from '@/components/lab/v2/shared/motion/useReducedMotion';
import { useResumeRun } from '@/components/lab/v2/shared/useLabRun';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { LabFrameView } from '@/lib/lab/view/frame';
import { OutsideScoreDialog, type OutsideScoreScript } from './Dialogs';
import { RunNowPill } from './RunNow';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

/** Underline flight between tabs on click (03.11): WAAPI from the old tab's rect to the new, 280 ms. */
function flyUnderline(nav: HTMLElement, from: HTMLElement, to: HTMLElement) {
  if (prefersReducedMotion() || typeof nav.animate !== 'function') return;
  const n = nav.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const ink = document.createElement('span');
  ink.className = 'lab2g-tab-ink';
  ink.setAttribute('aria-hidden', 'true');
  Object.assign(ink.style, { left: `${a.left - n.left + nav.scrollLeft}px`, width: `${a.width}px` });
  nav.appendChild(ink);
  const anim = ink.animate(
    [{ transform: 'translateX(0) scaleX(1)' }, { transform: `translateX(${b.left - a.left}px) scaleX(${b.width / Math.max(1, a.width)})` }],
    { duration: LAB_DUR.m + 20, easing: LAB_EASE.out, fill: 'forwards' },
  );
  anim.finished.catch(() => {}).finally(() => window.setTimeout(() => ink.remove(), 400));
}

/** Pages open the frame's Log an outside score dialog with this event (the Ledger header button). */
export const OPEN_OUTSIDE_SCORE = 'lab:outside-score';

export function GFrame({ frame, outsideScripts }: { frame: LabFrameView; outsideScripts?: OutsideScoreScript[] }) {
  const scripts = outsideScripts ?? frame.outsideScripts ?? [];
  const nav = useRef<HTMLElement>(null);
  const [outside, setOutside] = useState(false);
  const { post } = useLabPost();
  const { toast } = useToast();
  useResumeRun(frame.run.activeBatch);

  useEffect(() => {
    const open = () => setOutside(true);
    window.addEventListener(OPEN_OUTSIDE_SCORE, open);
    return () => window.removeEventListener(OPEN_OUTSIDE_SCORE, open);
  }, []);

  // Cmd K / Ctrl K focuses the Ask pill, even inside a text field (01 22.1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const input = document.querySelector<HTMLInputElement>('.lab2-search input');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onTab = (e: MouseEvent<HTMLAnchorElement>) => {
    const cur = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav.current && cur && cur !== e.currentTarget) flyUnderline(nav.current, cur, e.currentTarget);
  };

  const ask = (q: string) => {
    const t = q.trim().slice(0, 300);
    if (!t) return;
    const u = new URL(window.location.href);
    u.searchParams.set('ask', t);
    openSheetHref(`?${u.searchParams.toString()}`, { title: LAB_UI.kindAsk });
  };

  const menu: PlusMenuItem[] = frame.createMenu.map((m) => {
    const disabled = !!m.disabledReason;
    if (m.id === 'log_outside_score') return { id: m.id, label: m.label, onSelect: () => setOutside(true), disabled, disabledReason: m.disabledReason ?? undefined };
    if (m.id === 'run_intel') {
      return {
        id: m.id,
        label: m.label,
        disabled,
        disabledReason: m.disabledReason ?? undefined,
        onSelect: async () => {
          const r = await post('/api/lab/intel', {}, { key: 'intel' });
          if (r.ok) toast({ text: r.status === 207 ? fill(LAB_UI.intelPartial, { failed: String(r.data.failed ?? 1) }) : LAB_UI.intelDone, tone: r.status === 207 ? 'info' : 'ok' });
        },
      };
    }
    return { id: m.id, label: m.label, href: m.href ?? undefined, disabled, disabledReason: m.disabledReason ?? undefined };
  });

  const isToday = frame.page === 'today';
  const sample = frame.mode.sample;
  const keep = sample ? '?sample=1' : '';

  return (
    <>
      <a data-g="LabLink" href="#lab-main" className="lab2g-skip">{LAB_UI.skip}</a>
      <header className="lab2-head lab2g-head">
        <span className="lab2g-backline">
          {isToday ? (
            <span className="lab2-back" data-lab-ink="">{frame.title}</span>
          ) : (
            <Link data-g="LabLink" href={`/lab${keep}`} className="lab2-back" data-lab-ink="">{frame.title}</Link>
          )}
          <span className="lab2g-sync" data-lab-ink="">{frame.lastSyncText}</span>
        </span>
        <nav ref={nav} className="lab2-tabs lab2g-tabs" aria-label={LAB_UI.pagesNav}>
          {frame.pages.map((t) =>
            t.active ? (
              <Link data-g="LabLink" key={t.id} href={t.href} className="lab2-tab" aria-current="page" data-lab-ink="">
                <h1 className="lab2g-h1">{t.label}</h1>
                {t.badge ? <span className="lab2g-badge">{t.badge}</span> : null}
              </Link>
            ) : (
              <Link data-g="LabLink" key={t.id} href={t.href} className="lab2-tab" data-lab-ink="" onClick={onTab}>
                {t.label}
                {t.badge ? <span className="lab2g-badge">{t.badge}</span> : null}
              </Link>
            ),
          )}
        </nav>
        <div className="lab2-head-tools">
          {sample && <span className="lab2-chip lab2-hide-phone" data-sample-badge={frame.mode.fixtureName ?? ''}><span data-lab-ink="">{LAB_UI.sampleBadge}</span></span>}
          <SearchPill placeholder={frame.search.placeholder} onSubmit={ask} />
          <RoundButton label={LAB_UI.kindSetup} icon="menu" href={frame.menuHref} sharedId="setup-menu" />
        </div>
      </header>

      <div className="lab2-actions lab2g-actions">
        {frame.quickActions.map((a) =>
          a.id === 'run_now' ? (
            <RunNowPill key={a.id} frame={frame} />
          ) : (
            <span key={a.id} className="lab2-hide-phone">
              <ActionPill label={a.label} href={a.href ?? undefined} disabled={!!a.disabledReason} disabledReason={a.disabledReason ?? undefined} sharedId={`qa-${a.id}`} />
            </span>
          ),
        )}
        <PlusButton label={LAB_COPY.aria.create} items={menu} />
        {frame.mode.dryLabel && <span className="lab2-chip lab2g-dry"><span data-lab-ink="">{frame.mode.dryLabel}</span></span>}
      </div>

      {frame.banner && (
        <Glass tone="strong" radius="chip" priority={3} className="lab2g-banner" data-tone={frame.banner.tone} role="status">
          <span className="lab2g-banner-text" data-lab-ink="">{frame.banner.text}</span>
          {frame.banner.action && (
            <Link data-g="LabLink" href={frame.banner.action.href} className="lab2-pill lab2-seeall" data-lab-ink="" data-lab-shared="banner-action">{frame.banner.action.label}</Link>
          )}
        </Glass>
      )}

      <OutsideScoreDialog open={outside} onClose={() => setOutside(false)} scripts={scripts} readOnly={frame.readOnly} />
    </>
  );
}

/**
 * The not-configured card (01 4.5, D12): when the frame says nothing can run yet, every page shows this in
 * place of its body. Set up goes through the house SetupLink to ?setup=keys; the sample preview link stays.
 */
export function GEmptyCard({ frame }: { frame: LabFrameView }) {
  if (!frame.emptyCard) return null;
  return (
    <Glass tone="strong" radius="narrative" priority={2} className="lab2-empty lab2g-emptycard" data-lab-empty="">
      <h2 className="lab2-empty-title" data-lab-ink="">{frame.emptyCard.title}</h2>
      <p className="lab2-empty-text" data-lab-ink="">{frame.emptyCard.body}</p>
      <span className="lab2-empty-actions">
        <span className="lab2g-setupwrap" data-g-exempt="SetupLink: the house set-up affordance every unconfigured surface must show">
          <SetupLink href={frame.emptyCard.setupHref} label={LAB_UI.setUp} className="lab2-setup" />
        </span>
        {frame.emptyCard.sampleHref && <a data-g="LabLink" href={frame.emptyCard.sampleHref} className="lab2-textlink" data-lab-ink="" data-lab-no-sheet="">{LAB_UI.sampleLink}</a>}
      </span>
    </Glass>
  );
}
