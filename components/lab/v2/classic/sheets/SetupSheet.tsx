'use client';
/**
 * Setup sheet (01 19, 08.3), Classic tree: a section rail (Checklist, Keys, Sources, Schedule, Spend) and
 * section 08's rows, unchanged. Every write goes to 08's endpoints (setup/keys, setup/caps, setup/pause,
 * setup/health, setup/schedule, oauth) or v1's sources and suggestions routes. Nothing is computed here:
 * labels, states and money arrive from SetupView; only `fmtUsd` turns a dollar figure into text.
 */
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';
import { SetupLink } from '@/components/SetupLink';
import type { SetupSheetView } from '@/lib/lab/view/sheets/setup';
import type { SetupSection } from '@/lib/lab/view/shared';
import type { LabKeyRow } from '@/lib/lab/setup/keys';
import type { ScheduleJobRow } from '@/lib/lab/setup/schedule';
import { JOB_PRESETS, isPresetJob } from '@/lib/lab/setup/schedule';
import type { LabSourceRow, SpendView } from '@/lib/lab/setup/view';
import { fmtClock, fmtDayMonth, fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Tag } from '../parts';
import { Block, type SheetCommon } from './common';
import { r1 } from '../geom';

const S = C.setupSheet;
const H = C.schedule;
const PLATFORMS: { id: string; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'twitter', label: 'X' },
];

const keyTone = (s: LabKeyRow['state']): 'ok' | 'warn' | 'err' | 'quiet' | undefined =>
  s === 'connected' ? 'ok' : s === 'expiring' ? 'warn' : s === 'error' ? 'err' : s === 'dry' || s === 'checking' ? 'quiet' : undefined;

/* ── rail ─────────────────────────────────────────────────────────────────── */

