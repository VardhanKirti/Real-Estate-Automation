'use client';
/**
 * Studio (`/lab/studio`), GladOS tree (01 11): Generate with 07's state line, the idea list by group
 * (Window open, Early, No window; Used and Dismissed start collapsed), scripts, "Your audience keeps asking",
 * and the selected idea beside the list. At 768px and wider `?idea=` is a selection (D5): the server fills
 * `selected`; under 768px the same link opens the Idea sheet (useSheetRoute decides). `n` opens New idea.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ActionPill } from '@/components/lab/v2/shared';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { StudioPageView } from '@/lib/lab/view/studio';
import { LAB_UI } from '@/lib/lab/view/ui-copy';
import { PageBar, Panel, SectionNote, useRoving } from './bits';
import { GPageShell } from './PageShell';
import { IdeaActions, IdeaBody } from './studio/IdeaDetail';
import { GenerateButton, NewIdeaForm, Seeds } from './studio/StudioParts';

const S = LAB_COPY.studio;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

function IdeaList({ view }: { view: StudioPageView }) {
  const [closed, setClosed] = useState<Record<string, boolean>>(() => Object.fromEntries(view.groups.map((g) => [g.id, g.collapsed])));
  const ro = view.frame.readOnly;
  const roving = useRoving<HTMLDivElement>('.lab2g-ideaitem');
  return (
    <Panel id="lab2g-ideas" title={LAB_UI.ideasTitle} desc={view.diversity.text} className="lab2g-studio-list" priority={2}>
      <div ref={roving.ref} onKeyDown={roving.onKeyDown} className="lab2g-ideagroups">
      {view.groups.filter((g) => g.items.length > 0).map((g) => {
        const open = !closed[g.id];
        return (
          <section key={g.id} className="lab2g-group" aria-labelledby={`lab2g-g-${g.id}`}>
            <button data-g="LabButton"
              type="button"
              id={`lab2g-g-${g.id}`}
              className="lab2g-group-title"
              aria-expanded={open}
              onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}
              data-lab-ink=""
            >
              <span>{g.label}</span>
              <span className="lab2g-group-n">{g.items.length}</span>
            </button>
            {open && (
              <ul className="lab2g-rows lab2g-rows-flat">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <Link data-g="LabLink"
                      href={i.href}
                      replace
                      scroll={false}
                      className="lab2g-row lab2g-ideaitem"
                      aria-current={i.selected ? 'true' : undefined}
                      data-lab-shared={`idea-${i.id}`}
                      data-sheet-title={i.title}
                    >
                      <span className="lab2g-row-main">
                        <span className="lab2g-row-title" data-lab-ink="">{i.title}</span>
                        <span className="lab2g-row-sub" data-lab-ink="">{[i.windowText, i.groundedText].filter(Boolean).join(' · ')}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      </div>

      <section className="lab2g-group" aria-labelledby="lab2g-g-scripts">
        <h3 id="lab2g-g-scripts" className="lab2g-group-title lab2g-group-static" data-lab-ink="">
          <span>{S.scripts}</span>
          <span className="lab2g-group-n">{view.scripts.rows.length}</span>
        </h3>
        {view.scripts.rows.length === 0 ? (
          <SectionNote state={view.scripts.state.message ? view.scripts.state : { ...view.scripts.state, message: S.noScripts }} />
        ) : (
          <ul className="lab2g-rows lab2g-rows-flat">
            {view.scripts.rows.map((r) => (
              <li key={r.id}>
                <Link data-g="LabLink" href={r.href} scroll={false} className="lab2g-row lab2g-ideaitem" data-lab-shared={`script-${r.id}`} data-sheet-title={r.title}>
                  <span className="lab2g-row-main">
                    <span className="lab2g-row-title" data-lab-ink="">{r.title}</span>
                    <span className="lab2g-row-sub" data-lab-ink="">{[`v${r.version}`, r.gateText, r.predictionText].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Seeds seeds={view.seeds} readOnly={ro} />
    </Panel>
  );
}

function Body({ view }: { view: StudioPageView }) {
  const router = useRouter();
  const path = usePathname();
  const detail = useRef<HTMLHeadingElement>(null);
  const sample = view.frame.mode.sample;
  const newHref = `${path}?new=1${sample ? '&sample=1' : ''}`;

  // `n` opens New idea when focus is not in a text field (01 22.1).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[data-lab="Sheet"][aria-modal="true"]')) return;
      router.push(newHref, { scroll: false });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [router, newHref]);

  // Selecting an idea moves focus to the detail heading (01 11.3).
  const selectedId = view.selected?.data.id ?? null;
  const shown = useRef(selectedId);
  useEffect(() => {
    if (shown.current === selectedId) return;
    shown.current = selectedId;
    detail.current?.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <div className="lab2g-stack">
      <PageBar
        tools={
          <>
            <GenerateButton gen={view.generate} readOnly={view.frame.readOnly} />
            <ActionPill label={S.newIdea} href={newHref} disabled={!!view.frame.readOnly} disabledReason={view.frame.readOnly ?? undefined} sharedId="studio-new" />
          </>
        }
      />
      {view.emptyCard && (
        <Panel priority={2}>
          <SectionNote state={view.emptyCard.message ? view.emptyCard : { ...view.emptyCard, message: S.emptyIdeas }} />
        </Panel>
      )}
      <div className="lab2g-studio">
        <IdeaList view={view} />
        <Panel id="lab2g-detail" className="lab2g-studio-detail" priority={2}>
          {view.newIdea ? (
            <>
              <h2 ref={detail} tabIndex={-1} className="lab2g-detail-title" data-lab-ink="">{S.newIdea}</h2>
              <NewIdeaForm form={view.newIdea} readOnly={view.frame.readOnly} />
            </>
          ) : view.selected ? (
            <>
              <h2 ref={detail} tabIndex={-1} className="lab2g-detail-title" data-lab-ink="">{view.selected.data.title}</h2>
              <IdeaBody ui={view.selected} />
              <div className="lab2g-detail-actions">
                <IdeaActions ui={view.selected} />
              </div>
            </>
          ) : (
            <p className="lab2g-muted" data-lab-ink="">{LAB_UI.pickIdea}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function StudioPage({ view }: { view: StudioPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <Body view={view} />
    </GPageShell>
  );
}
