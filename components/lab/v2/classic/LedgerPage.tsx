'use client';
/**
 * Ledger (`/lab/ledger`), Classic tree (01 12): calibration (06's sentence verbatim) and reliability, the
 * Lab's own forecasts, predictor cards, predictions, tests, experiments, planner and retention.
 * Hidden predictors show their reason line, never a number. Inconclusive is calm (neutral tone).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { Glass } from '@/components/lab/v2/shared';
import type { LedgerPageView } from '@/lib/lab/view/ledger';
import type { PredictorCard } from '@/lib/lab/ledger/view';
import { fmtClock, fmtPct, underTitle } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { OutsideScoreDialog, ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { Panel, StateLine, Tag, shows } from './parts';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

const BAND_LABEL = C.ledger.bands;

function Predictor({ p, expanded, href }: { p: PredictorCard; expanded: boolean; href: string }) {
  const cells = (['pairwise', 'coverage', 'spearman', 'logMae', 'prAuc'] as const).filter((k) => p[k]);
  return (
    <Glass as="article" tone="strong" radius="tile" priority={3} className="lab2c-pred-card" data-expanded={expanded ? '' : undefined} data-hidden={!p.shown ? '' : undefined}>
      <Link href={href} replace scroll={false} className="lab2c-pred-link" aria-current={expanded ? 'true' : undefined}>
        <span className="lab2c-pred-title">
          <span data-lab-ink="">{p.label}</span>
          {p.isBaseline && <Tag tone="quiet">{C.ledger.baseline}</Tag>}
          {!p.shown && <Tag tone="quiet">{C.ledger.hidden}</Tag>}
        </span>
        {p.shown ? (
          <>
            <span className="lab2c-pred-record" data-lab-ink="">{underTitle(p.record, p.label)}</span>
            <span className="lab2c-pred-cells">
              {cells.slice(0, expanded ? 5 : 2).map((k) => (
                <span key={k} className="lab2c-pred-cell">
                  <span className="lab2c-kv-k" data-lab-ink="">{C.ledger.metrics[k]}</span>
                  <span className="lab2c-pred-val" data-lab-ink="">{p[k]!.display}</span>
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="lab2c-pred-record" data-lab-ink="">{p.hiddenReason}</span>
        )}
      </Link>
    </Glass>
  );
}

export function LedgerPage({ view }: { view: LedgerPageView }) {
  return (
    <ClassicCapHost>
      <LedgerPageBody view={view} />
    </ClassicCapHost>
  );
}

function LedgerPageBody({ view }: { view: LedgerPageView }) {
  const router = useRouter();
  const [outside, setOutside] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const L = view.ledger;
  const live = view.frame.layers.ledger === 'live' && !!L;
  const sample = view.frame.mode.sample;
  const predHref = (id: string | null) => {
    const q = new URLSearchParams(sample ? { sample: '1' } : {});
    if (id && id !== 'all') q.set('predictor', id);
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
  const open = (row: { postId: string | null }) => { if (row.postId) { const u = new URL(window.location.href); u.searchParams.set('post', row.postId); openSheetHref(u.pathname + u.search); } };

  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      {live && (
        <div className="lab2c-bar">
          <label className="lab2c-bar-group">
            <span className="lab2c-bar-label" data-lab-ink="">{C.ledger.predictor}</span>
            <select className="lab2c-input lab2c-select" value={view.predictor ?? 'all'} onChange={(e) => router.replace(predHref(e.target.value), { scroll: false })}>
              {view.predictorOptions.map((o) => <option key={o.id} value={o.id}>{`${o.label} (${o.n})`}</option>)}
            </select>
          </label>
          <span className="lab2c-bar-end">
            <button type="button" className="lab2c-btn" onClick={() => setOutside(true)}>{C.ledger.logOutside}</button>
          </span>
        </div>
      )}

      <div className="lab2c-split lab2c-gap-top-s">
        <Panel id="calibration" title={C.ledger.calibration} priority={2}>
          <StateLine state={view.calibration.state} />
          {shows(view.calibration.state) && (
            <>
              <p className="lab2c-calib" data-lab-ink="">{view.calibration.sentence}</p>
              <p className="lab2c-muted" data-lab-ink="">{view.calibration.meta}</p>
            </>
          )}
          {shows(view.forecasts.state) && view.forecasts.record && (
            <div className="lab2c-forecasts">
              <h3 className="lab2c-block-title" data-lab-ink="">{C.ledger.forecasts}</h3>
              <ul className="lab2c-forecast-lines">
                <li data-lab-ink="">{view.forecasts.record.runCost}</li>
                <li data-lab-ink="">{view.forecasts.record.month}</li>
                <li data-lab-ink="">{view.forecasts.record.gates}</li>
              </ul>
            </div>
          )}
        </Panel>
        <Panel id="reliability" title={C.ledger.reliability} desc={C.ledger.reliabilityDesc}>
          {live && L.hero.reliability.length > 0 ? (
            <ul className="lab2c-rel">
              {L.hero.reliability.map((b) => (
                <li key={b.band} className="lab2c-rel-row">
                  <span className="lab2c-rel-band" data-lab-ink="">{BAND_LABEL[b.band] ?? b.band}</span>
                  {b.enough && b.said > 0 ? (
                    <span className="lab2c-rel-bars">
                      <span className="lab2c-rel-bar" data-kind="hit" style={{ width: `${Math.round((b.hit / b.said) * 100)}%` }} data-lab-mark="" />
                      {b.baseRate !== null && <span className="lab2c-rel-bar" data-kind="base" style={{ width: `${Math.round(b.baseRate * 100)}%` }} data-lab-mark="" />}
                    </span>
                  ) : (
                    <span className="lab2c-rel-bars lab2c-muted" data-lab-ink="">{C.notEnough}</span>
                  )}
                  <span className="lab2c-rel-num" data-lab-ink="">{b.enough && b.said > 0 ? `${fmtPct(b.hit / b.said)} · ${b.baseRate !== null ? fmtPct(b.baseRate) : ''}` : `n ${b.said}`}</span>
                </li>
              ))}
              <li className="lab2c-rel-key" aria-hidden="true">
                <span className="lab2c-rel-swatch" data-kind="hit" />
                <span data-lab-ink="">{C.ledger.hitRate}</span>
                <span className="lab2c-rel-swatch" data-kind="base" />
                <span data-lab-ink="">{C.ledger.baseRate}</span>
              </li>
            </ul>
          ) : (
            <StateLine state={view.calibration.state} compact />
          )}
        </Panel>
      </div>

      {live && L.predictors.length > 0 && (
        <section className="lab2c-gap-top" aria-labelledby="preds-title">
          <h2 id="preds-title" className="lab2-row-title lab2c-sechead" data-lab-ink="">{C.ledger.predictors}</h2>
          <div className="lab2c-pred-grid">
            {L.predictors.map((p) => <Predictor key={p.id} p={p} expanded={view.predictor === p.id} href={predHref(view.predictor === p.id ? null : p.id)} />)}
          </div>
        </section>
      )}

      <Panel id="predictions" title={C.ledger.predictions} className="lab2c-gap-top">
        <StateLine state={view.predictions.state} />
        {shows(view.predictions.state) && view.predictions.rows.length > 0 && (
          <div className="lab2c-table-wrap">
            <table className="lab2c-table lab2c-table-cards">
              <thead>
                <tr>
                  <th scope="col">{C.ledger.cols.post}</th>
                  <th scope="col">{C.ledger.cols.predictor}</th>
                  <th scope="col">{C.ledger.cols.said}</th>
                  <th scope="col">{C.ledger.cols.happened}</th>
                  <th scope="col">{C.ledger.cols.result}</th>
                  <th scope="col" className="lab2c-num-col">{C.ledger.cols.frozen}</th>
                </tr>
              </thead>
              <tbody>
                {view.predictions.rows.slice(0, allRows ? 50 : 12).map((r) => (
                  <tr key={r.id} data-href={r.postId ? '' : undefined} onClick={() => open(r)}>
                    <td data-label={C.ledger.cols.post}>
                      {r.postId ? (
                        <Link href={`?post=${r.postId}`} scroll={false} className="lab2c-rowlink" data-lab-ink="" data-lab-shared={`pred-${r.id}`} onClick={(e) => e.stopPropagation()}>{r.postTitle ?? r.postId}</Link>
                      ) : (
                        <span className="lab2c-muted" data-lab-ink="">{r.postTitle ?? C.ledger.pending}</span>
                      )}
                    </td>
                    <td data-label={C.ledger.cols.predictor} data-lab-ink="">{r.predictorLabel}</td>
                    <td data-label={C.ledger.cols.said} data-lab-ink="">{r.said}</td>
                    <td data-label={C.ledger.cols.happened} data-lab-ink="">{r.happened ?? ''}</td>
                    <td data-label={C.ledger.cols.result}>
                      {r.hit === true ? <Tag tone="strong">{C.ledger.hit}</Tag> : r.hit === false ? <Tag tone="quiet">{C.ledger.miss}</Tag> : <span className="lab2c-muted" data-lab-ink="">{C.ledger.pending}</span>}
                      {r.late && <Tag tone="quiet">{C.ledger.late}</Tag>}
                    </td>
                    <td className="lab2c-num-col" data-label={C.ledger.cols.frozen} data-lab-ink="">{fmtClock(r.frozenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.predictions.rows.length > 12 && (
          <span>
            <button type="button" className="lab2c-btn" aria-expanded={allRows} onClick={() => setAllRows((x) => !x)}>
              {allRows ? C.schedule.hide : `${C.more} (${Math.min(50, view.predictions.rows.length)})`}
            </button>
          </span>
        )}
      </Panel>

      <Panel id="tests" title={C.ledger.tests} className="lab2c-gap-top" tools={<Link href="?test=new" scroll={false} className="lab2c-btn" data-lab-shared="log-test">{C.ledger.logTest}</Link>}>
        <StateLine state={view.tests.state} />
        {shows(view.tests.state) && view.tests.rows.length > 0 && (
          <ul className="lab2c-tests">
            {view.tests.rows.map((t) => (
              <li key={t.row.id}>
                <Link href={t.href} scroll={false} className="lab2c-test" data-lab-shared={`test-${t.row.id}`}>
                  <span className="lab2c-test-main">
                    <span className="lab2c-test-title" data-lab-ink="">{t.row.title}</span>
                    <span className="lab2c-muted" data-lab-ink="">{t.kindLabel}</span>
                  </span>
                  <span className="lab2c-test-arms" data-lab-ink="">
                    {t.row.arms.map((a, i) => (
                      <span key={i} className="lab2c-test-arm" data-winner={a.isWinner ? '' : undefined}>{a.rate ? `${a.label} ${a.rate}` : a.label}</span>
                    ))}
                  </span>
                  <span className="lab2c-test-status">
                    <Tag tone={t.tone === 'ok' ? 'strong' : 'quiet'}>{t.statusLabel}</Tag>
                    {t.row.confirms && <span className="lab2c-muted" data-lab-ink="">{t.row.confirms}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {live && (
        <div className="lab2c-split lab2c-split-3">
          <Panel id="experiments" title={C.ledger.experiments}>
            {L.experiments.length ? (
              <ul className="lab2c-exp">
                {L.experiments.map((e) => (
                  <li key={e.featureKey}>
                    <span data-lab-ink="">{e.label}</span>
                    <span className="lab2c-muted" data-lab-ink="">{e.n >= 5 ? `${e.above} ${C.ledger.above} · ${e.around} ${C.ledger.around} · ${e.below} ${C.ledger.below} · n ${e.n}` : `${C.notEnough} · n ${e.n}`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lab2c-muted" data-lab-ink="">{C.notEnough}</p>
            )}
          </Panel>
          <Panel id="planner" title={C.ledger.planner}>
            <StateLine state={view.planner.state} compact />
            {shows(view.planner.state) && L.planner && (
              <ul className="lab2c-sentences lab2c-sentences-s">
                {L.planner.reasons.map((r, i) => <li key={i} data-lab-ink="">{r}</li>)}
              </ul>
            )}
          </Panel>
          <Panel id="retention" title={C.ledger.retention}>
            {(['youtube', 'instagram'] as const).map((k) => {
              const row = L.retention[k];
              return (
                <div key={k} className="lab2c-ret-row">
                  <span data-lab-ink="">{row.title}</span>
                  {row.state === 'not_configured' || row.state === 'needs_connect' ? (
                    <SetupLink href="?setup=keys" label={C.setUp} className="lab2-setup" />
                  ) : (
                    <Tag tone={row.state === 'connected' ? 'strong' : 'quiet'}>{C.setupSheet.keyState[row.state] ?? row.state}</Tag>
                  )}
                </div>
              );
            })}
            {L.retention.byHookForm.filter((r) => r.enough).slice(0, 4).map((r) => (
              <div key={r.hookForm} className="lab2c-ret-row">
                <span data-lab-ink="">{r.label}</span>
                <span className="lab2c-muted" data-lab-ink="">{r.medianHookHold !== null ? `${fmtPct(r.medianHookHold)} · n ${r.n}` : `n ${r.n}`}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
      <OutsideScoreDialog open={outside} onClose={() => setOutside(false)} scripts={[]} readOnly={view.frame.readOnly} />
    </Frame>
  );
}