function Rail({ rail, cur, onPick }: { rail: SetupSheetView['rail']; cur: SetupSection; onPick: (id: SetupSection) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + rail.length) % rail.length;
    onPick(rail[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div className="lab2c-itabs lab2c-setup-rail" role="tablist" aria-label={S.sectionSelect}>
      {rail.map((r, i) => (
        <button
          key={r.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          aria-selected={r.id === cur}
          tabIndex={r.id === cur ? 0 : -1}
          className="lab2c-itab"
          onClick={() => onPick(r.id)}
          onKeyDown={(e) => onKey(e, i)}
          data-lab-ink=""
        >
          {r.label}
          {r.badge && <span className="lab2c-badge">{r.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── checklist ────────────────────────────────────────────────────────────── */

function Checklist({ v }: { v: SetupSheetView }) {
  const c = v.setup.checklist;
  /** One shared detail (the sample line) is said once above the list, not on every step. */
  const shared = c.steps.length > 1 && c.steps.every((st) => !st.doneAt && st.detail === c.steps[0].detail) ? c.steps[0].detail : null;
  return (
    <Block title={v.setup.notes.checklistComplete ?? fill(S.checklistHead, { done: c.requiredDone, total: c.requiredTotal })}>
      {shared && <p className="lab2c-banner" data-lab-ink="">{shared}</p>}
      <ol className="lab2c-setup-steps">
        {c.steps.map((st) => (
          <li key={st.id} className="lab2c-setup-step" data-state={st.state}>
            <span className="lab2c-setup-mark" aria-hidden="true" data-lab-mark="" />
            <span className="lab2c-setup-main">
              <Link href={st.href} replace scroll={false} className="lab2c-rowlink lab2c-setup-title" data-lab-ink="">{st.title}</Link>
              {!shared && (
                <span className="lab2c-muted" data-lab-ink="">
                  {st.doneAt ? fill(S.doneOn, { date: fmtDayMonth(st.doneAt) }) : st.detail}
                </span>
              )}
            </span>
            {st.required && st.state === 'todo' && <Tag tone="quiet">{S.yourStep}</Tag>}
          </li>
        ))}
      </ol>
    </Block>
  );
}

/* ── keys ─────────────────────────────────────────────────────────────────── */

function KeyRow({ k, ro }: { k: LabKeyRow; ro: string | null }) {
  const { post, busy } = useLabPost();
  const [vals, setVals] = useState<Record<string, string>>({});
  const stateText = k.state === 'expiring' && k.detail ? k.detail : S.keyState[k.state] ?? k.state;
  return (
    <li className="lab2c-setup-row" id={`key-${k.id}`} data-state={k.state}>
      <div className="lab2c-setup-rowhead">
        <span className="lab2c-setup-title" data-lab-ink="">{k.title}</span>
        <span className="lab2c-setup-tools">
          <Tag tone={keyTone(k.state)}>{stateText}</Tag>
          {k.state === 'not_configured' && k.action.kind === 'paste' && <SetupLink href={`#key-${k.id}-${k.fields[0]?.env ?? ''}`} className="lab2-setup" />}
        </span>
      </div>
      {k.unlocks.length > 0 && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{k.unlocks.join(' ')}</p>}
      {k.detail && k.state !== 'expiring' && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{k.detail}</p>}
      {k.action.kind === 'paste' && k.fields.map((f) => (
        <form
          key={f.env}
          className="lab2c-setup-inline"
          onSubmit={(e) => { e.preventDefault(); const val = vals[f.env]?.trim(); if (val) void post('/api/lab/setup/keys', { env: f.env, value: val }, { key: f.env, okText: S.saved }).then((r) => { if (r.ok) setVals((x) => ({ ...x, [f.env]: '' })); }); }}
        >
          <label className="lab2c-field">
            <span className="lab2c-field-label" data-lab-ink="">{f.label}</span>
            <input
              id={`key-${k.id}-${f.env}`}
              className="lab2c-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={f.present ? f.masked : ''}
              disabled={!!ro}
              value={vals[f.env] ?? ''}
              onChange={(e) => setVals((x) => ({ ...x, [f.env]: e.target.value }))}
            />
          </label>
          <Btn type="submit" disabled={!!ro || !vals[f.env]?.trim()} busy={busy === f.env} title={ro ?? undefined}>{S.save}</Btn>
          {f.present && <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/setup/keys', { env: f.env }, { method: 'DELETE', okText: S.saved })}>{S.remove}</Btn>}
        </form>
      ))}
      <div className="lab2c-actrow">
        {(k.action.kind === 'connect' || k.action.kind === 'reconnect') && (
          <Btn
            primary
            disabled={!!ro}
            title={ro ?? undefined}
            onClick={async () => { const r = await post(`/api/lab/oauth/${k.id}/start`, {}, { refresh: false }); if (r.ok && typeof r.data.url === 'string') window.location.assign(r.data.url); }}
          >
            {k.action.label}
          </Btn>
        )}
        {k.action.kind === 'disconnect' && <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post(`/api/lab/oauth/${k.id}/disconnect`, {})}>{S.disconnect}</Btn>}
        {k.action.kind === 'manage_sources' && <Link href="?setup=sources" replace scroll={false} className="lab2c-btn" data-lab-ink="">{S.manageSources}</Link>}
        {k.state === 'error' && <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/setup/health', { id: k.id })}>{S.checkAgain}</Btn>}
      </div>
    </li>
  );
}

/* ── sources ──────────────────────────────────────────────────────────────── */

function SourceList({ label, rows, kind, ro }: { label: string; rows: LabSourceRow[]; kind: 'owned' | 'tracked' | 'suggested' | 'watch'; ro: string | null }) {
  const { post } = useLabPost();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <Block title={<>{label} <span className="lab2c-fchip-n">{rows.length}</span></>}>
      {rows.length === 0 ? null : (
        <ul className="lab2c-setup-list">
          {shown.map((r) => (
            <li key={r.id} className="lab2c-setup-src">
              <span className="lab2c-setup-main">
                <span className="lab2c-setup-title" data-lab-ink="">{r.displayName || `@${r.handle}`}</span>
                <span className="lab2c-muted" data-lab-ink="">
                  {[`@${r.handle}`, PLATFORMS.find((p) => p.id === r.platform)?.label ?? r.platform, kind === 'suggested' ? r.reason : `${r.posts} ${S.posts}`, kind !== 'suggested' && r.breakouts ? `${r.breakouts} ${S.breakouts}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="lab2c-setup-tools">
                {kind === 'suggested' ? (
                  <>
                    <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/suggestions', { id: r.id, action: 'accept' }, { okText: S.saved })}>{S.track}</Btn>
                    <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/suggestions', { id: r.id, action: 'dismiss' })}>{S.ignore}</Btn>
                  </>
                ) : (
                  <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/sources', { action: 'remove', id: r.id })}>{S.removeSource}</Btn>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 12 && (
        <button type="button" className="lab2c-setup-toggle" onClick={() => setAll((x) => !x)} data-lab-ink="">{all ? H.hide : `${H.show} ${rows.length - 12}`}</button>
      )}
    </Block>
  );
}

function Sources({ v, ro }: { v: SetupSheetView; ro: string | null }) {
  const { post, busy } = useLabPost();
  const s = v.setup.sources;
  const [handle, setHandle] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [kind, setKind] = useState<'owned' | 'tracked' | 'watch'>('tracked');
  const submit = async () => {
    const h = handle.trim();
    if (!h) return;
    const r = await post('/api/lab/sources', { kind, handle: h, platform: kind === 'watch' ? 'x' : platform }, { key: 'add', okText: S.saved });
    if (r.ok) setHandle('');
  };
  return (
    <>
      {v.setup.notes.ownedHeader && <p className="lab2c-banner" data-lab-ink="">{v.setup.notes.ownedHeader}</p>}
      <Block>
        <form className="lab2c-setup-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <select className="lab2c-input lab2c-select" value={kind} aria-label={S.platform} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={!!ro}>
            <option value="tracked">{S.tracked}</option>
            <option value="owned">{S.owned}</option>
            <option value="watch">{S.watch}</option>
          </select>
          {kind !== 'watch' && (
            <select className="lab2c-input lab2c-select" value={platform} aria-label={S.platform} onChange={(e) => setPlatform(e.target.value)} disabled={!!ro}>
              {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <input
            className="lab2c-input"
            autoFocus={v.focusAdd}
            value={handle}
            placeholder={S.addPlaceholder}
            aria-label={S.addPlaceholder}
            disabled={!!ro}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Btn type="submit" primary disabled={!!ro || !handle.trim()} busy={busy === 'add'} title={ro ?? undefined}>{S.add}</Btn>
        </form>
      </Block>
      <SourceList label={S.owned} rows={s.owned} kind="owned" ro={ro} />
      <SourceList label={S.tracked} rows={s.tracked} kind="tracked" ro={ro} />
      {s.suggested.length > 0 && <SourceList label={S.suggested} rows={s.suggested} kind="suggested" ro={ro} />}
      <SourceList label={S.watch} rows={s.watch} kind="watch" ro={ro} />
      <Block title={S.radarSources}>
        <ul className="lab2c-setup-list">
          {s.radarSources.map((r) => (
            <li key={r.id} className="lab2c-setup-src">
              <span className="lab2c-setup-main">
                <span className="lab2c-setup-title" data-lab-ink="">{r.id}</span>
                {r.lastOkAt && <span className="lab2c-muted" data-lab-ink="">{fmtDayMonth(r.lastOkAt)}</span>}
              </span>
              <label className="lab2c-switch">
                <input type="checkbox" checked={r.enabled} disabled={!!ro} onChange={() => void post('/api/lab/radar', { action: r.enabled ? 'disable' : 'enable', source: r.id })} />
                <span className="lab2c-switch-track" aria-hidden="true" data-lab-mark="" />
                <span className="lab2c-muted" data-lab-ink="">{r.enabled ? S.on : S.off}</span>
              </label>
            </li>
          ))}
        </ul>
      </Block>
      {s.feeds.length > 0 && (
        <Block title={S.feeds}>
          <ul className="lab2c-setup-list">
            {s.feeds.map((f) => (
              <li key={f.id} className="lab2c-setup-src">
                <span className="lab2c-setup-title" data-lab-ink="">{f.label}</span>
                <Tag tone={f.enabled ? 'ok' : 'quiet'}>{f.enabled ? S.on : S.off}</Tag>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  );
}

/* ── schedule ─────────────────────────────────────────────────────────────── */

function JobRow({ j, ro, dry }: { j: ScheduleJobRow; ro: string | null; dry: boolean }) {
  const { post, busy } = useLabPost();
  const presets = isPresetJob(j.id) ? JOB_PRESETS[j.id] : [];
  const save = (patch: Record<string, unknown>) => post('/api/lab/setup/schedule', { job: j.id, config: { ...j.config, ...patch } }, { key: `cfg-${j.id}`, okText: S.saved });
  const m = j.cost.month;
  return (
    <li className="lab2c-setup-row" data-state={j.state}>
      <div className="lab2c-setup-rowhead">
        <span className="lab2c-setup-main">
          <span className="lab2c-setup-title" data-lab-ink="">{j.label}</span>
          <span className="lab2c-muted" data-lab-ink="">{j.what}</span>
        </span>
        <span className="lab2c-setup-tools">
          {j.state !== 'sample' && j.state !== 'client' && <Tag tone={j.state === 'on' ? 'ok' : j.state === 'blocked' || j.state === 'needs' ? 'warn' : 'quiet'}>{j.stateText}</Tag>}
        </span>
      </div>
      <div className="lab2c-setup-facts">
        {j.cost.perRun !== null && <span data-lab-ink="">{fill(H.perRun, { usd: fmtUsd(j.cost.perRun) })}</span>}
        {m && <span data-lab-ink="">{fill(H.month, { point: fmtUsd(m.point), low: fmtUsd(m.low), high: fmtUsd(m.high) })}</span>}
        {j.next.length > 0 && <span data-lab-ink="">{fill(H.next, { list: j.next.map((t, i) => (i > 0 && fmtDayMonth(t) === fmtDayMonth(j.next[i - 1]) ? fmtClock(t) : `${fmtDayMonth(t)} ${fmtClock(t)}`)).join(', ') })}</span>}
      </div>
      {j.skippedReason && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{j.skippedReason}</p>}
      {j.editable && (
        <div className="lab2c-actrow">
          {presets.length > 0 && (
            <select
              className="lab2c-input lab2c-select lab2c-setup-preset"
              aria-label={`${j.label}: ${H.howOften}`}
              value={j.activePreset ?? 'custom'}
              disabled={!!ro}
              onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) void save({ mode: 'default', everyMin: undefined, times: undefined, weekdays: undefined, ...p.config }); }}
            >
              {j.activePreset === null && <option value="custom">{H.custom}</option>}
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <label className="lab2c-switch">
            <input type="checkbox" checked={!j.config.paused} disabled={!!ro} onChange={() => void save({ paused: !j.config.paused })} />
            <span className="lab2c-switch-track" aria-hidden="true" data-lab-mark="" />
            <span className="lab2c-muted" data-lab-ink="">{H.on}</span>
          </label>
          <Btn
            disabled={!!ro || dry}
            title={ro ?? (dry ? H.runNowDry : undefined)}
            busy={busy === `run-${j.id}`}
            onClick={() => void post('/api/lab/setup/schedule', { job: j.id, action: 'run_now' }, { key: `run-${j.id}` })}
          >
            {H.runNow}
          </Btn>
        </div>
      )}
    </li>
  );
}

function Schedule({ v, ro }: { v: SetupSheetView; ro: string | null }) {
  const { post } = useLabPost();
  const s = v.setup.schedule;
  const [showFree, setShowFree] = useState(false);
  const paid = s.jobs.filter((j) => j.paid);
  const free = s.jobs.filter((j) => !j.paid);
  const pausedAll = s.paused.scope === 'all';
  /** 'sample' and 'client' say the same line on every row: shown once here instead. */
  const sampleText = s.jobs.find((j) => j.state === 'sample' || j.state === 'client')?.stateText ?? null;
  return (
    <>
      <Block
        title={s.label}
        aside={
          <Btn disabled={!!ro || pausedAll} title={ro ?? (pausedAll ? v.pausedBanner ?? undefined : undefined)} onClick={() => void post('/api/lab/setup/pause', { paused: !s.paused.by })}>
            {s.paused.by ? H.resumeLab : H.pauseLab}
          </Btn>
        }
      >
        {s.agentLabel && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{s.heartbeat.detail}</p>}
        {!s.installed && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{s.privateInstance ? H.notInstalled : H.client}</p>}
        {sampleText && <p className="lab2c-banner" data-lab-ink="">{sampleText}</p>}
      </Block>
      <Block>
        <ul className="lab2c-setup-list">{paid.map((j) => <JobRow key={j.id} j={j} ro={ro} dry={v.setup.mode.dry} />)}</ul>
      </Block>
      {free.length > 0 && (
        <Block
          title={H.freeJobs}
          aside={<button type="button" className="lab2c-setup-toggle" aria-expanded={showFree} onClick={() => setShowFree((x) => !x)} data-lab-ink="">{showFree ? H.hide : `${H.show} ${free.length}`}</button>}
        >
          {showFree && <ul className="lab2c-setup-list">{free.map((j) => <JobRow key={j.id} j={j} ro={ro} dry={v.setup.mode.dry} />)}</ul>}
        </Block>
      )}
    </>
  );
}

/* ── spend ────────────────────────────────────────────────────────────────── */

function Meter({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const f = Math.max(0, Math.min(1, pct));
  return (
    <span className="lab2c-setup-meter" data-tone={pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok'} aria-hidden="true">
      <span style={{ width: `${r1(f * 100)}%` }} data-lab-mark="" />
    </span>
  );
}

function money(spent: number, cap: number | null) {
  return cap !== null ? fill(S.of, { spent: fmtUsd(spent), cap: fmtUsd(cap) }) : fill(S.noCap, { spent: fmtUsd(spent) });
}

function Provider({ p, ro }: { p: SpendView['providers'][number]; ro: string | null }) {
  const { post, busy } = useLabPost();
  const [cap, setCap] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <li className="lab2c-setup-row" data-enabled={p.enabled ? '' : undefined}>
      <div className="lab2c-setup-rowhead">
        <span className="lab2c-setup-title" data-lab-ink="">{p.label}</span>
        <span className="lab2c-setup-num" data-lab-ink="">{money(p.spent + p.reserved, p.cap)}</span>
      </div>
      <Meter pct={p.pct} />
      {p.offReason && <p className="lab2c-muted lab2c-setup-p" data-lab-ink="">{p.offReason}</p>}
      {p.capWarning && <p className="lab2c-banner" data-tone="warn" data-lab-ink="">{p.capWarning}</p>}
      <div className="lab2c-actrow">
        <form className="lab2c-setup-inline lab2c-setup-cap" onSubmit={(e) => { e.preventDefault(); const u = Number(cap); if (cap.trim() && Number.isFinite(u)) void post('/api/lab/setup/caps', { target: p.provider, usd: u }, { key: `cap-${p.provider}`, okText: S.saved }).then((r) => { if (r.ok) setCap(''); }); }}>
          <label className="lab2c-field">
            <span className="lab2c-field-label" data-lab-ink="">{S.cap}</span>
            <input className="lab2c-input" inputMode="decimal" placeholder={p.cap !== null ? String(p.cap) : ''} value={cap} disabled={!!ro} onChange={(e) => setCap(e.target.value)} />
          </label>
          <Btn type="submit" disabled={!!ro || !cap.trim()} busy={busy === `cap-${p.provider}`} title={ro ?? undefined}>{S.saveCap}</Btn>
        </form>
        {p.lines.length > 0 && (
          <button type="button" className="lab2c-setup-toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-lab-ink="">{open ? H.hide : `${H.show} ${p.lines.length}`}</button>
        )}
      </div>
      {open && (
        <ul className="lab2c-setup-lines">
          {p.lines.map((l) => (
            <li key={l.line} className="lab2c-setup-line">
              <span className="lab2c-setup-main">
                <span data-lab-ink="">{l.label}</span>
                <span className="lab2c-muted" data-lab-ink="">{l.offReason ?? l.priceNote}</span>
              </span>
              <span className="lab2c-setup-num" data-lab-ink="">{money(l.spent + l.reserved, l.cap)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Spend({ v, ro }: { v: SetupSheetView; ro: string | null }) {
  const s = v.setup.spend;
  const [all, setAll] = useState(false);
  const runs = all ? s.runs : s.runs.slice(0, 12);
  return (
    <>
      <Block title={S.month} aside={<span className="lab2c-setup-total" data-lab-ink="">{fmtUsd(s.monthTotal)}</span>}>
        {s.blocked && <p className="lab2c-banner" data-tone="warn" data-lab-ink="">{s.blocked.message}</p>}
        <ul className="lab2c-setup-list">{s.providers.map((p) => <Provider key={p.provider} p={p} ro={ro} />)}</ul>
      </Block>
      <Block title={S.runs}>
        <div className="lab2c-table-wrap">
          <table className="lab2c-table lab2c-setup-runs">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td data-lab-ink="">{fmtDayMonth(r.at)} {fmtClock(r.at)}</td>
                  <td data-lab-ink="">{r.line ?? r.kind}</td>
                  <td data-lab-ink="">{r.status}</td>
                  <td className="lab2c-setup-num" data-lab-ink="">{r.costUsd !== null ? fmtUsd(r.costUsd) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.runs.length > 12 && <button type="button" className="lab2c-setup-toggle" onClick={() => setAll((x) => !x)} data-lab-ink="">{all ? H.hide : `${H.show} ${s.runs.length - 12}`}</button>}
      </Block>
    </>
  );
}

/* ── sheet ────────────────────────────────────────────────────────────────── */

export function SetupSheet({ view: v, readOnly }: { view: SetupSheetView } & SheetCommon & { onClose?: () => void }) {
  const [cur, setCur] = useState<SetupSection>(v.section);
  const ro = readOnly ?? (v.setup.mode.readOnly ? v.setup.mode.dryLabel : null);
  const pick = (id: SetupSection) => {
    setCur(id);
    const u = new URL(window.location.href);
    u.searchParams.set('setup', id);
    u.searchParams.delete('focus');
    window.history.replaceState(window.history.state, '', u);
  };
  return (
    <div className="lab2c-sheetbody lab2c-setup">
      <Rail rail={v.rail} cur={cur} onPick={pick} />
      {v.pausedBanner && <p className="lab2c-banner" data-lab-ink="">{v.pausedBanner}</p>}
      {v.setup.notes.brainInDry && <p className="lab2c-banner" data-lab-ink="">{v.setup.notes.brainInDry}</p>}
      <div role="tabpanel" className="lab2c-setup-panel">
        {cur === 'checklist' && <Checklist v={v} />}
        {cur === 'keys' && (
          <Block>
            <ul className="lab2c-setup-list">{v.setup.keys.map((k) => <KeyRow key={k.id} k={k} ro={ro} />)}</ul>
          </Block>
        )}
        {cur === 'sources' && <Sources v={v} ro={ro} />}
        {cur === 'schedule' && <Schedule v={v} ro={ro} />}
        {cur === 'spend' && <Spend v={v} ro={ro} />}
      </div>
    </div>
  );
}
