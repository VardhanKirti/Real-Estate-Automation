'use client';
/**
 * Setup sheet (01 19, 08.3) under Bennett Legacy: a section rail of FO chips (Checklist, Keys, Sources,
 * Schedule, Spend) and section 08's rows, unchanged. Every write goes to 08's endpoints (setup/keys,
 * setup/caps, setup/pause, setup/health, setup/schedule, oauth) or v1's sources and suggestions routes,
 * exactly as the Classic sheet does. Spend lines are the hatched FO meters; switches are the FO knob.
 */
import Link from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';
import { LSwitch, VolumeMeter } from '@/components/legacy';
import type { SetupSheetView } from '@/lib/lab/view/sheets/setup';
import type { SetupSection } from '@/lib/lab/view/shared';
import type { LabKeyRow } from '@/lib/lab/setup/keys';
import type { ScheduleJobRow } from '@/lib/lab/setup/schedule';
import { JOB_PRESETS, isPresetJob } from '@/lib/lab/setup/schedule';
import type { LabSourceRow, SpendView } from '@/lib/lab/setup/view';
import { fmtClock, fmtDayMonth, fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Field } from '../dialogs';
import { Btn, LabSetupLink, Tag, cx } from '../parts';
import { Block, type SheetCommon } from './common';

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
  s === 'connected' ? 'ok' : s === 'expiring' ? 'warn' : s === 'error' || s === 'not_configured' ? 'err' : s === 'dry' || s === 'checking' ? 'quiet' : undefined;

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
    <div data-l="LabTabs" className="l-lab-itabs" role="tablist" aria-label={S.sectionSelect}>
      {rail.map((r, i) => (
        <button
          key={r.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          aria-selected={r.id === cur}
          tabIndex={r.id === cur ? 0 : -1}
          data-l="ToggleChip"
          data-lens="c"
          data-on={r.id === cur ? 'true' : 'false'}
          className={cx('l-pressable l-toggle-chip l-lab-fchip', r.id !== cur && 'is-dark')}
          onClick={() => onPick(r.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {r.label}
          {r.badge && <span className="l-lab-chip-n">{r.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── checklist ────────────────────────────────────────────────────────────── */

function Checklist({ v }: { v: SetupSheetView }) {
  const c = v.setup.checklist;
  const shared = c.steps.length > 1 && c.steps.every((st) => !st.doneAt && st.detail === c.steps[0].detail) ? c.steps[0].detail : null;
  return (
    <Block title={v.setup.notes.checklistComplete ?? fill(S.checklistHead, { done: c.requiredDone, total: c.requiredTotal })}>
      {shared && <p className="l-lab-banner">{shared}</p>}
      <ol className="l-lab-steps">
        {c.steps.map((st) => (
          <li key={st.id} className="l-lab-step" data-state={st.state}>
            <span className="l-lab-step-mark" aria-hidden="true" />
            <span className="l-lab-step-main">
              <Link href={st.href} replace scroll={false} className="l-lab-step-title">{st.title}</Link>
              {!shared && <span className="l-muted">{st.doneAt ? fill(S.doneOn, { date: fmtDayMonth(st.doneAt) }) : st.detail}</span>}
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
    <li className="l-lab-setrow" id={`key-${k.id}`} data-state={k.state}>
      <div className="l-lab-setrow-head">
        <span className="l-lab-setrow-title">{k.title}</span>
        <span className="l-chip-row">
          <Tag tone={keyTone(k.state)}>{stateText}</Tag>
          {k.state === 'not_configured' && k.action.kind === 'paste' && <LabSetupLink href={`#key-${k.id}-${k.fields[0]?.env ?? ''}`} />}
        </span>
      </div>
      {k.unlocks.length > 0 && <p className="l-body-text">{k.unlocks.join(' ')}</p>}
      {k.detail && k.state !== 'expiring' && <p className="l-body-text">{k.detail}</p>}
      {k.action.kind === 'paste' && k.fields.map((f) => (
        <form
          key={f.env}
          className="l-lab-inline"
          onSubmit={(e) => { e.preventDefault(); const val = vals[f.env]?.trim(); if (val) void post('/api/lab/setup/keys', { env: f.env, value: val }, { key: f.env, okText: S.saved }).then((r) => { if (r.ok) setVals((x) => ({ ...x, [f.env]: '' })); }); }}
        >
          <Field label={f.label}>
            <input
              id={`key-${k.id}-${f.env}`}
              className="l-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={f.present ? f.masked : ''}
              disabled={!!ro}
              value={vals[f.env] ?? ''}
              onChange={(e) => setVals((x) => ({ ...x, [f.env]: e.target.value }))}
            />
          </Field>
          <Btn type="submit" disabled={!!ro || !vals[f.env]?.trim()} busy={busy === f.env} title={ro ?? undefined}>{S.save}</Btn>
          {f.present && <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post('/api/lab/setup/keys', { env: f.env }, { method: 'DELETE', okText: S.saved })}>{S.remove}</Btn>}
        </form>
      ))}
      <div className="l-lab-actrow">
        {(k.action.kind === 'connect' || k.action.kind === 'reconnect') && (
          <Btn primary disabled={!!ro} title={ro ?? undefined} onClick={async () => { const r = await post(`/api/lab/oauth/${k.id}/start`, {}, { refresh: false }); if (r.ok && typeof r.data.url === 'string') window.location.assign(r.data.url); }}>
            {k.action.label}
          </Btn>
        )}
        {k.action.kind === 'disconnect' && <Btn disabled={!!ro} title={ro ?? undefined} onClick={() => void post(`/api/lab/oauth/${k.id}/disconnect`, {})}>{S.disconnect}</Btn>}
        {k.action.kind === 'manage_sources' && <Btn href="?setup=sources" replace>{S.manageSources}</Btn>}
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
    <Block title={label} aside={<span className="l-lab-chip-n">{rows.length}</span>}>
      {rows.length > 0 && (
        <ul className="l-lab-rows">
          {shown.map((r) => (
            <li key={r.id} className="l-lab-src">
              <span className="l-lab-src-main">
                <span className="l-lab-setrow-title">{r.displayName || `@${r.handle}`}</span>
                <span className="l-muted">
                  {[`@${r.handle}`, PLATFORMS.find((p) => p.id === r.platform)?.label ?? r.platform, kind === 'suggested' ? r.reason : `${r.posts} ${S.posts}`, kind !== 'suggested' && r.breakouts ? `${r.breakouts} ${S.breakouts}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="l-lab-actrow">
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
      {rows.length > 12 && <Btn onClick={() => setAll((x) => !x)}>{all ? H.hide : `${H.show} ${rows.length - 12}`}</Btn>}
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
      {v.setup.notes.ownedHeader && <p className="l-lab-banner">{v.setup.notes.ownedHeader}</p>}
      <form className="l-lab-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <select className="l-select" value={kind} aria-label={S.platform} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={!!ro}>
          <option value="tracked">{S.tracked}</option>
          <option value="owned">{S.owned}</option>
          <option value="watch">{S.watch}</option>
        </select>
        {kind !== 'watch' && (
          <select className="l-select" value={platform} aria-label={S.platform} onChange={(e) => setPlatform(e.target.value)} disabled={!!ro}>
            {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <input className="l-input" autoFocus={v.focusAdd} value={handle} placeholder={S.addPlaceholder} aria-label={S.addPlaceholder} disabled={!!ro} onChange={(e) => setHandle(e.target.value)} />
        <Btn type="submit" primary disabled={!!ro || !handle.trim()} busy={busy === 'add'} title={ro ?? undefined}>{S.add}</Btn>
      </form>
      <SourceList label={S.owned} rows={s.owned} kind="owned" ro={ro} />
      <SourceList label={S.tracked} rows={s.tracked} kind="tracked" ro={ro} />
      {s.suggested.length > 0 && <SourceList label={S.suggested} rows={s.suggested} kind="suggested" ro={ro} />}
      <SourceList label={S.watch} rows={s.watch} kind="watch" ro={ro} />
      <Block title={S.radarSources}>
        <ul className="l-lab-rows">
          {s.radarSources.map((r) => (
            <li key={r.id} className="l-lab-src">
              <span className="l-lab-src-main">
                <span className="l-lab-setrow-title">{r.id}</span>
                {r.lastOkAt && <span className="l-muted">{fmtDayMonth(r.lastOkAt)}</span>}
              </span>
              <span className="l-lab-switch">
                <LSwitch on={r.enabled} label={`${r.id}: ${r.enabled ? S.on : S.off}`} disabled={!!ro} onToggle={() => void post('/api/lab/radar', { action: r.enabled ? 'disable' : 'enable', source: r.id })} />
                <span className="l-muted">{r.enabled ? S.on : S.off}</span>
              </span>
            </li>
          ))}
        </ul>
      </Block>
      {s.feeds.length > 0 && (
        <Block title={S.feeds}>
          <ul className="l-lab-rows">
            {s.feeds.map((f) => (
              <li key={f.id} className="l-lab-src">
                <span className="l-lab-setrow-title">{f.label}</span>
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
    <li className="l-lab-setrow" data-state={j.state}>
      <div className="l-lab-setrow-head">
        <span className="l-lab-src-main">
          <span className="l-lab-setrow-title">{j.label}</span>
          <span className="l-muted">{j.what}</span>
        </span>
        {j.state !== 'sample' && j.state !== 'client' && <Tag tone={j.state === 'on' ? 'ok' : j.state === 'blocked' || j.state === 'needs' ? 'warn' : 'quiet'}>{j.stateText}</Tag>}
      </div>
      <div className="l-lab-facts">
        {j.cost.perRun !== null && <span>{fill(H.perRun, { usd: fmtUsd(j.cost.perRun) })}</span>}
        {m && <span>{fill(H.month, { point: fmtUsd(m.point), low: fmtUsd(m.low), high: fmtUsd(m.high) })}</span>}
        {j.next.length > 0 && <span>{fill(H.next, { list: j.next.map((t, i) => (i > 0 && fmtDayMonth(t) === fmtDayMonth(j.next[i - 1]) ? fmtClock(t) : `${fmtDayMonth(t)} ${fmtClock(t)}`)).join(', ') })}</span>}
      </div>
      {j.skippedReason && <p className="l-body-text">{j.skippedReason}</p>}
      {j.editable && (
        <div className="l-lab-actrow">
          {presets.length > 0 && (
            <select
              className="l-select l-lab-preset"
              aria-label={`${j.label}: ${H.howOften}`}
              value={j.activePreset ?? 'custom'}
              disabled={!!ro}
              onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) void save({ mode: 'default', everyMin: undefined, times: undefined, weekdays: undefined, ...p.config }); }}
            >
              {j.activePreset === null && <option value="custom">{H.custom}</option>}
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <span className="l-lab-switch">
            <LSwitch on={!j.config.paused} label={`${j.label}: ${H.on}`} disabled={!!ro} onToggle={() => void save({ paused: !j.config.paused })} />
            <span className="l-muted">{H.on}</span>
          </span>
          <Btn disabled={!!ro || dry} title={ro ?? (dry ? H.runNowDry : undefined)} busy={busy === `run-${j.id}`} onClick={() => void post('/api/lab/setup/schedule', { job: j.id, action: 'run_now' }, { key: `run-${j.id}` })}>
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
        {s.agentLabel && <p className="l-body-text">{s.heartbeat.detail}</p>}
        {!s.installed && <p className="l-body-text">{s.privateInstance ? H.notInstalled : H.client}</p>}
        {sampleText && <p className="l-lab-banner">{sampleText}</p>}
      </Block>
      <ul className="l-lab-rows l-lab-setrows">{paid.map((j) => <JobRow key={j.id} j={j} ro={ro} dry={v.setup.mode.dry} />)}</ul>
      {free.length > 0 && (
        <Block title={H.freeJobs} aside={<Btn aria-expanded={showFree} onClick={() => setShowFree((x) => !x)}>{showFree ? H.hide : `${H.show} ${free.length}`}</Btn>}>
          {showFree && <ul className="l-lab-rows l-lab-setrows">{free.map((j) => <JobRow key={j.id} j={j} ro={ro} dry={v.setup.mode.dry} />)}</ul>}
        </Block>
      )}
    </>
  );
}

/* ── spend ────────────────────────────────────────────────────────────────── */

function money(spent: number, cap: number | null) {
  return cap !== null ? fill(S.of, { spent: fmtUsd(spent), cap: fmtUsd(cap) }) : fill(S.noCap, { spent: fmtUsd(spent) });
}

const hueOf = (pct: number | null) => (pct === null ? undefined : pct >= 1 ? 'var(--l-err)' : pct >= 0.8 ? 'var(--l-warn)' : 'var(--l-text)');

function Provider({ p, ro }: { p: SpendView['providers'][number]; ro: string | null }) {
  const { post, busy } = useLabPost();
  const [cap, setCap] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <li className="l-lab-setrow" data-enabled={p.enabled ? '' : undefined}>
      {p.pct !== null ? (
        <VolumeMeter label={p.label} frac={Math.max(0, Math.min(1, p.pct))} display={money(p.spent + p.reserved, p.cap)} hue={hueOf(p.pct)} compact />
      ) : (
        <div className="l-lab-setrow-head">
          <span className="l-lab-setrow-title">{p.label}</span>
          <span className="l-num">{money(p.spent + p.reserved, p.cap)}</span>
        </div>
      )}
      {p.offReason && <p className="l-body-text">{p.offReason}</p>}
      {p.capWarning && <p className="l-lab-banner" data-tone="warn">{p.capWarning}</p>}
      <div className="l-lab-actrow">
        <form className="l-lab-inline" onSubmit={(e) => { e.preventDefault(); const u = Number(cap); if (cap.trim() && Number.isFinite(u)) void post('/api/lab/setup/caps', { target: p.provider, usd: u }, { key: `cap-${p.provider}`, okText: S.saved }).then((r) => { if (r.ok) setCap(''); }); }}>
          <Field label={S.cap}>
            <input className="l-input" inputMode="decimal" placeholder={p.cap !== null ? String(p.cap) : ''} value={cap} disabled={!!ro} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Btn type="submit" disabled={!!ro || !cap.trim()} busy={busy === `cap-${p.provider}`} title={ro ?? undefined}>{S.saveCap}</Btn>
        </form>
        {p.lines.length > 0 && <Btn aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? H.hide : `${H.show} ${p.lines.length}`}</Btn>}
      </div>
      {open && (
        <ul className="l-lab-rows">
          {p.lines.map((l) => (
            <li key={l.line} className="l-lab-src">
              <span className="l-lab-src-main">
                <span>{l.label}</span>
                <span className="l-muted">{l.offReason ?? l.priceNote}</span>
              </span>
              <span className="l-num">{money(l.spent + l.reserved, l.cap)}</span>
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
      <Block title={S.month} aside={<span className="l-lab-total">{fmtUsd(s.monthTotal)}</span>}>
        {s.blocked && <p className="l-lab-banner" data-tone="warn">{s.blocked.message}</p>}
        <ul className="l-lab-rows l-lab-setrows">{s.providers.map((p) => <Provider key={p.provider} p={p} ro={ro} />)}</ul>
      </Block>
      <Block title={S.runs}>
        <div className="l-lab-table-wrap">
          <table className="l-lab-table">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDayMonth(r.at)} {fmtClock(r.at)}</td>
                  <td>{r.line ?? r.kind}</td>
                  <td>{r.status}</td>
                  <td className="is-num">{r.costUsd !== null ? fmtUsd(r.costUsd) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.runs.length > 12 && <Btn onClick={() => setAll((x) => !x)}>{all ? H.hide : `${H.show} ${s.runs.length - 12}`}</Btn>}
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
    <div data-l="LabSetupSheet" className="l-lab-sheetbody">
      <Rail rail={v.rail} cur={cur} onPick={pick} />
      {v.pausedBanner && <p className="l-lab-banner">{v.pausedBanner}</p>}
      {v.setup.notes.brainInDry && <p className="l-lab-banner">{v.setup.notes.brainInDry}</p>}
      <div role="tabpanel" className="l-lab-setpanel">
        {cur === 'checklist' && <Checklist v={v} />}
        {cur === 'keys' && <ul className="l-lab-rows l-lab-setrows">{v.setup.keys.map((k) => <KeyRow key={k.id} k={k} ro={ro} />)}</ul>}
        {cur === 'sources' && <Sources v={v} ro={ro} />}
        {cur === 'schedule' && <Schedule v={v} ro={ro} />}
        {cur === 'spend' && <Spend v={v} ro={ro} />}
      </div>
    </div>
  );
}
