'use client';
/**
 * Playbook (`/lab/playbook`), GladOS tree (01 10): the format switcher, the beat shape (breakouts against
 * yours), what lifts breakouts (only rows section 04 shows, each with its interval bar, n and section 06's
 * mark), your DNA, and the script rules with whether your data agrees. A `#lift-...` hash scrolls the row
 * into view and outlines it for 2 s (the Brief card's link).
 */
import { useEffect, useState } from 'react';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { LiftRowView, PlaybookPageView } from '@/lib/lab/view/playbook';
import { Chip, FilterChip, PageBar, Panel, SectionNote, useRoving } from './bits';
import { GPageShell } from './PageShell';
import { StrandBar } from './Strand';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

/** Four decimals, so server and client SVG attributes match exactly (hydration). */
const r2 = (v: number) => Math.round(v * 10000) / 10000;

function LiftBar({ lo, hi, est, max }: { lo: number; hi: number; est: number; max: number }) {
  const top = Math.max(4, max);
  const x = (v: number) => r2((Math.log(Math.max(0.5, Math.min(top, v))) - Math.log(0.5)) / (Math.log(top) - Math.log(0.5)));
  return (
    <svg className="lab2g-liftbar" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" data-lab-mark="">
      <line x1="0" x2="100" y1="6" y2="6" className="lab2g-interval-track" vectorEffect="non-scaling-stroke" />
      <line x1={x(1) * 100} x2={x(1) * 100} y1="1" y2="11" className="lab2g-interval-one" vectorEffect="non-scaling-stroke" />
      <line x1={x(lo) * 100} x2={x(hi) * 100} y1="6" y2="6" className="lab2g-interval-range" vectorEffect="non-scaling-stroke" />
      <circle cx={x(est) * 100} cy="6" r="2.4" className="lab2g-interval-dot" />
    </svg>
  );
}

function LiftRow({ r, max, flash }: { r: LiftRowView; max: number; flash: boolean }) {
  const [open, setOpen] = useState(false);
  const struck = r.mark === 'contradicted';
  return (
    <li id={r.id} className="lab2g-lift" data-flash={flash ? '' : undefined} data-mark={r.mark}>
      <button data-g="LabButton" type="button" className="lab2g-lift-main" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="lab2g-lift-name">
          <span className="lab2g-lift-feature" data-lab-ink="">{r.featureLabel}</span>
          <span className="lab2g-lift-value" data-lab-ink="">{r.valueLabel}</span>
        </span>
        <span className="lab2g-lift-num" data-struck={struck ? '' : undefined} data-lab-ink="">{r.text}</span>
        <LiftBar lo={r.lo} hi={r.hi} est={r.estimate} max={max} />
        <span className="lab2g-lift-n" data-lab-ink="">{r.nText}</span>
      </button>
      {r.testHref && r.mark !== 'correlation' ? (
        <a data-g="LabLink" href={r.testHref} className="lab2-chip lab2g-chiplink" data-mark={r.mark}><span data-lab-ink="">{r.markLabel}</span></a>
      ) : (
        <Chip>{r.markLabel}</Chip>
      )}
      {open && (
        <div className="lab2g-lift-more">
          <p className="lab2-card-text" data-lab-ink="">{r.sentence}</p>
          <p className="lab2g-muted" data-lab-ink="">{`90% ${r.rangeText}`}</p>
          {r.testHref && <a data-g="LabLink" href={r.testHref} className="lab2-textlink" data-lab-ink="">{LAB_UI.openTest}</a>}
        </div>
      )}
    </li>
  );
}

