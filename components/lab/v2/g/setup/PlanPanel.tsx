'use client';
/**
 * The plan panel under the tracked list (09.2.8 A, 09.3.7), drawn for the 560px Setup sheet. The cost
 * block runs 09's pure `estimatePlan` in the browser on every change to the what-if counts (no network
 * call, 01 D14), with the line fit on 02's CostFitBar. The gates block shows 09's `GateEta` rows for the
 * current set. The price label for an assumed tier carries a SetupLink to `?setup=keys` (AC-09-29).
 */
import { useMemo, useState } from 'react';
import { CostFitBar } from '@/components/lab/v2/shared';
import { estimatePlan, priceLabel, type PlanInputs, type PlanSelection } from '@/lib/lab/setup/estimate';
import type { GateEta } from '@/lib/lab/setup/gates';
import type { ForecastRecord } from '@/lib/lab/setup/forecasts';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtCount, fmtPct, fmtUsd } from '@/lib/lab/view/format';
import type { LabPlatform } from '@/lib/schemas';
import { LabSetupLink } from '../bits';

/** 09.8's one rates label, "Assumed rates / Partly from your data / From your data", one part per state. */
const RATES = LAB_COPY.plan.ratesLabel.split(' / ');
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

const PLATFORM: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };
const LINE: Record<string, string> = { 'apify.sync': 'Daily sync', 'apify.snapshots': 'Fixed-age reads', 'apify.x': 'X reads', 'apify.radar_x': 'Radar, X', 'apify.radar_tiktok': 'Radar, TikTok', 'apify.radar_producthunt': 'Radar, Product Hunt', 'apify.verify': 'Actor checks' };
const GATE: Record<string, string> = {
  breakouts_week: 'Breakouts to study',
  baseline_24h: 'Their normal',
  forecast_fit_24h: '24-hour forecast',
  profile_family: 'Playbook, first format',
  profile_strong: 'Playbook, strong',
  profile_moderate: 'Playbook, moderate',
  radar_crowd: 'Radar crowd rule',
  niche_baseline: 'Niche normal',
};

const usd = (x: number) => fmtUsd(x).slice(1);
function when(days: number): string {
  if (days < 14) return `${Math.max(1, Math.round(days))} days`;
  return `${Math.round(days / 7)} weeks`;
}

