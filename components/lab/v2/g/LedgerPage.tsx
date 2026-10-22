'use client';
/**
 * Ledger (`/lab/ledger`), GladOS tree (01 12): the calibration sentence (06's, verbatim) with the Lab's own
 * forecasts under it, the reliability bars (hit rate against base rate per band), predictor cards (a hidden
 * predictor shows its reason in place of every number), predictions, tests, the planner and retention.
 * Inconclusive and Performed the same rows are neutral, never warn. Numbers come from the view only.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { GButton, GSelect } from '@/components/g';
import { ActionPill } from '@/components/lab/v2/shared';
import type { LedgerPageView } from '@/lib/lab/view/ledger';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtDayMonth, fmtPct, underTitle } from '@/lib/lab/view/format';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';
import { Chip, PageBar, Panel, SectionNote, LabSetupLink } from './bits';
import { OPEN_OUTSIDE_SCORE } from './Frame';
import { GPageShell } from './PageShell';

const Lg = LAB_COPY.ledger;
/** Newest predictions shown before Show all (legibility; 06 returns up to 50). */
const PREDICTION_ROWS = 12;
const BAND_LABEL: Record<string, string> = { below: 'Below your normal', normal: 'Around your normal', above: 'Above your normal', breakout: 'Breakout' };

function Reliability({ view }: { view: LedgerPageView }) {
  const bins = view.ledger?.hero.reliability ?? [];
  if (!bins.length) return <SectionNote state={view.calibration.state} />;
  return (
    <ul className="lab2g-rel" aria-label={Lg.reliability}>
      {bins.map((b) => {
        const hit = b.said ? b.hit / b.said : 0;
        return (
          <li key={b.band} className="lab2g-rel-row">
            <span className="lab2g-rel-band" data-lab-ink="">{BAND_LABEL[b.band] ?? b.band}</span>
            {b.enough ? (
              <>
                <span className="lab2g-rel-bars" aria-hidden="true">
                  <span className="lab2g-rel-bar" data-kind="hit" style={{ width: `${Math.round(hit * 100)}%` }} data-lab-mark="" />
                  <span className="lab2g-rel-bar" data-kind="base" style={{ width: `${Math.round((b.baseRate ?? 0) * 100)}%` }} data-lab-mark="" />
                </span>
                <span className="lab2g-rel-num" data-lab-ink="">{`${b.hit} of ${b.said}`}</span>
              </>
            ) : (
              <span className="lab2g-muted lab2g-rel-thin" data-lab-ink="">{LAB_COPY.notEnough}</span>
            )}
          </li>
        );
      })}
      <li className="lab2g-rel-key" aria-hidden="true">
        <span><i data-kind="hit" />{LAB_UI.ledgerHitRate}</span>
        <span><i data-kind="base" />{LAB_UI.ledgerBaseRate}</span>
      </li>
    </ul>
  );
}