export function PlaybookBody({ view }: { view: PlaybookPageView }) {
  const [flash, setFlash] = useState<string | null>(null);
  const formats = useRoving<HTMLElement>('.lab2g-fchip');
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id.startsWith('lift-')) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'center' });
    setFlash(id);
    const t = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(t);
  }, []);
  if (view.formats.length === 0) {
    return (
      <Panel title={LAB_UI.playbookTitle}>
        <p className="lab2g-text" data-lab-ink="">{LAB_UI.playbookEmpty}</p>
        <SectionNote state={view.shape.state} />
      </Panel>
    );
  }
  const max = Math.max(4, ...view.lifts.rows.map((r) => r.hi));
  return (
    <div className="lab2g-stack">
      <PageBar
        tools={
          <nav ref={formats.ref} onKeyDown={formats.onKeyDown} className="lab2g-fgroup lab2g-formats" aria-label={LAB_UI.format}>
            {view.formats.map((f) => (
              <FilterChip key={f.id} href={f.href} active={f.active} count={f.breakoutsN}>{f.label}</FilterChip>
            ))}
          </nav>
        }
      />
      <Panel id="lab2g-shape" title={LAB_UI.beatShape} desc={view.shape.statsText ?? undefined} priority={2}>
        <div className="lab2g-shape">
          <span className="lab2g-shape-k" data-lab-ink="">{LAB_UI.breakoutsShape}</span>
          <StrandBar strand={view.shape.breakout} />
          <span className="lab2g-shape-k" data-lab-ink="">{LAB_UI.yoursShape}</span>
          {view.shape.yours ? <StrandBar strand={view.shape.yours} /> : <span className="lab2g-muted" data-lab-ink="">{LAB_UI.noYours}</span>}
        </div>
      </Panel>
      <div className="lab2g-split lab2g-split-wide">
        <Panel id="lab2g-lifts" title={LAB_UI.whatLifts} desc={view.lifts.method} priority={2}>
          {view.lifts.rows.length === 0 ? (
            <>
              <SectionNote state={view.lifts.state} />
              {view.lifts.hiddenText && <p className="lab2g-muted" data-lab-ink="">{view.lifts.hiddenText}</p>}
            </>
          ) : (
            <>
              <ul className="lab2g-lifts">
                {view.lifts.rows.map((r) => <LiftRow key={r.id} r={r} max={max} flash={flash === r.id} />)}
              </ul>
              {view.lifts.hiddenText && <p className="lab2g-muted" data-lab-ink="">{view.lifts.hiddenText}</p>}
            </>
          )}
        </Panel>
        <Panel id="lab2g-dna" title={LAB_UI.yourDna}>
          {view.dna.sentences.length === 0 && !view.dna.view ? (
            <SectionNote state={view.dna.state} />
          ) : (
            <ul className="lab2g-bullets lab2g-dna">
              {view.dna.sentences.map((s) => <li key={s} className="lab2-card-text" data-lab-ink="">{s}</li>)}
              {view.dna.view?.gaps.slice(0, 4).map((g) => (
                <li key={`${g.family}-${g.feature}`} className="lab2g-muted" data-lab-ink="">{`${g.familyLabel}: ${g.label}, ${g.nicheLiftText} in the niche, ${g.yourShareText} of yours`}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel id="lab2g-rules" title={LAB_UI.scriptRules}>
        {view.rules.state.kind === 'not_built' ? (
          <SectionNote state={{ ...view.rules.state, message: view.rules.state.message ?? LAB_COPY.layer.gen }} />
        ) : (
          <ul className="lab2g-rows lab2g-rows-flat">
            {view.rules.rows.map((r) => (
              <li key={r.id}>
                <details className="lab2g-ruledetail">
                  <summary data-g="LabDisclosure" className="lab2g-row">
                    <span className="lab2g-row-main" data-lab-ink="">{r.label}</span>
                    <span className="lab2g-row-meta" data-agrees={r.agrees} data-lab-ink="">{r.agreesText}</span>
                  </summary>
                  <p className="lab2g-muted lab2g-ruledetail-src" data-lab-ink="">{r.source}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function PlaybookPage({ view }: { view: PlaybookPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <PlaybookBody view={view} />
    </GPageShell>
  );
}