export function PlanPanel({ planner, gates, record, sample }: { planner: PlanInputs; gates: GateEta[]; record: ForecastRecord | null; sample: boolean }) {
  const [sel, setSel] = useState<PlanSelection>(planner.current);
  const est = useMemo(() => estimatePlan(planner, sel), [planner, sel]);
  const label = priceLabel(planner, { sample });
  const assumed = !sample && planner.tier.source === 'assumed';
  const total = sel.tracked.reduce((a, t) => a + t.count, 0) + sel.owned.reduce((a, t) => a + t.count, 0);
  const step = (platform: LabPlatform, d: number) =>
    setSel((s) => {
      const has = s.tracked.find((t) => t.platform === platform);
      const tracked = has ? s.tracked.map((t) => (t.platform === platform ? { ...t, count: Math.max(0, t.count + d) } : t)) : [...s.tracked, { platform, count: Math.max(0, d) }];
      return { ...s, tracked };
    });
  const platforms = (['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'] as LabPlatform[]).filter((p) => sel.tracked.some((t) => t.platform === p) || sel.owned.some((t) => t.platform === p));
  const lines = est.perLine.filter((l) => l.line.startsWith('apify.') && l.usd.point > 0);
  const rates = planner.rates;
  const sources = new Set(Object.values(rates).flatMap((r) => (r && typeof r === 'object' && 'source' in r ? [(r as { source: string }).source] : [])));
  const ratesLabel = sources.size === 1 && sources.has('observed') ? RATES[2] : sources.has('observed') || sources.has('blended') ? RATES[1] : RATES[0];

  return (
    <div className="lab2g-plan" data-lab="PlanPanel" data-g="LabPlanPanel">
      <section className="lab2g-plan-block" aria-labelledby="lab2g-plan-cost">
        <header className="lab2g-plan-head">
          <h3 id="lab2g-plan-cost" className="lab2g-plan-title" data-lab-ink="">{LAB_UI.planCostTitle}</h3>
          <span className="lab2g-plan-label" data-lab-ink="">
            {assumed ? (
              <>
                {label} <LabSetupLink href="?setup=keys" label={LAB_UI.setUp} className="lab2-setup" />
              </>
            ) : (
              label
            )}
          </span>
        </header>
        {total === 0 ? (
          <p className="lab2g-text" data-lab-ink="">{LAB_COPY.plan.noSources}</p>
        ) : (
          <>
            <p className="lab2g-plan-headline" data-lab-ink="">
              {fill(LAB_COPY.plan.costHeadline, { perDay: usd(est.month.point / 30), month: usd(Math.round(est.month.point)), low: usd(Math.round(est.month.low)), high: usd(Math.round(est.month.high)) })}
            </p>
            {est.backfillOnce > 0 && (
              <p className="lab2g-muted" data-lab-ink="">{fill(LAB_COPY.plan.backfill, { n: fmtCount(sel.newThisMonth.reduce((a, x) => a + x.count, 0)), usd: usd(est.backfillOnce) })}</p>
            )}
            <div className="lab2g-plan-lines">
              {lines.map((l) => {
                const spent = planner.spentThisMonth[l.line] ?? 0;
                const text =
                  l.cap === null
                    ? `${LINE[l.line] ?? l.line} ${fmtUsd(l.usd.point)}`
                    : l.fit === 'over'
                      ? fill(LAB_COPY.plan.lineOver, { cap: usd(l.cap), d: String(l.stopDay ?? '') })
                      : fill(l.fit === 'tight' ? LAB_COPY.plan.lineTight : LAB_COPY.plan.lineFits, { line: LINE[l.line] ?? l.line, point: usd(l.usd.point), cap: usd(l.cap) });
                return (
                  <div key={l.line} className="lab2g-plan-line" data-fit={l.fit}>
                    <span className="lab2g-text" data-lab-ink="">{text}</span>
                    {l.cap !== null && <CostFitBar spent={spent} estimate={l.usd} cap={l.cap} fit={l.fit} w={480} h={14} />}
                    {l.fit === 'over' && <a data-g="LabLink" href="?setup=spend" className="lab2-textlink" data-lab-ink="">{LAB_UI.raiseCap}</a>}
                  </div>
                );
              })}
            </div>
            <div className="lab2g-plan-steppers" aria-label={LAB_UI.whatIf}>
              <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.whatIf}</span>
              {platforms.map((p) => {
                const c = sel.tracked.find((t) => t.platform === p)?.count ?? 0;
                return (
                  <span key={p} className="lab2g-stepper">
                    <span className="lab2g-text" data-lab-ink="">{PLATFORM[p]}</span>
                    <button data-g="LabButton" type="button" className="lab2-pill lab2g-step" aria-label={fill(LAB_UI.fewer, { p: PLATFORM[p] })} onClick={() => step(p, -1)}>
                      <span data-lab-ink="">{LAB_UI.minus}</span>
                    </button>
                    <span className="lab2g-stepper-n" data-lab-ink="" aria-live="polite">{fmtCount(c)}</span>
                    <button data-g="LabButton" type="button" className="lab2-pill lab2g-step" aria-label={fill(LAB_UI.more, { p: PLATFORM[p] })} onClick={() => step(p, 1)}>
                      <span data-lab-ink="">{LAB_UI.plus}</span>
                    </button>
                  </span>
                );
              })}
              {sel !== planner.current && (
                <button data-g="LabButton" type="button" className="lab2-textlink lab2g-linkbtn" onClick={() => setSel(planner.current)}>
                  {LAB_UI.resetSet}
                </button>
              )}
            </div>
            {record && <p className="lab2g-muted" data-lab-ink="">{record.runCost}</p>}
          </>
        )}
      </section>
      <section className="lab2g-plan-block" aria-labelledby="lab2g-plan-gates">
        <header className="lab2g-plan-head">
          <h3 id="lab2g-plan-gates" className="lab2g-plan-title" data-lab-ink="">{LAB_COPY.plan.gatesHeader}</h3>
          <span className="lab2g-plan-label" data-lab-ink="">{ratesLabel}</span>
        </header>
        <dl className="lab2g-gates">
          {gates
            .filter((g) => g.platform === 'all' && g.state !== 'not_applicable')
            .map((g) => (
              <div key={g.gate} className="lab2g-gate" data-state={g.state}>
                <dt data-lab-ink="">{GATE[g.gate] ?? g.gate}</dt>
                <dd data-lab-ink="">
                  {g.state === 'met'
                    ? g.metAt
                      ? fill(LAB_UI.readySince, { d: fmtLabDay(g.metAt) })
                      : LAB_UI.readyWord
                    : g.state === 'blocked'
                      ? g.blockedReason ?? ''
                      : g.days
                        ? `${LAB_UI.about} ${when(g.days.med)} (${when(g.days.lo)} to ${when(g.days.hi)})`
                        : ''}
                </dd>
              </div>
            ))}
        </dl>
        <p className="lab2g-muted" data-lab-ink="">{fill(LAB_COPY.plan.rateLine, { pct: fmtPct(rates.breakoutRate.value), source: rates.breakoutRate.note })}</p>
        <p className="lab2g-muted" data-lab-ink="">{LAB_COPY.plan.lowerBound}</p>
      </section>
    </div>
  );
}
