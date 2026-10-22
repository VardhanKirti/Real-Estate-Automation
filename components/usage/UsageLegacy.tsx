'use client';

/**
 * /usage under the Bennett Legacy style (pages/usage.md §8): FounderOS's own
 * Usage slab (shots/founderos-v1/usage-1440.png). Token Burn step line beside
 * Burn Volume, then Burn by Model, Plan Limits (official gauges only) and the
 * Top burner insight, then one card per plan. Same payload, poll and view as
 * the other trees (use-usage.ts, lib/usage-view.ts); Legacy kit and --l-* only.
 */
import { useState } from 'react';
import { Copy, Flame } from 'lucide-react';
import {
  BigStat,
  Chip,
  InsightCard,
  LDialog,
  LEmpty,
  LError,
  LSampleChip,
  LUnconfigured,
  Dot,
  MeterStack,
  Pressable,
  SlabCard,
  SlabTitle,
  StepLine,
  ToggleChip,
  type Meter,
  type Tone,
} from '@/components/legacy';
import type { UsagePlan } from '@/lib/schemas';
import type { UsagePayload } from '@/lib/usage-payload';
import { USAGE_TITLE, fmtTokens, type PlanCardView, type UsageReadyView } from '@/lib/usage-view';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { pushUrl, useUsage } from './use-usage';

const EYEBROW = 'Token burn · one plan per provider';
const META = 'Claude · ChatGPT / Codex · Ollama · local file parsing only · no paid calls · refreshes every 10s';

const share = (n: number, max: number) => (max > 0 ? n / max : 0);
const toneOf = (t: 'ok' | 'warn' | 'err' | 'neutral'): Tone | undefined => (t === 'neutral' ? undefined : t);

function CopyPushUrl({ path }: { path: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Pressable
      title={`POST readings here with Authorization: Bearer <USAGE_PUSH_TOKEN> (${path})`}
      onClick={async () => {
        try {
          if (!navigator.clipboard) throw new Error('no clipboard');
          await navigator.clipboard.writeText(pushUrl(path));
          setState('copied');
        } catch {
          setState('failed');
        }
        window.setTimeout(() => setState('idle'), 1800);
      }}
    >
      <Copy size={12} strokeWidth={1.7} aria-hidden />
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy push URL'}
    </Pressable>
  );
}