function Body({ view }: { view: LedgerPageView }) {
  const router = useRouter();
  const path = usePathname();
  const l = view.ledger;
  const [allRows, setAllRows] = useState(false);
  const rows = allRows ? view.predictions.rows : view.predictions.rows.slice(0, PREDICTION_ROWS);
  const sample = view.frame.mode.sample;
  const ro = view.frame.readOnly;
  const pick = (id: string) => {
    const q = new URLSearchParams(window.location.search);
    if (id === 'all') q.delete('predictor');
    else q.set('predictor', id);
    const s = q.toString();
    router.replace(`${path}${s ? `?${s}` : ''}`, { scroll: false });
  };
  const keep = (h: string) => (sample ? `${h}${h.includes('?') ? '&' : '?'}sample=1` : h);

  if (!l) {
    return (
      <div className="lab2g-stack">
        <Panel title={Lg.calibration} priority={2}>
          <SectionNote state={view.calibration.state.message ? view.calibration.state : { ...view.calibration.state, message: LAB_COPY.layer.ledger }} />
        </Panel>
      </div>
    );
  }

  const selected = l.predictors.find((p) => p.id === view.predictor) ?? null;
  const yt = l.retention.youtube;
  const ig = l.retention.instagram;
  const retentionNeedsKey = (yt.state === 'not_configured' || yt.state === 'needs_connect') && (ig.state === 'not_configured' || ig.state === 'needs_connect');

  return (
    <div className="lab2g-stack">
      <PageBar
        tools={
          <>
            {view.predictorOptions.length > 1 && (
              <span className="lab2g-selectpill">
                <span className="lab2g-selectpill-k" data-lab-ink="">{Lg.predictor}</span>
                <GSelect
                  size="compact"
                  value={view.predictor ?? 'all'}
                  onChange={(e) => pick(e.target.value)}
                  aria-label={Lg.predictor}
                  options={view.predictorOptions.map((o) => ({ value: o.id, label: o.id === 'all' ? o.label : `${o.label} (n ${o.n})` }))}
                />
              </span>
            )}
            <ActionPill
              label={LAB_COPY.frame.logOutsideScore}
              onClick={() => window.dispatchEvent(new Event(OPEN_OUTSIDE_SCORE))}
              disabled={!!ro}
              disabledReason={ro ?? undefined}
              sharedId="ledger-outside"
            />
          </>
        }
      />

      <div className="lab2g-split lab2g-split-cal">
        <Panel id="lab2g-cal" title={Lg.calibration} priority={1}>
          <p className="lab2g-calsentence" data-lab-ink="">{view.calibration.sentence}</p>
          {view.calibration.meta && <p className="lab2g-muted" data-lab-ink="">{view.calibration.meta}</p>}
          {view.forecasts.record && (
            <div className="lab2g-forecasts">
              <h3 className="lab2g-subtitle" data-lab-ink="">{LAB_COPY.progress.forecastTitle}</h3>
              {[view.forecasts.record.runCost, view.forecasts.record.month, view.forecasts.record.gates].filter(Boolean).map((t) => (
                <p key={t} className="lab2g-text" data-lab-ink="">{t}</p>
              ))}
            </div>
          )}
        </Panel>
        <Panel id="lab2g-rel" title={Lg.reliability} priority={2}>
          <Reliability view={view} />
        </Panel>
      </div>

      {l.predictors.length > 0 && (
        <Panel id="lab2g-predictors" title={Lg.predictors}>
          <div className="lab2g-predcards">
            {l.predictors.map((p) => {
              const on = view.predictor === p.id;
              const cells = [p.pairwise, p.coverage, p.spearman].filter((m): m is NonNullable<typeof m> => !!m);
              return (
                <button data-g="LabButton" key={p.id} type="button" className="lab2g-predcard" aria-pressed={on} onClick={() => pick(on ? 'all' : p.id)}>
                  <span className="lab2g-predcard-title" data-lab-ink="">{p.label}</span>
                  {p.shown ? (
                    <>
                      <span className="lab2g-predcard-rec" data-lab-ink="">{underTitle(p.record, p.label)}</span>
                      {on && cells.map((m, i) => <span key={i} className="lab2g-muted" data-lab-ink="">{m.display}</span>)}
                    </>
                  ) : (
                    <span className="lab2g-muted" data-lab-ink="">{p.hiddenReason}</span>
                  )}
                </button>
              );
            })}
          </div>
          {selected && !selected.shown && selected.hiddenReason && <p className="lab2g-muted" data-lab-ink="">{selected.hiddenReason}</p>}
        </Panel>
      )}

      <Panel id="lab2g-predictions" title={Lg.predictions}>
        {view.predictions.rows.length === 0 ? (
          <SectionNote state={view.predictions.state.message ? view.predictions.state : { ...view.predictions.state, message: Lg.noPredictions, action: { label: Lg.freezeFirst, href: keep('/lab/studio') } }} />
        ) : (
          <div className="lab2g-tablewrap">
            <table className="lab2g-table lab2g-ledgertable">
              <thead>
                <tr>{(['post', 'predictor', 'said', 'happened', 'result', 'frozen'] as const).map((c) => <th key={c} scope="col">{Lg.columns[c]}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-k={Lg.columns.post}>
                      {r.postId ? (
                        <Link data-g="LabLink" href={keep(`?post=${encodeURIComponent(r.postId)}`)} scroll={false} className="lab2g-cell-link" data-lab-shared={`pred-${r.id}`} data-lab-ink="">{r.postTitle ?? r.postId}</Link>
                      ) : (
                        <span data-lab-ink="">{r.postTitle ?? LAB_COPY.labels.none}</span>
                      )}
                    </td>
                    <td data-k={Lg.columns.predictor} data-lab-ink="">{r.predictorLabel}</td>
                    <td data-k={Lg.columns.said} data-lab-ink="">{r.said}</td>
                    <td data-k={Lg.columns.happened} data-lab-ink="">{r.happened ?? LAB_COPY.labels.none}</td>
                    <td data-k={Lg.columns.result}><Chip tone={r.hit === null ? 'neutral' : r.hit ? 'up' : 'neutral'}>{r.hit === null ? Lg.pending : r.hit ? Lg.hit : Lg.miss}</Chip></td>
                    <td data-k={Lg.columns.frozen} data-lab-ink="">{fmtDayMonth(r.frozenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.predictions.rows.length > PREDICTION_ROWS && (
              <div className="lab2g-tablemore">
                <GButton size="sm" onClick={() => setAllRows((v) => !v)} aria-expanded={allRows}>
                  {allRows ? LAB_UI.showFewer : fill(LAB_UI.showAllN, { n: view.predictions.rows.length })}
                </GButton>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel
        id="lab2g-tests"
        title={Lg.tests}
        tools={<ActionPill label={LAB_COPY.frame.logTest} href={keep('?test=new')} disabled={!!ro} disabledReason={ro ?? undefined} sharedId="ledger-logtest" />}
      >
        {view.tests.rows.length === 0 ? (
          <SectionNote state={view.tests.state.message ? view.tests.state : { ...view.tests.state, message: Lg.noTests, action: { label: LAB_COPY.frame.logTest, href: keep('?test=new') } }} />
        ) : (
          <ul className="lab2g-rows">
            {view.tests.rows.map((t) => (
              <li key={t.row.id}>
                <Link data-g="LabLink" href={t.href} scroll={false} className="lab2g-row lab2g-testrow" data-lab-shared={`test-${t.row.id}`} data-sheet-title={t.row.title}>
                  <span className="lab2g-row-main">
                    <span className="lab2g-row-title" data-lab-ink="">{t.row.title}</span>
                    {t.row.status === 'done' && t.row.confirms && <span className="lab2g-muted" data-lab-ink="">{t.row.confirms}</span>}
                  </span>
                  <span className="lab2g-row-meta" data-lab-ink="">{t.kindLabel}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{fill(LAB_UI.armsN, { n: t.row.arms.length })}</span>
                  <Chip tone={t.tone === 'ok' ? 'up' : 'neutral'}>{t.statusLabel}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="lab2g-split">
        <Panel id="lab2g-planner" title={Lg.planner}>
          {l.planner ? (
            <ul className="lab2g-bullets">
              {l.planner.reasons.map((r) => <li key={r} className="lab2g-text" data-lab-ink="">{r}</li>)}
            </ul>
          ) : (
            <SectionNote state={view.planner.state.message ? view.planner.state : { ...view.planner.state, message: fill(Lg.plannerGate, { need: l.plannerGate.need, n: l.plannerGate.n }) }} />
          )}
          {l.experiments.length > 0 && (
            <>
              <h3 className="lab2g-subtitle" data-lab-ink="">{Lg.experiments}</h3>
              <ul className="lab2g-rows lab2g-rows-flat">
                {l.experiments.map((e) => (
                  <li key={e.featureKey} className="lab2g-row lab2g-row-static">
                    <span className="lab2g-row-main" data-lab-ink="">{e.label}</span>
                    <span className="lab2g-row-meta" data-lab-ink="">{fill(LAB_UI.experimentLine, { above: e.above, around: e.around, below: e.below })}</span>
                    <span className="lab2g-row-meta" data-lab-ink="">{`n ${e.n}`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel id="lab2g-retention" title={Lg.retention}>
          {retentionNeedsKey ? (
            <div className="lab2g-note" data-state="needs_key">
              <p className="lab2g-note-text" data-lab-ink="">{Lg.retentionNeedsKey}</p>
              <LabSetupLink href={keep('?setup=keys')} label={LAB_UI.setUp} className="lab2-setup" />
            </div>
          ) : (
            <ul className="lab2g-rows lab2g-rows-flat">
              {l.retention.byHookForm.map((r) => (
                <li key={r.hookForm} className="lab2g-row lab2g-row-static">
                  <span className="lab2g-row-main" data-lab-ink="">{r.label}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{r.enough && r.medianHookHold !== null ? fmtPct(r.medianHookHold) : LAB_COPY.notEnough}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{`n ${r.n}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function LedgerPage({ view }: { view: LedgerPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <Body view={view} />
    </GPageShell>
  );
}
