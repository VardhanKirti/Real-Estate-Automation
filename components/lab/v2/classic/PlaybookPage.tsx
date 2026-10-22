'use client';
/**
 * Playbook (`/lab/playbook`), Classic tree (01 10): the format switcher, beat shape (breakouts against
 * yours), what lifts breakouts with 90% intervals and the test mark, Your DNA, and the script rules.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { LiftRowView, PlaybookPageView } from '@/lib/lab/view/playbook';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { FilterChip, IntervalBar, Panel, StateLine, Tag, shows } from './parts';
import { Strand } from './viz';

function LiftRow({ r, open, onToggle, highlight }: { r: LiftRowView; open: boolean; onToggle: () => void; highlight: boolean }) {
  const struck = r.mark === 'contradicted';
  return (
    <li id={r.id} className="lab2c-lift" data-open={open ? '' : undefined} data-highlight={highlight ? '' : undefined} data-mark={r.mark}>
      <button type="button" className="lab2c-lift-row" aria-expanded={open} aria-controls={`${r.id}-detail`} onClick={onToggle}>
        <span className="lab2c-lift-name">
          <span className="lab2c-lift-feature" data-lab-ink="">{r.featureLabel}</span>
          <span className="lab2c-lift-value" data-lab-ink="">{r.valueLabel}</span>
        </span>
        <span className="lab2c-lift-est" data-struck={struck ? '' : undefined} data-lab-ink="">{r.text}</span>
        <span className="lab2c-lift-bar">
          <IntervalBar lo={r.lo} hi={r.hi} point={r.estimate} scaleMax={10} struck={struck} />
          <span className="lab2c-lift-range" data-lab-ink="">{r.rangeText}</span>
        </span>
        <span className="lab2c-lift-n" data-lab-ink="">{r.nText}</span>
      </button>
      <span className="lab2c-lift-mark">
        {r.testHref ? (
          <Link href={r.testHref} scroll={false} className="lab2c-tag-link" data-lab-shared={`mark-${r.id}`}>
            <Tag tone={r.mark === 'confirmed' ? 'strong' : 'quiet'}>{r.markLabel}</Tag>
          </Link>
        ) : (
          <Tag tone="quiet">{r.markLabel}</Tag>
        )}
      </span>
      {open && (
        <div id={`${r.id}-detail`} className="lab2c-lift-detail">
          {r.sentence && <p className="lab2c-lift-sentence" data-lab-ink="">{r.sentence}</p>}
          {r.testHref && <Link href={r.testHref} scroll={false} className="lab2-textlink" data-lab-ink="">{C.playbook.openTest}</Link>}
        </div>
      )}
    </li>
  );
}

export function PlaybookPage({ view }: { view: PlaybookPageView }) {
  return (
    <ClassicCapHost>
      <PlaybookPageBody view={view} />
    </ClassicCapHost>
  );
}

function PlaybookPageBody({ view }: { view: PlaybookPageView }) {
  const [open, setOpen] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  // 01 10.4: a #lift-... hash (the Brief card link) scrolls the row into view and outlines it for 2s.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (!h.startsWith('lift-')) return;
    setHash(h);
    setOpen(h);
    document.getElementById(h)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setHash(null), 2000);
    return () => clearTimeout(t);
  }, []);

  const strong = view.gates?.find((g) => g.gate === 'profile_strong' && g.state === 'predicted' && g.days);
  if (!view.formats.length) {
    return (
      <Frame frame={view.frame} sheet={view.sheet}>
        <Panel className="lab2c-gap-top" priority={2}>
          <StateLine state={view.lifts.state} />
          {strong?.days && <p className="lab2c-note" data-lab-ink="">{fill(C.playbook.gatesLine, { weeks: fmtCount(Math.round(strong.days.med / 7)), n: fmtCount(view.frame.run.tracked) })}</p>}
        </Panel>
      </Frame>
    );
  }

  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      <div className="lab2c-bar lab2c-formats" role="toolbar" aria-label={C.playbook.formats}>
        {view.formats.map((f) => (
          <FilterChip key={f.id} href={f.href} active={f.active}>
            {f.label}<span className="lab2c-fchip-n">{f.breakoutsN}</span>
          </FilterChip>
        ))}
      </div>

      <Panel id="shape" title={C.playbook.shape} desc={C.playbook.shapeDesc} priority={2} className="lab2c-gap-top" tools={view.shape.statsText ? <span className="lab2c-muted" data-lab-ink="">{view.shape.statsText}</span> : undefined}>
        <StateLine state={view.shape.state} />
        {shows(view.shape.state) && (
          <div className="lab2c-shape">
            {view.shape.breakout && (
              <div className="lab2c-shape-row">
                <span className="lab2c-shape-label" data-lab-ink="">{C.playbook.breakoutsRow}</span>
                <Strand strand={view.shape.breakout} label={C.playbook.breakoutsRow} tall />
              </div>
            )}
            {view.shape.yours ? (
              <div className="lab2c-shape-row">
                <span className="lab2c-shape-label" data-lab-ink="">{`${C.playbook.yoursRow} · n ${view.shape.yoursN}`}</span>
                <Strand strand={view.shape.yours} label={C.playbook.yoursRow} tall />
              </div>
            ) : null}
            {view.shape.breakout && (
              <ul className="lab2c-beatkey">
                {view.shape.breakout.beats.map((b, i) => (
                  <li key={i}><span className="lab2c-beat lab2c-beat-dot" data-beat={b.type} /><span data-lab-ink="">{b.label}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <div className="lab2c-split lab2c-split-wide">
        <Panel id="lifts" title={C.playbook.lifts} desc={view.lifts.method}>
          <StateLine state={view.lifts.state} />
          {shows(view.lifts.state) && view.lifts.rows.length > 0 && (
            <>
              <div className="lab2c-lift lab2c-lift-top" aria-hidden="true">
                <div className="lab2c-lift-head">
                  <span>{C.playbook.cols.feature}</span>
                  <span>{C.playbook.cols.lift}</span>
                  <span>{C.playbook.cols.interval}</span>
                  <span>{C.playbook.cols.n}</span>
                </div>
                <span className="lab2c-lift-head lab2c-lift-headmark">{C.playbook.cols.mark}</span>
              </div>
              <ul className="lab2c-lifts">
                {view.lifts.rows.map((r) => (
                  <LiftRow key={r.id} r={r} open={open === r.id} highlight={hash === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} />
                ))}
              </ul>
            </>
          )}
          {view.lifts.hiddenText && view.lifts.rows.length > 0 && <p className="lab2c-muted" data-lab-ink="">{view.lifts.hiddenText}</p>}
        </Panel>
        <Panel id="dna" title={C.playbook.dna}>
          <StateLine state={view.dna.state} />
          {shows(view.dna.state) && (
            <>
              <ul className="lab2c-sentences">
                {view.dna.sentences.map((s, i) => <li key={i} data-lab-ink="">{s}</li>)}
              </ul>
              {view.dna.view?.contrast && <p className="lab2c-dna-contrast" data-lab-ink="">{view.dna.view.contrast}</p>}
              {view.dna.view && view.dna.view.gaps.length > 0 && (
                <div className="lab2c-block">
                  <h3 className="lab2c-block-title" data-lab-ink="">{C.playbook.gaps}</h3>
                  <ul className="lab2c-gaps">
                    {view.dna.view.gaps.slice(0, 4).map((g, i) => (
                      <li key={i}>
                        <span data-lab-ink="">{g.label}</span>
                        <span className="lab2c-muted" data-lab-ink="">{`${g.nicheLiftText} · ${g.yourShareText} · n ${g.n}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel id="rules" title={C.playbook.rules} desc={C.playbook.rulesDesc} className="lab2c-gap-top">
        <StateLine state={view.rules.state} />
        {shows(view.rules.state) && (
          <ul className="lab2c-rules">
            {view.rules.rows.map((r) => (
              <li key={r.id} className="lab2c-rule" data-agrees={r.agrees}>
                <div className="lab2c-rule-row">
                  <span className="lab2c-rule-label" data-lab-ink="">{r.label}</span>
                  <span className="lab2c-rule-src" data-lab-ink="">{r.source}</span>
                  <span className="lab2c-rule-agree">
                    <Tag tone={r.agrees === 'yes' ? 'strong' : 'quiet'}>{r.agreesText}</Tag>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Frame>
  );
}