/** A plan's burn per day as a thin line (FO WindowStrip): scaled to its own max, no axis. */
function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 28;
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(2)},${(h - 2 - (v / max) * (h - 4)).toFixed(2)}`).join(' ');
  return (
    <svg data-l="Spark" className="l-us-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={pts} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PlanCard({ p, i, onOpen }: { p: PlanCardView; i: number; onOpen: () => void }) {
  return (
    <SlabCard
      title={p.label}
      sub={p.meta}
      i={i}
      action={
        <Pressable onClick={onOpen} title={`${p.label}: open the plan detail`}>
          Detail
        </Pressable>
      }
    >
      <div className="l-card-body">
        {p.reported ? <BigStat display={p.total} size={30} unit="tokens" /> : <div className="l-us-unreported">{p.total}</div>}
        {p.status && (
          <div className="l-chip-row mt-3">
            <Chip tone={toneOf(p.status.tone)}>{p.status.text}</Chip>
          </div>
        )}
        <div className="mt-4">{p.spark ? <Spark values={p.spark} label={`${p.label} burn per day`} /> : <span data-l="Spark" className="l-us-spark is-none" aria-hidden />}</div>
      </div>
    </SlabCard>
  );
}

function PlanDialog({ p, v, onClose }: { p: PlanCardView; v: UsageReadyView; onClose: () => void }) {
  const d = p.detail;
  const dayMax = Math.max(0, ...(d.days ?? []).map((x) => x.burn));
  const laneMax = Math.max(0, ...(d.lanes ?? []).map((x) => x.burn));
  const days: Meter[] = (d.days ?? []).slice(-10).map((x) => ({ label: x.long, frac: share(x.burn, dayMax), display: fmtTokens(x.burn) }));
  const lanes: Meter[] = (d.lanes ?? []).map((l) => ({ label: l.label, frac: share(l.burn, laneMax), display: l.display }));
  const windows: Meter[] = d.windows.map((w) => ({ label: `${w.label}${w.resets ? ` · ${w.resets}` : ''}`, frac: w.used / 100, display: `${Math.round(w.used)}%` }));
  return (
    <LDialog title={p.label} sub={`${p.reported ? `${p.total} tokens` : p.total} · ${v.rangeLabel}`} onClose={onClose} width={760} footer={<CopyPushUrl path={v.push.path} />}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="l-form-label">Per day</h3>
          {d.days ? <MeterStack meters={days} dense baseDelay={0} /> : <p className="l-body-text">Not reported. No machine reported this plan in the window.</p>}
        </div>
        <div className="min-w-0">
          <h3 className="l-form-label">Lanes</h3>
          {d.lanes && <MeterStack meters={lanes} dense baseDelay={0} />}
          <p className="l-caption">{d.lanesNote}</p>
          <h3 className="l-form-label mt-5">Machines</h3>
          {d.machines.length ? (
            <ul className="l-rows l-rows-ruled">
              {d.machines.map((m) => (
                <li key={m.machine} className="l-us-machine" title={m.title}>
                  <span className="min-w-0">
                    <span className="l-sym">{m.machine}</span>
                    <span className="l-sub-line">
                      {m.sourceLabel} · {m.age}
                    </span>
                  </span>
                  {m.stale && <Chip tone="warn">stale</Chip>}
                  <span className="l-num">{m.burn}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="l-body-text">No machine has reported this plan. Another machine can push to {v.push.path}.</p>
          )}
          <h3 className="l-form-label mt-5">Windows</h3>
          {windows.length ? <MeterStack meters={windows} dense baseDelay={0} /> : <p className="l-body-text">No provider reported an official window for this plan.</p>}
        </div>
      </div>
    </LDialog>
  );
}

function Ready({ v }: { v: UsageReadyView }) {
  const [open, setOpen] = useState<UsagePlan | null>(null);
  const plan = open ? (v.plans.find((p) => p.plan === open) ?? null) : null;
  const laneMax = Math.max(0, ...(v.lanes.rows ?? []).map((l) => l.burn));
  const modelMax = Math.max(0, ...v.models.rows.map((m) => m.burn));
  const series = v.burnChart.columns.map((c) => ({ label: c.long, count: c.total }));
  const lanes: Meter[] = (v.lanes.rows ?? []).map((l) => ({ label: l.label, frac: share(l.burn, laneMax), display: l.display }));
  const models: Meter[] = v.models.rows.slice(0, 6).map((m) => ({ label: m.label, frac: share(m.burn, modelMax), display: m.display }));
  const gauges: Meter[] = v.limits.gauges.map((g) => ({ label: `${g.label}${g.resets ? ` · ${g.resets}` : ''}`, frac: g.used / 100, display: `${Math.round(g.used)}%` }));
  const top = v.topBurner;
  return (
    <div className="l-stack">
      <div className="l-row l-row-hero">
        <SlabCard title="Token Burn" sub={v.burnChart.caption} i={1}>
          <div className="l-card-body pb-2">
            <BigStat display={v.hero.value} unit={`tokens burned, ${v.rangeLabel}`} size={30} />
          </div>
          {v.empty ? <LEmpty>No burn in this window.</LEmpty> : <StepLine series={series} format={fmtTokens} unit=" tokens" height={170} />}
          <p className="l-card-foot">{v.hero.status}</p>
        </SlabCard>
        <SlabCard title="Burn Volume" sub={v.rangeLabel} i={2} className="flex flex-col">
          <div className="l-card-body flex flex-1 flex-col">
            <BigStat display={v.hero.value} unit="tokens" chips={[{ tone: v.ollama.up ? 'ok' : 'err', text: v.ollama.up ? 'Ollama up' : 'Ollama down' }]} caption={v.hero.label} />
            <MeterStack meters={lanes} empty={v.lanes.note} foot={lanes.length ? v.lanes.note : undefined} />
          </div>
        </SlabCard>
      </div>

      <div className="l-row l-row-three">
        <SlabCard title="Burn by Model" sub={v.models.caption} i={3}>
          <div className="l-card-body">
            {models.length ? (
              <>
                <BigStat display={v.models.rows[0].display} size={30} caption={`${v.models.rows[0].label} leads`} />
                <MeterStack meters={models} dense />
              </>
            ) : (
              <>
                <BigStat display="-" size={30} caption="No model burn in this window." />
              </>
            )}
          </div>
        </SlabCard>
        <SlabCard title="Plan Limits" sub="official gauges only" i={4}>
          <div className="l-card-body">
            {gauges.length ? (
              <MeterStack meters={gauges} dense />
            ) : (
              <p className="l-body-text l-us-note">{v.limits.note} Burn is measured from transcripts, not against a guessed limit.</p>
            )}
          </div>
        </SlabCard>
        {top ? (
          <InsightCard
            badge={`Top burner · ${v.rangeLabel}`}
            icon={<Flame size={13} strokeWidth={1.7} aria-hidden />}
            display={top.share}
            headline={`${top.machine} on ${top.planLabel}`}
            body={`${top.value} tokens, ${top.caption}.`}
            frac={Number.parseFloat(top.share) / 100}
            i={5}
          />
        ) : (
          <InsightCard badge={`Top burner · ${v.rangeLabel}`} icon={<Flame size={13} strokeWidth={1.7} aria-hidden />} display="0%" headline="No burn in this window." frac={0} i={5} />
        )}
      </div>

      <div className="l-row l-row-three">
        {v.plans.map((p, i) => (
          <PlanCard key={p.plan} p={p} i={6 + i} onOpen={() => setOpen(p.plan)} />
        ))}
      </div>
      <p className="l-foot-note">
        {v.footnote} Read {v.readAgo}.
      </p>
      {plan && <PlanDialog p={plan} v={v} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function UsageLegacy({ initial, initialNow, sample }: { initial: UsagePayload; initialNow: number; sample: boolean }) {
  const { data, view, range, setRange, error, lastGoodAgo, retry } = useUsage(initial, initialNow, sample);
  const [raw, setRaw] = useState(false);
  const showSample = view.kind === 'ready' ? view.sample : view.kind === 'off' && view.filming;
  const right = (
    <>
      {showSample && (
        <span title={view.kind === 'off' ? 'Filming mode: Usage is off' : 'Sample data: lib/fo-sample.ts sampleUsageReadings'}>
          <LSampleChip />
        </span>
      )}
      {view.kind === 'ready' && (
        <div className="l-chip-row" role="radiogroup" aria-label="Range">
          {([7, 30] as const).map((r) => (
            <ToggleChip key={r} role="radio" aria-checked={range === r} on={range === r} onClick={() => setRange(r)}>
              {r} d
            </ToggleChip>
          ))}
        </div>
      )}
      {view.kind !== 'off' && (
        <Pressable tone="pill" onClick={() => setRaw(true)}>
          Raw reading
        </Pressable>
      )}
    </>
  );
  return (
    <div data-l="UsageLegacy" className="l-page">
      <SlabTitle eyebrow={EYEBROW} title={USAGE_TITLE} meta={META} right={right} />
      {error && view.kind !== 'off' && (
        <div className="l-card mb-5">
          <LError message={`Refresh failed (${error}).`} lastGood={lastGoodAgo ? <span className="l-body-text">Showing the reading from {lastGoodAgo}.</span> : undefined} onRetry={retry} />
        </div>
      )}
      {view.kind === 'off' ? (
        <SlabCard title={view.title} i={1}>
          <LEmpty>{view.body}</LEmpty>
        </SlabCard>
      ) : view.kind === 'unconfigured' ? (
        <div className="l-row l-row-hero">
          <SlabCard title="Token Burn" sub="nothing read yet" i={1}>
            <LUnconfigured what="A usage source" href={setupHrefFor('usage')} hint={view.setupHint} />
            <div className="l-card-body pt-0">
              <p className="l-lead">{view.title}</p>
              <p className="l-caption">{view.body}</p>
            </div>
          </SlabCard>
          <SlabCard title="Sources checked" sub="read locally" i={2}>
            <div className="l-card-body">
              <dl className="l-kv">
                {view.checks.map((c) => (
                  <div key={c.label}>
                    <dt>{c.label}</dt>
                    <dd className="inline-flex items-center gap-2">
                      <Dot state={c.ok ? 'ok' : 'off'} /> {c.value}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Ollama</dt>
                  <dd className="inline-flex items-center gap-2">
                    <Dot state={view.ollama.up ? 'ok' : 'err'} /> {view.ollama.text}
                  </dd>
                </div>
                <div>
                  <dt>Push URL</dt>
                  <dd>{view.push.path}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <CopyPushUrl path={view.push.path} />
              </div>
            </div>
          </SlabCard>
        </div>
      ) : (
        <Ready v={view} />
      )}
      {raw && (
        <LDialog title="Raw reading" sub="The /api/usage payload this page renders" onClose={() => setRaw(false)} width={760}>
          <pre data-l="Raw" className="l-raw">
            {JSON.stringify(data, null, 2)}
          </pre>
        </LDialog>
      )}
    </div>
  );
}
