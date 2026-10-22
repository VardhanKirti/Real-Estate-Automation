'use client';
/**
 * Setup > Schedule (08.5.4, 09.5.4), drawn for the 560px sheet. Heartbeat and the kill switch, then one
 * row per paid job with cost, next runs, the month range and line fit; Edit expands the row in place
 * (presets, custom times, days, quiet hours, sync params) and every number recomputes in the browser
 * from 09's pure `nextRuns` and `estimatePlan`. Save, the on/off switch and Run now post 09's schedule
 * route; free jobs are read-only rows under "Free jobs (no cost)".
 */
import { useMemo, useState } from 'react';
import { GCheck, GInput, GSegmented, GToggle } from '@/components/g';
import { CostFitBar } from '@/components/lab/v2/shared';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { useLabRun } from '@/components/lab/v2/shared/useLabRun';
import { estimatePlan, type PlanInputs } from '@/lib/lab/setup/estimate';
import { JOB_PRESETS, nextRuns, runsIn30Days, type ScheduleJobRow } from '@/lib/lab/setup/schedule';
import type { ScheduleView } from '@/lib/lab/setup/view';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtAge, fmtClock, fmtUsd } from '@/lib/lab/view/format';
import type { JobConfig, LabJobId } from '@/lib/schemas';
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

