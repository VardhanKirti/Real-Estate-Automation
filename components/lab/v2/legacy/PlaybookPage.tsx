'use client';
/**
 * Playbook (`/lab/playbook`) under Bennett Legacy (founderos-ui pages/lab.md section 1): the format chips,
 * the beat shape, what lifts breakouts as mono rule rows (lift value right, the 90% interval, the test
 * mark as a chip), Your DNA, and the script rules. Reads PlaybookPageView only.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { LiftRowView, PlaybookPageView } from '@/lib/lab/view/playbook';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Card, FilterChip, IntervalBar, LState, Tag, cx, shows } from './parts';
import { Strand } from './viz';

function LiftRow({ r, open, onToggle, highlight }: { r: LiftRowView; open: boolean; onToggle: () => void; highlight: boolean }) {
  const struck = r.mark === 'contradicted';
  return (
    <li id={r.id} data-l="LabRuleRow" className={cx('l-lab-lift', highlight && 'is-highlight')} data-open={open ? '' : undefined} data-mark={r.mark}>
      <button type="button" className="l-lab-lift-row" aria-expanded={open} aria-controls={`${r.id}-detail`} onClick={onToggle}>
        <span className="l-lab-lift-name">
          <span className="l-lab-lift-feature">{r.featureLabel}</span>
          <span className="l-muted">{r.valueLabel}</span>
        </span>
        <span className="l-lab-lift-bar">
          <IntervalBar lo={r.lo} hi={r.hi} point={r.estimate} scaleMax={10} struck={struck} />
          <span className="l-muted">{r.rangeText}</span>
        </span>
        <span className="l-lab-lift-n">{r.nText}</span>
        <span className="l-lab-lift-est" data-struck={struck ? '' : undefined}>{r.text}</span>
      </button>
      <span className="l-lab-lift-mark">
        {r.testHref ? (
          <Link href={r.testHref} scroll={false} className="l-lab-taglink" data-lab-shared={`mark-${r.id}`}>
            <Tag tone={r.mark === 'confirmed' ? 'ok' : r.mark === 'contradicted' ? 'err' : 'quiet'}>{r.markLabel}</Tag>
          </Link>
        ) : (
          <Tag tone="quiet">{r.markLabel}</Tag>
        )}
      </span>
      {open && (
        <div id={`${r.id}-detail`} className="l-lab-lift-detail">
          {r.sentence && <p className="l-lab-lead">{r.sentence}</p>}
          {r.testHref && <Link href={r.testHref} scroll={false} className="l-link">{C.playbook.openTest}</Link>}
        </div>
      )}
    </li>
  );
}

export function PlaybookPage({ view }: { view: PlaybookPageView }) {
  return (
    <LegacyCapHost>
      <PlaybookBody view={view} />
    </LegacyCapHost>
  );
}

function PlaybookBody({ view }: { view: PlaybookPageView }) {
  const [open, setOpen] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  // 01 10.4: a #lift-... hash (the Brief link) scrolls the row into view and outlines it for 2s.
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
        <Card i={1}>
          <LState state={view.lifts.state} />
          {strong?.days && <p className="l-lab-note">{fill(C.playbook.gatesLine, { weeks: fmtCount(Math.round(strong.days.med / 7)), n: fmtCount(view.frame.run.tracked) })}</p>}
        </Card>
      </Frame>
    );
  }

  const bar = (
    <span className="l-chip-row" role="toolbar" aria-label={C.playbook.formats}>
      {view.formats.map((f) => <FilterChip key={f.id} href={f.href} active={f.active} count={f.breakoutsN}>{f.label}</FilterChip>)}
    </span>
  );

  return (
    <Frame frame={view.frame} sheet={view.sheet} bar={bar}>
      <div className="l-stack">
        <Card id="shape" title={C.playbook.shape} sub={C.playbook.shapeDesc} i={1} tools={view.shape.statsText ? <span className="l-muted">{view.shape.statsText}</span> : undefined}>
          <LState state={view.shape.state} />
          {shows(view.shape.state) && (
            <div className="l-lab-shape">
              {view.shape.breakout && (
                <div className="l-lab-shape-row">
                  <span className="l-micro">{C.playbook.breakoutsRow}</span>
                  <Strand strand={view.shape.breakout} label={C.playbook.breakoutsRow} tall />
                </div>
              )}
              {view.shape.yours && (
                <div className="l-lab-shape-row">
                  <span className="l-micro">{`${C.playbook.yoursRow} · n ${view.shape.yoursN}`}</span>
                  <Strand strand={view.shape.yours} label={C.playbook.yoursRow} tall />
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="l-lab-grid-wide">
          <Card id="lifts" title={C.playbook.lifts} sub={view.lifts.method} i={2} flush>
            <LState state={view.lifts.state} />
            {shows(view.lifts.state) && view.lifts.rows.length > 0 && (
              <>
                <div className="l-lab-lift-head" aria-hidden="true">
                  <span>{C.playbook.cols.feature}</span>
                  <span>{C.playbook.cols.interval}</span>
                  <span>{C.playbook.cols.n}</span>
                  <span>{C.playbook.cols.lift}</span>
                  <span>{C.playbook.cols.mark}</span>
                </div>
                <ul className="l-lab-lifts">
                  {view.lifts.rows.map((r) => <LiftRow key={r.id} r={r} open={open === r.id} highlight={hash === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} />)}
                </ul>
              </>
            )}
            {view.lifts.hiddenText && view.lifts.rows.length > 0 && <p className="l-lab-foot">{view.lifts.hiddenText}</p>}
          </Card>
          <Card id="dna" title={C.playbook.dna} i={3}>
            <LState state={view.dna.state} />
            {shows(view.dna.state) && (
              <>
                <ul className="l-lab-sentences">
                  {view.dna.sentences.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                {view.dna.view?.contrast && <p className="l-lab-quote">{view.dna.view.contrast}</p>}
                {view.dna.view && view.dna.view.gaps.length > 0 && (
                  <div className="l-lab-gaps">
                    <h3 className="l-lab-block-title">{C.playbook.gaps}</h3>
                    <ul className="l-lab-rows">
                      {view.dna.view.gaps.slice(0, 4).map((g, i) => (
                        <li key={i} className="l-lab-gap-row">
                          <span>{g.label}</span>
                          <span className="l-muted">{`${g.nicheLiftText} · ${g.yourShareText} · n ${g.n}`}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <Card id="rules" title={C.playbook.rules} sub={C.playbook.rulesDesc} i={4} flush>
          <LState state={view.rules.state} />
          {shows(view.rules.state) && (
            <ul className="l-lab-rules">
              {view.rules.rows.map((r) => (
                <li key={r.id} data-l="LabRuleRow" className="l-lab-rule" data-agrees={r.agrees}>
                  <span className="l-lab-rule-label">{r.label}</span>
                  <span className="l-muted l-lab-rule-src">{r.source}</span>
                  <Tag tone={r.agrees === 'yes' ? 'ok' : r.agrees === 'no' ? 'err' : 'quiet'}>{r.agreesText}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Frame>
  );
}
