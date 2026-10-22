'use client';
/**
 * The Content Lab frame under Bennett Legacy (founderos-ui pages/lab.md section 1): the slab title
 * (`// CONTENT LAB · <PAGE>`, H1 "Content Lab", the sync line, the last-run chip and the seven page pills),
 * the tool row (Ask the Lab, the quick actions, Run now behind the spend gate, Create, Setup), the mode
 * banner, the not-configured card, and the sheet host. Same LabFrameView as the other trees; the page
 * slab itself is the layout's LegacySlab (app/layout.tsx).
 */
import './lab-legacy.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Chip, LSampleChip, SlabTitle } from '@/components/legacy';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { LEGACY_LAB as L } from './copy';
import { OutsideScoreDialog } from './dialogs';
import { Btn, LabSetupLink, cx, withSample } from './parts';
import { RunControl } from './RunControl';
import { SheetHost } from './sheets/SheetHost';

export type FrameProps = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  children?: ReactNode;
  /** Draft scripts for Log an outside score (Studio passes its own; the frame's elsewhere). */
  outsideScripts?: { id: string; label: string }[];
  /** The page's own controls under the title (filters, primary actions). */
  bar?: ReactNode;
};

type MenuItem = LabFrameView['createMenu'][number];

/** Create: a mono menu under its button. Outside click and Escape close it; a disabled row says why. */
function CreateMenu({ items, sample, onSelect }: { items: MenuItem[]; sample: boolean; onSelect: (m: MenuItem) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span ref={wrap} className="l-lab-menu-wrap">
      <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn l-lab-create" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus size={12} strokeWidth={1.8} aria-hidden />
        {C.create}
      </button>
      {open && (
        <ul data-l="LabMenu" className="l-lab-menu" role="menu" aria-label={C.create}>
          {items.map((m) => (
            <li key={m.id} role="none">
              {m.disabledReason ? (
                <span role="menuitem" aria-disabled="true" className="l-lab-menu-item" title={m.disabledReason}>
                  <span>{m.label}</span>
                  <span className="l-lab-menu-why">{m.disabledReason}</span>
                </span>
              ) : m.href ? (
                <Link role="menuitem" href={withSample(m.href, sample)} scroll={false} className="l-lab-menu-item" onClick={() => setOpen(false)}>
                  {m.label}
                </Link>
              ) : (
                <button type="button" role="menuitem" className="l-lab-menu-item" onClick={() => { setOpen(false); onSelect(m); }}>
                  {m.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** Ask the Lab: a mono field; Enter opens the Ask sheet with the question (?ask=). */
function AskField({ placeholder }: { placeholder: string }) {
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim().slice(0, 300);
    if (!t) return;
    const u = new URL(window.location.href);
    u.searchParams.set('ask', t);
    openSheetHref(u.pathname + u.search);
  };
  return (
    <form data-l="LabAsk" className="l-lab-askfield" role="search" onSubmit={submit}>
      <Search size={13} strokeWidth={1.7} aria-hidden />
      <input value={q} maxLength={300} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setQ(e.target.value)} />
      <span aria-hidden className="l-lab-caret">▌</span>
    </form>
  );
}

/** Pages mounted in this document: the page rise plays from the second on (client navigation), never on a hard load. */
let pagesMounted = 0;

export function Frame({ frame, sheet, children, outsideScripts, bar }: FrameProps) {
  const router = useRouter();
  const { post } = useLabPost();
  const [outside, setOutside] = useState(false);
  const [entering, setEntering] = useState(false);
  const sample = frame.mode.sample;
  const runNow = frame.quickActions.find((a) => a.id === 'run_now');
  const current = frame.pages.find((p) => p.active);
  const scripts = outsideScripts ?? frame.outsideScripts ?? [];
  useEffect(() => {
    pagesMounted += 1;
    if (pagesMounted > 1) setEntering(true);
  }, []);

  const meta = [frame.agent.name !== frame.title ? frame.agent.name : null, frame.mode.fixtureName, frame.mode.dryLabel].filter(Boolean).join(' · ') || null;
  const lastRun = frame.lastSyncText;

  return (
    <>
      <div data-l="LabPage" className={cx('l-lab-page', entering && 'is-entering')} data-lab-page={frame.page} data-lab-tree="legacy">
        <a href="#lab-main" className="l-lab-skip">{C.skip}</a>
        <SlabTitle
          eyebrow={fill(L.eyebrow, { page: current?.label ?? '' })}
          title={frame.title}
          meta={meta}
          right={
            <>
              <Chip tone={frame.run.active ? 'warn' : frame.mode.state === 'not_configured' ? 'err' : 'ok'}>{lastRun}</Chip>
              {sample && <LSampleChip label={C.sampleBadge} />}
            </>
          }
        />
        <nav data-l="LabPages" className="l-lab-pages" aria-label={L.pages}>
          {frame.pages.map((p) => (
            <Link
              key={p.id}
              href={p.href}
              data-l="ToggleChip"
              data-lens="c"
              data-on={p.active ? 'true' : 'false'}
              aria-current={p.active ? 'page' : undefined}
              className={cx('l-pressable l-lab-pagepill', !p.active && 'is-dark')}
            >
              {p.label}
              {!p.active && p.badge !== null && p.badge > 0 && <span className="l-lab-chip-n">{p.badge}</span>}
            </Link>
          ))}
        </nav>

        <div data-l="LabTools" className="l-lab-tools" role="toolbar" aria-label={L.quick}>
          <AskField placeholder={frame.search.placeholder} />
          <span className="l-lab-tools-actions">
            {frame.quickActions.filter((a) => a.id !== 'run_now').map((a) => (
              <span key={a.id} className="l-lab-hide-phone">
                <Btn href={a.href ? withSample(a.href, sample) : undefined} disabled={!!a.disabledReason} title={a.disabledReason ?? undefined} data-lab-shared={`qa-${a.id}`}>{a.label}</Btn>
              </span>
            ))}
            <CreateMenu
              items={frame.createMenu}
              sample={sample}
              onSelect={(m) => {
                if (m.id === 'log_outside_score') setOutside(true);
                else if (m.id === 'run_intel') void post('/api/lab/intel', {}, { key: 'intel' });
              }}
            />
            <Link href={frame.menuHref} scroll={false} data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-sm" aria-label={C.setup} title={C.setup} data-lab-shared="setup-menu">
              <SlidersHorizontal size={14} strokeWidth={1.7} aria-hidden />
            </Link>
            {runNow && <RunControl run={frame.run} label={runNow.label} readOnly={frame.readOnly} dryLabel={frame.mode.dryLabel} />}
          </span>
        </div>

        {frame.banner && (
          <div data-l="LabBanner" className="l-lab-banner" data-tone={frame.banner.tone} role="status">
            <span>{frame.banner.text}</span>
            {frame.banner.action && <Btn href={frame.banner.action.href}>{frame.banner.action.label}</Btn>}
          </div>
        )}

        {bar && !frame.emptyCard && <div data-l="LabBar" className="l-lab-bar">{bar}</div>}

        <main id="lab-main" className="l-lab-main" tabIndex={-1}>
          {frame.emptyCard ? (
            <section data-l="SlabCard" data-lab-empty="" className="l-rise l-card l-lab-emptycard" style={{ ['--l-rise-i' as string]: 1 }}>
              <div className="l-chip-row">
                <Chip tone="err">{C.setupSheet.keyState.not_configured}</Chip>
              </div>
              <h2 className="l-lab-emptycard-title">{frame.emptyCard.title}</h2>
              <p className="l-body-text">{frame.emptyCard.body}</p>
              <span className="l-lab-actrow">
                <LabSetupLink href={frame.emptyCard.setupHref} />
                {frame.emptyCard.sampleHref && (
                  <Link href={frame.emptyCard.sampleHref} className="l-link" onClick={() => router.refresh()}>
                    {C.previewSample}
                  </Link>
                )}
              </span>
            </section>
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
