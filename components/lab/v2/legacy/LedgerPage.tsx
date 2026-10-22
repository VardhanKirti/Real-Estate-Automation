'use client';
/**
 * Ledger (`/lab/ledger`) under Bennett Legacy (founderos-ui pages/lab.md section 1): calibration (06's
 * sentence verbatim) and reliability as hatched meters, the Lab's own forecasts, the predictor table
 * (hidden predictors greyed, with the "does not beat your normal" chip and their reason, never a number),
 * predictions, tests, experiments, planner and retention. Inconclusive stays calm (neutral tone).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MeterStack, type Meter } from '@/components/legacy';
import type { LedgerPageView } from '@/lib/lab/view/ledger';
import { fmtClock, fmtPct, underTitle } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { LEGACY_LAB as L } from './copy';
import { LegacyCapHost, OutsideScoreDialog } from './dialogs';
import { Frame } from './Frame';
import { Btn, Card, LState, LabSetupLink, Tag, cx, shows } from './parts';

const METRICS = ['pairwise', 'coverage', 'spearman', 'logMae', 'prAuc'] as const;

export function LedgerPage({ view }: { view: LedgerPageView }) {
  return (
    <LegacyCapHost>
      <LedgerBody view={view} />
    </LegacyCapHost>
  );
}

function LedgerBody({ view }: { view: LedgerPageView }) {
  const router = useRouter();
  const [outside, setOutside] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const Lg = view.ledger;
  const live = view.frame.layers.ledger === 'live' && !!Lg;
  const sample = view.frame.mode.sample;
  const predHref = (id: string | null) => {
    const q = new URLSearchParams(sample ? { sample: '1' } : {});
    if (id && id !== 'all') q.set('predictor', id);
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
  const open = (row: { postId: string | null }) => { if (row.postId) { const u = new URL(window.location.href); u.searchParams.set('post', row.postId); openSheetHref(u.pathname + u.search); } };
  const reliability: Meter[] = live
    ? Lg.hero.reliability.map((b) => ({
        label: C.ledger.bands[b.band] ?? b.band,
        frac: b.enough && b.said > 0 ? b.hit / b.said : null,
        display: b.enough && b.said > 0 ? `${fmtPct(b.hit / b.said)}${b.baseRate !== null ? ` · ${C.ledger.baseRate} ${fmtPct(b.baseRate)}` : ''}` : `${C.notEnough} · n ${b.said}`,
      }))
    : [];

  const bar = live ? (
    <>
      <label className="l-lab-selectchip">
        <span className="l-micro">{C.ledger.predictor}</span>
        <select className="l-select" value={view.predictor ?? 'all'} onChange={(e) => router.replace(predHref(e.target.value), { scroll: false })} aria-label={C.ledger.predictor}>
          {view.predictorOptions.map((o) => <option key={o.id} value={o.id}>{`${o.label} (${o.n})`}</option>)}
        </select>
      </label>
      <span className="l-lab-bar-end"><Btn onClick={() => setOutside(true)}>{C.ledger.logOutside}</Btn></span>
    </>
  ) : undefined;

  return (
    <Frame frame={view.frame} sheet={view.sheet} bar={bar}>
      <div className="l-stack">
        <div className="l-lab-grid2">
          <Card id="calibration" title={C.ledger.calibration} i={1}>
            <LState state={view.calibration.state} />
            {shows(view.calibration.state) && (
              <>
                <p className="l-lab-lead l-lab-calib">{view.calibration.sentence}</p>
                <p className="l-caption">{view.calibration.meta}</p>
              </>
            )}
            {shows(view.forecasts.state) && view.forecasts.record && (
              <div className="l-lab-forecasts">
                <h3 className="l-lab-block-title">{C.ledger.forecasts}</h3>
                <ul className="l-lab-sentences">
                  <li>{view.forecasts.record.runCost}</li>
                  <li>{view.forecasts.record.month}</li>
                  <li>{view.forecasts.record.gates}</li>
                </ul>
              </div>
            )}
          </Card>
          <Card id="reliability" title={C.ledger.reliability} sub={C.ledger.reliabilityDesc} i={2}>
            {live && reliability.length > 0 ? (
              <MeterStack meters={reliability} dense baseDelay={200} foot={`${C.ledger.hitRate} · ${C.ledger.baseRate}`} />
            ) : (
              <LState state={view.calibration.state} compact />
            )}
          </Card>
        </div>

        {live && Lg.predictors.length > 0 && (
          <Card id="preds" title={C.ledger.predictors} i={3} flush>
            <div className="l-lab-table-wrap">
              <table data-l="LabPredictorTable" className="l-lab-table l-lab-predtable">
                <thead>
                  <tr>
                    <th scope="col">{C.ledger.predictor}</th>
                    {METRICS.map((k) => <th key={k} scope="col" className="is-num">{C.ledger.metrics[k]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Lg.predictors.map((p) => {
                    const expanded = view.predictor === p.id;
                    return (
                      <tr key={p.id} data-hidden={!p.shown ? '' : undefined} data-on={expanded ? '' : undefined}>
                        <th scope="row">
                          <Link href={predHref(expanded ? null : p.id)} replace scroll={false} className="l-lab-predname" aria-current={expanded ? 'true' : undefined}>
                            <span className="l-sym">{p.label}</span>
                            {p.isBaseline && <Tag tone="quiet">{C.ledger.baseline}</Tag>}
                          </Link>
                          <span className="l-sub-line">{p.shown ? underTitle(p.record, p.label) : p.hiddenReason}</span>
                        </th>
                        {p.shown ? (
                          METRICS.map((k) => <td key={k} className="is-num">{p[k]?.display ?? ''}</td>)
                        ) : (
                          <td colSpan={METRICS.length} className="l-lab-predhidden">
                            <Tag tone="quiet">{L.predictorsHidden}</Tag>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card id="predictions" title={C.ledger.predictions} i={4} flush>
          <LState state={view.predictions.state} />
          {shows(view.predictions.state) && view.predictions.rows.length > 0 && (
            <div className="l-lab-table-wrap">
              <table className="l-lab-table l-lab-table-cards">
                <thead>
                  <tr>
                    <th scope="col">{C.ledger.cols.post}</th>
                    <th scope="col">{C.ledger.cols.predictor}</th>
                    <th scope="col">{C.ledger.cols.said}</th>
                    <th scope="col">{C.ledger.cols.happened}</th>
                    <th scope="col">{C.ledger.cols.result}</th>
                    <th scope="col" className="is-num">{C.ledger.cols.frozen}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.predictions.rows.slice(0, allRows ? 50 : 12).map((r) => (
                    <tr key={r.id} data-href={r.postId ? '' : undefined} onClick={() => open(r)}>
                      <td data-label={C.ledger.cols.post}>
                        {r.postId ? (
                          <Link href={`?post=${r.postId}`} scroll={false} className="l-lab-rowlink" data-lab-shared={`pred-${r.id}`} onClick={(e) => e.stopPropagation()}>{r.postTitle ?? r.postId}</Link>
                        ) : (
                          <span className="l-muted">{r.postTitle ?? C.ledger.pending}</span>
                        )}
                      </td>
                      <td data-label={C.ledger.cols.predictor}>{r.predictorLabel}</td>
                      <td data-label={C.ledger.cols.said}>{r.said}</td>
                      <td data-label={C.ledger.cols.happened}>{r.happened ?? ''}</td>
                      <td data-label={C.ledger.cols.result}>
                        <span className="l-chip-row">
                          {r.hit === true ? <Tag tone="ok">{C.ledger.hit}</Tag> : r.hit === false ? <Tag tone="quiet">{C.ledger.miss}</Tag> : <span className="l-muted">{C.ledger.pending}</span>}
                          {r.late && <Tag tone="quiet">{C.ledger.late}</Tag>}
                        </span>
                      </td>
                      <td className="is-num" data-label={C.ledger.cols.frozen}>{fmtClock(r.frozenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view.predictions.rows.length > 12 && (
            <div className="l-lab-more">
              <Btn aria-expanded={allRows} onClick={() => setAllRows((x) => !x)}>{allRows ? C.schedule.hide : `${C.more} (${Math.min(50, view.predictions.rows.length)})`}</Btn>
            </div>
          )}
        </Card>

        <Card id="tests" title={C.ledger.tests} i={5} tools={<Btn href="?test=new" data-lab-shared="log-test">{C.ledger.logTest}</Btn>}>
          <LState state={view.tests.state} />
          {shows(view.tests.state) && view.tests.rows.length > 0 && (
            <ul className="l-lab-rows">
              {view.tests.rows.map((t) => (
                <li key={t.row.id}>
                  <Link href={t.href} scroll={false} data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-test" data-lab-shared={`test-${t.row.id}`}>
                    <span className="l-lab-test-main">
                      <span className="l-lab-test-title">{t.row.title}</span>
                      <span className="l-muted">{t.kindLabel}</span>
                    </span>
                    <span className="l-lab-test-arms">
                      {t.row.arms.map((a, i) => <span key={i} className={cx('l-lab-test-arm', a.isWinner && 'is-win')}>{a.rate ? `${a.label} ${a.rate}` : a.label}</span>)}
                    </span>
                    <span className="l-lab-test-status">
                      <Tag tone={t.tone === 'ok' ? 'ok' : 'quiet'}>{t.statusLabel}</Tag>
                      {t.row.confirms && <span className="l-muted">{t.row.confirms}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {live && (
          <div className="l-lab-grid3">
            <Card id="experiments" title={C.ledger.experiments} i={6}>
              {Lg.experiments.length ? (
                <ul className="l-lab-rows">
                  {Lg.experiments.map((e) => (
                    <li key={e.featureKey} className="l-lab-gap-row">
                      <span>{e.label}</span>
                      <span className="l-muted">{e.n >= 5 ? `${e.above} ${C.ledger.above} · ${e.around} ${C.ledger.around} · ${e.below} ${C.ledger.below} · n ${e.n}` : `${C.notEnough} · n ${e.n}`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="l-lab-state-text">{C.notEnough}</p>
              )}
            </Card>
            <Card id="planner" title={C.ledger.planner} i={7}>
              <LState state={view.planner.state} compact />
              {shows(view.planner.state) && Lg.planner && (
                <ul className="l-lab-sentences">
                  {Lg.planner.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </Card>
            <Card id="retention" title={C.ledger.retention} i={8}>
              <ul className="l-lab-rows">
                {(['youtube', 'instagram'] as const).map((k) => {
                  const row = Lg.retention[k];
                  return (
                    <li key={k} className="l-lab-gap-row is-inline">
                      <span>{row.title}</span>
                      {row.state === 'not_configured' || row.state === 'needs_connect' ? (
                        <LabSetupLink href="?setup=keys" />
                      ) : (
                        <Tag tone={row.state === 'connected' ? 'ok' : 'quiet'}>{C.setupSheet.keyState[row.state] ?? row.state}</Tag>
                      )}
                    </li>
                  );
                })}
                {Lg.retention.byHookForm.filter((r) => r.enough).slice(0, 4).map((r) => (
                  <li key={r.hookForm} className="l-lab-gap-row is-inline">
                    <span>{r.label}</span>
                    <span className="l-num">{r.medianHookHold !== null ? `${fmtPct(r.medianHookHold)} · n ${r.n}` : `n ${r.n}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </div>
      <OutsideScoreDialog open={outside} onClose={() => setOutside(false)} scripts={view.frame.outsideScripts} readOnly={view.frame.readOnly} />
    </Frame>
  );
}