const DAYS = LAB_UI.weekdays.split(',');
/** Monday-first display order of JS weekdays (0 = Sunday). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const usd = (x: number) => fmtUsd(x);

function nextText(iso: string[], tz: string): string {
  const today = new Date().toDateString();
  return iso
    .map((x) => {
      const d = new Date(x);
      return d.toDateString() === today ? `${LAB_UI.today} ${fmtClock(x, tz)}` : `${fmtLabDay(x, { tz })} ${fmtClock(x, tz)}`;
    })
    .join(', ');
}

function offTick(times: string[] | undefined): string | null {
  const t = (times ?? []).find((x) => Number(x.split(':')[1]) % 15 !== 0);
  return t ? fill(LAB_COPY.schedule.offTick, { 'HH:MM': t }) : null;
}

function JobRow({ row, planner, readOnly }: { row: ScheduleJobRow; planner: PlanInputs; readOnly: string | null }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<JobConfig>(row.config);
  const { post, busy } = useLabPost();
  const live = useLabRun();
  const now = useMemo(() => new Date(planner.now), [planner.now]);
  const presets = (JOB_PRESETS as Record<string, { id: string; label: string; config: Partial<JobConfig> }[]>)[row.id] ?? [];
  const active = presets.find((p) => JSON.stringify({ ...cfg, ...p.config, updatedAt: '', history: [] }) === JSON.stringify({ ...cfg, updatedAt: '', history: [] }))?.id ?? 'custom';
  const next = useMemo(() => (open ? nextRuns(cfg, row.id, now, planner.tz, 3) : row.next), [open, cfg, row.id, row.next, now, planner.tz]);
  const est = useMemo(() => {
    if (!open || !row.paid) return null;
    const sel = { ...planner.current, schedule: { ...planner.current.schedule, [row.id]: cfg } as Record<LabJobId, JobConfig> };
    const e = estimatePlan(planner, sel);
    const job = e.perJob.find((j) => j.job === row.id) ?? null;
    const line = row.cost.line ? e.perLine.find((l) => l.line === row.cost.line) ?? null : null;
    return { job, line, runs: runsIn30Days(cfg, row.id, now, planner.tz) };
  }, [open, row.paid, row.id, row.cost.line, planner, cfg, now]);
  const month = est?.job?.usd ?? row.cost.month;
  const fit = est?.line?.fit ?? row.cost.fit;
  const cap = row.cost.line ? planner.lineCaps[row.cost.line] ?? null : null;
  const lineLabel = row.label;
  const fitText =
    cap === null || fit === null || !month
      ? null
      : fit === 'over'
        ? fill(LAB_COPY.plan.lineOver, { cap: usd(cap).slice(1), d: String(est?.line?.stopDay ?? row.cost.stopDay ?? '') })
        : fill(fit === 'tight' ? LAB_COPY.plan.lineTight : LAB_COPY.plan.lineFits, { line: lineLabel, point: usd(month.point).slice(1), cap: usd(cap).slice(1) });
  const save = async () => {
    const r = await post('/api/lab/setup/schedule', { job: row.id, config: cfg }, { key: `save-${row.id}`, okText: LAB_UI.saved });
    if (r.ok) setOpen(false);
  };
  const runNow = async () => {
    if (row.id === 'sync') {
      const r = await post('/api/lab/run', {}, { key: `run-${row.id}`, refresh: false });
      if (r.ok && typeof r.data.batchId === 'string' && !r.data.dry) live.start(r.data.batchId);
      if (r.ok && r.data.dry) live.dryDone();
      return;
    }
    const r = await post('/api/lab/setup/schedule', { job: row.id, action: 'run_now' }, { key: `run-${row.id}`, refresh: false });
    if (r.ok && typeof r.data.batchId === 'string') live.start(r.data.batchId);
  };
  const paused = cfg.paused;
  return (
    <li className="lab2g-job" data-state={row.state} data-open={open ? '' : undefined}>
      <div className="lab2g-job-head">
        <span className="lab2g-job-titles">
          <span className="lab2g-job-label" data-lab-ink="">{row.label}</span>
          <span className="lab2g-muted" data-lab-ink="">{row.what}</span>
        </span>
        {row.cost.perRun !== null && <span className="lab2g-job-cost" data-lab-ink="">{fill(LAB_UI.perRun, { usd: usd(row.cost.perRun) })}</span>}
      </div>
      {next.length > 0 && !paused && <p className="lab2g-muted" data-lab-ink="">{`${LAB_UI.nextWord}: ${nextText(next, planner.tz)}`}</p>}
      {row.stateText && <p className="lab2g-muted" data-lab-ink="">{row.state === 'paused' ? LAB_COPY.schedule.pausedRow : row.stateText}</p>}
      {month && <p className="lab2g-text" data-lab-ink="">{fill(LAB_UI.monthAbout, { month: usd(month.point), low: usd(month.low), high: usd(month.high) })}</p>}
      {fitText && (
        <div className="lab2g-plan-line" data-fit={fit ?? undefined}>
          <span className="lab2g-muted" data-lab-ink="">{fitText}</span>
          {cap !== null && month && fit && <CostFitBar spent={planner.spentThisMonth[row.cost.line!] ?? 0} estimate={month} cap={cap} fit={fit} w={480} h={12} />}
        </div>
      )}
      {open && row.editable && (
        <div className="lab2g-job-edit lab2g-form">
          {presets.length > 0 && (
            <span className="lab2g-ctl">
              <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.howOften}</span>
              <GSegmented
                label={LAB_UI.howOften}
                size="compact"
                value={active}
                onChange={(id) => {
                  const p = presets.find((x) => x.id === id);
                  if (p) setCfg((c) => ({ ...c, ...p.config, mode: p.config.mode ?? 'default' }));
                  else setCfg((c) => ({ ...c, mode: 'times', times: c.times?.length ? c.times : ['07:00'] }));
                }}
                options={[...presets.map((p) => ({ value: p.id, label: p.label.replace(/ \(default\)$/, '') })), { value: 'custom', label: LAB_UI.customTimes }]}
              />
            </span>
          )}
          {cfg.mode === 'times' && (
            <span className="lab2g-ctl">
              <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.customTimes}</span>
              <span className="lab2g-times">
                {(cfg.times ?? []).map((t, i) => (
                  <GInput
                    key={i}
                    type="time"
                    aria-label={`${LAB_UI.customTimes} ${i + 1}`}
                    value={t}
                    onChange={(e) => setCfg((c) => ({ ...c, times: (c.times ?? []).map((x, j) => (j === i ? e.target.value : x)) }))}
                  />
                ))}
                {(cfg.times?.length ?? 0) < 24 && (
                  <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => setCfg((c) => ({ ...c, times: [...(c.times ?? []), '12:00'] }))}>
                    <span data-lab-ink="">{LAB_UI.addTime}</span>
                  </button>
                )}
              </span>
              {offTick(cfg.times) && <span className="lab2g-muted" data-lab-ink="">{offTick(cfg.times)}</span>}
            </span>
          )}
          {cfg.mode === 'interval' && (
            <span className="lab2g-ctl">
              <span className="lab2g-fieldlabel" data-lab-ink="">{fill(LAB_UI.everyMin, { n: String(cfg.everyMin ?? 120) })}</span>
              <GInput type="number" min={15} max={10080} step={15} aria-label={fill(LAB_UI.everyMin, { n: '' })} value={cfg.everyMin ?? 120} onChange={(e) => setCfg((c) => ({ ...c, everyMin: Math.max(15, Number(e.target.value) || 15) }))} />
            </span>
          )}
          <span className="lab2g-ctl">
            <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.daysLabel}</span>
            <span className="lab2g-days" role="group" aria-label={LAB_UI.daysLabel}>
              {DAY_ORDER.map((d, i) => {
                const on = !cfg.weekdays?.length || cfg.weekdays.includes(d);
                return (
                  <button data-g="LabButton"
                    key={d}
                    type="button"
                    className="lab2g-day"
                    aria-pressed={on}
                    onClick={() =>
                      setCfg((c) => {
                        const cur = c.weekdays?.length ? [...c.weekdays] : [0, 1, 2, 3, 4, 5, 6];
                        const nextDays = (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]).sort() as JobConfig['weekdays'];
                        return { ...c, weekdays: nextDays && nextDays.length === 7 ? [] : nextDays };
                      })
                    }
                  >
                    <span data-lab-ink="">{DAYS[i]}</span>
                  </button>
                );
              })}
            </span>
          </span>
          <span className="lab2g-ctl lab2g-quiet">
            <GCheck checked={!!cfg.quiet} onCheckedChange={(on) => setCfg((c) => ({ ...c, quiet: on ? { from: '23:00', to: '06:00' } : null }))}>
              {LAB_UI.quietHours}
            </GCheck>
            {cfg.quiet && (
              <span className="lab2g-times">
                <span className="lab2g-muted" data-lab-ink="">{LAB_UI.from}</span>
                <GInput type="time" aria-label={`${LAB_UI.quietHours} ${LAB_UI.from}`} value={cfg.quiet.from} onChange={(e) => setCfg((c) => ({ ...c, quiet: { from: e.target.value, to: c.quiet?.to ?? '06:00' } }))} />
                <span className="lab2g-muted" data-lab-ink="">{LAB_UI.to}</span>
                <GInput type="time" aria-label={`${LAB_UI.quietHours} ${LAB_UI.to}`} value={cfg.quiet.to} onChange={(e) => setCfg((c) => ({ ...c, quiet: { from: c.quiet?.from ?? '23:00', to: e.target.value } }))} />
              </span>
            )}
          </span>
          {row.id === 'sync' && (
            <span className="lab2g-form-pair">
              <span className="lab2g-ctl">
                <span className="lab2g-fieldlabel" data-lab-ink="">{fill(LAB_UI.trackedEvery, { n: String(cfg.params?.trackedEveryH ?? 20) })}</span>
                <GInput type="number" min={6} max={72} aria-label={fill(LAB_UI.trackedEvery, { n: '' })} value={cfg.params?.trackedEveryH ?? 20} onChange={(e) => setCfg((c) => ({ ...c, params: { ...c.params, trackedEveryH: Math.min(72, Math.max(6, Number(e.target.value) || 20)) } }))} />
              </span>
              <span className="lab2g-ctl">
                <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.postsPerRead}</span>
                <GInput type="number" min={10} max={50} aria-label={LAB_UI.postsPerRead} value={cfg.params?.cycleDepth ?? 15} onChange={(e) => setCfg((c) => ({ ...c, params: { ...c.params, cycleDepth: Math.min(50, Math.max(10, Number(e.target.value) || 15)) } }))} />
              </span>
            </span>
          )}
          {est && row.cost.perRun !== null && est.job && (
            <p className="lab2g-text" data-lab-ink="">
              {fill(LAB_UI.perRunMonth, { usd: usd(row.cost.perRun), n: String(est.runs), month: usd(est.job.usd.point), low: usd(est.job.usd.low), high: usd(est.job.usd.high) })}
            </p>
          )}
          {row.id === 'snapshots' && <p className="lab2g-muted" data-lab-ink="">{LAB_COPY.schedule.fixedAgeNote}</p>}
          <span className="lab2g-sheetfoot">
            <span className="lab2g-grow" />
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => { setCfg(row.config); setOpen(false); }}>
              <span data-lab-ink="">{LAB_UI.cancel}</span>
            </button>
            <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={readOnly ? true : undefined} title={readOnly ?? undefined} onClick={() => !readOnly && save()}>
              {busy === `save-${row.id}` ? LAB_UI.loading : LAB_UI.saveSchedule}
            </button>
          </span>
        </div>
      )}
      <div className="lab2g-job-tools">
        {row.editable && !open && (
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => setOpen(true)}>
            <span data-lab-ink="">{LAB_UI.edit}</span>
          </button>
        )}
        {row.paid && (
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={readOnly ? true : undefined} title={readOnly ?? undefined} onClick={() => !readOnly && runNow()}>
            <span data-lab-ink="">{busy === `run-${row.id}` ? LAB_UI.running : LAB_UI.runNow}</span>
          </button>
        )}
        <GToggle
          checked={!paused}
          disabled={!!readOnly}
          disabledReason={readOnly ?? undefined}
          onCheckedChange={async (on) => {
            const c = { ...cfg, paused: !on };
            setCfg(c);
            await post('/api/lab/setup/schedule', { job: row.id, config: c }, { key: `pause-${row.id}` });
          }}
          aria-label={fill(LAB_UI.jobOn, { job: row.label })}
        >
          {null}
        </GToggle>
      </div>
    </li>
  );
}

export function ScheduleEditor({ schedule, planner, readOnly, pausedBanner }: { schedule: ScheduleView; planner: PlanInputs; readOnly: string | null; pausedBanner: string | null }) {
  const [showFree, setShowFree] = useState(false);
  const { post } = useLabPost();
  const paid = schedule.jobs.filter((j) => j.paid);
  const free = schedule.jobs.filter((j) => !j.paid);
  const hb = schedule.heartbeat;
  const age = hb.checkedAt ? (Date.now() - Date.parse(hb.checkedAt)) / 3_600_000 : null;
  const pausedAll = schedule.paused.scope === 'all';
  return (
    <div className="lab2g-schedule">
      <div className="lab2g-sched-head">
        <span className="lab2g-job-titles">
          <span className="lab2g-job-label" data-lab-ink="">{schedule.label}</span>
          {schedule.agentLabel && <span className="lab2g-muted" data-lab-ink="">{schedule.agentLabel}</span>}
        </span>
        <span className="lab2-chip" data-state={hb.state}><span data-lab-ink="">{age === null ? LAB_UI.noTick : `${fill(LAB_UI.lastTick, { age: fmtAge(age) })}, ${hb.state}`}</span></span>
      </div>
      {hb.state === 'warn' && age !== null && <p className="lab2g-muted" data-lab-ink="">{fill(LAB_COPY.schedule.heartbeatLate, { age: fmtAge(age) })}</p>}
      {!schedule.installed && <p className="lab2g-muted" data-lab-ink="">{schedule.privateInstance ? LAB_COPY.schedule.notInstalled : LAB_COPY.schedule.client}</p>}
      {pausedBanner && <p className="lab2g-banner-line" data-lab-ink="">{pausedBanner}</p>}
      <span className="lab2g-row-tools">
        <GToggle
          checked={!!schedule.paused.by}
          disabled={pausedAll || !!readOnly}
          disabledReason={pausedAll ? pausedBanner ?? undefined : readOnly ?? undefined}
          onCheckedChange={(on) => post('/api/lab/setup/pause', { paused: on }, { key: 'pause' })}
        >
          {LAB_UI.pauseLab}
        </GToggle>
        <GToggle
          checked={schedule.brief.telegram}
          disabled={!!readOnly}
          disabledReason={readOnly ?? undefined}
          onCheckedChange={(on) => post('/api/lab/setup/keys', { env: 'LAB_BRIEF_TELEGRAM', value: on ? '1' : '0' }, { key: 'tg' })}
        >
          {LAB_UI.telegram}
        </GToggle>
      </span>
      <ul className="lab2g-jobs">
        {paid.map((r) => <JobRow key={r.id} row={r} planner={planner} readOnly={readOnly} />)}
      </ul>
      <div className="lab2g-free">
        <button data-g="LabButton" type="button" className="lab2g-freehead" aria-expanded={showFree} onClick={() => setShowFree((s) => !s)}>
          <span data-lab-ink="">{LAB_UI.freeJobs}</span>
          <span className="lab2g-muted" data-lab-ink="">{showFree ? LAB_UI.hide : LAB_UI.show}</span>
        </button>
        {showFree && (
          <ul className="lab2g-jobs">
            {free.map((r) => <JobRow key={r.id} row={r} planner={planner} readOnly={readOnly} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
