'use client';
/**
 * Setup sections, GladOS tree (01 19, 08.2 to 08.6): Checklist, Keys, Sources (with 09's plan panel),
 * Spend. Section 08 owns every row's data, state and copy; these render it and post only to 08's routes.
 * A key value is never shown: inputs are empty with a "Saved" placeholder and the row shows 08's mask.
 */
import { useEffect, useRef, useState } from 'react';
import { GButton, GDialog, GInput, GSelect, GToggle } from '@/components/g';
import { CapViz } from '@/components/lab/v2/shared';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import type { ChecklistView } from '@/lib/lab/setup/checklist';
import type { LabKeyRow } from '@/lib/lab/setup/keys';
import type { SetupView, SourcesSetupView, SpendView } from '@/lib/lab/setup/view';

import { fmtAge, fmtUsd } from '@/lib/lab/view/format';
import type { SourceRow } from '@/lib/lab/view/shared';
import { PlanPanel } from './PlanPanel';
import { LabSetupLink } from '../bits';
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

const KEY_STATE: Record<LabKeyRow['state'], string> = {
  not_configured: 'Not configured',
  needs_connect: 'Not connected',
  checking: 'Checking',
  connected: 'Connected',
  expiring: 'Expiring',
  error: 'Error',
  dry: 'Dry: not checked',
};
const HEALTH_ID: Record<string, string> = { apify: 'apify.auth', openai: 'openai.auth', youtube: 'youtube.token', instagram: 'instagram.token', producthunt: 'producthunt.auth', github: 'github.auth' };
const PLATFORM: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X', x: 'X' };

export function ChecklistSection({ c, notes, readOnly }: { c: ChecklistView; notes: SetupView['notes']; readOnly: string | null }) {
  // One line every open step repeats (the sample note) is said once above the list, not on every row.
  const open = c.steps.filter((s) => s.state !== 'done');
  const sharedDetail = open.length > 1 && open[0].detail && open.every((s) => s.detail === open[0].detail) ? open[0].detail : null;
  return (
    <div className="lab2g-setup-sec">
      <p className="lab2g-setup-lead" data-lab-ink="">{fill(LAB_UI.checklistDone, { done: String(c.requiredDone), total: String(c.requiredTotal) })}</p>
      {c.complete && notes.checklistComplete && <p className="lab2g-text" data-lab-ink="">{notes.checklistComplete}</p>}
      {readOnly && <p className="lab2g-muted" data-lab-ink="">{readOnly}</p>}
      {sharedDetail && <p className="lab2g-muted" data-lab-ink="">{sharedDetail}</p>}
      <ol className="lab2g-steps">
        {c.steps.map((s) => (
          <li key={s.id} className="lab2g-step" data-state={s.state}>
            <span className="lab2g-step-mark" aria-hidden="true">
              {s.state === 'done' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-lab-mark=""><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              ) : null}
            </span>
            <span className="lab2g-step-main">
              <span className="lab2g-step-title" data-lab-ink="">
                {s.title}
                {s.required && s.state === 'todo' && <span className="lab2-chip lab2g-yourstep">{LAB_UI.yourStep}</span>}
              </span>
              {(s.state === 'done' && s.doneAt) || (s.detail && !sharedDetail) ? (
                <span className="lab2g-muted" data-lab-ink="">{s.state === 'done' && s.doneAt ? fill(LAB_UI.doneOn, { d: fmtLabDay(s.doneAt) }) : s.detail}</span>
              ) : null}
            </span>
            {s.state !== 'done' && s.href && (
              <a data-g="LabLink" href={s.href} className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.openWord}</a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function KeyRowView({ row, readOnly, filming }: { row: LabKeyRow; readOnly: string | null; filming: boolean }) {
  const { post, busy } = useLabPost();
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [igPaste, setIgPaste] = useState(false);
  const lock = readOnly ?? (filming ? LAB_UI.filmingKeys : null);
  const operator = row.fields.filter((f) => f.writtenBy === 'operator');
  const provider = row.id === 'youtube' || row.id === 'instagram' ? row.id : null;
  const save = async (env: string) => {
    setErr(null);
    const r = await post('/api/lab/setup/keys', { env, value: values[env] ?? '' }, { key: `save-${env}`, inline: [400] });
    if (r.status === 400) setErr(fill(LAB_UI.valueRejected, { error: String(r.data.error ?? '') }));
    if (r.ok) setValues((v) => ({ ...v, [env]: '' }));
  };
  const connect = async () => {
    if (!provider) return;
    const r = await post(`/api/lab/oauth/${provider}/start`, null, { key: 'connect', refresh: false, inline: [409] });
    if (r.status === 409) setErr(LAB_UI.connectDry);
    if (r.ok && typeof r.data.url === 'string') window.location.assign(r.data.url);
  };
  return (
    <li className="lab2g-key" id={`lab-key-${row.id}`} data-state={row.state}>
      <div className="lab2g-key-head">
        <span className="lab2g-job-titles">
          <span className="lab2g-job-label" data-lab-ink="">{row.title}</span>
          {row.unlocks.map((u) => <span key={u} className="lab2g-muted" data-lab-ink="">{u}</span>)}
        </span>
        <span className="lab2-chip lab2g-keystate" data-state={row.state}><span data-lab-ink="">{KEY_STATE[row.state]}</span></span>
      </div>
      {row.detail && <p className="lab2g-muted" data-lab-ink="">{row.detail}</p>}
      {row.state === 'not_configured' && <LabSetupLink href={`#lab-key-${row.id}-in`} label={LAB_UI.setUp} className="lab2-setup" />}
      {(row.action.kind === 'paste' || igPaste) &&
        operator.map((f) => (
          <div key={f.env} className="lab2g-keyfield">
            <label className="lab2g-fieldlabel" htmlFor={`lab-key-${row.id}-in`} data-lab-ink="">{`${f.label}${f.present ? ` (${f.masked})` : ''}`}</label>
            <span className="lab2g-keyinput">
              <GInput
                id={`lab-key-${row.id}-in`}
                type="password"
                autoComplete="off"
                placeholder={f.present ? LAB_UI.savedPlaceholder : ''}
                value={values[f.env] ?? ''}
                disabled={!!lock}
                title={lock ?? undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.env]: e.target.value }))}
              />
              <GButton size="sm" variant="ink" disabled={!!lock || !(values[f.env] ?? '').trim()} disabledReason={lock ?? undefined} busy={busy === `save-${f.env}`} onClick={() => save(f.env)}>
                {LAB_UI.save}
              </GButton>
              {f.present && (
                <GButton size="sm" disabled={!!lock} disabledReason={lock ?? undefined} onClick={() => post('/api/lab/setup/keys', { env: f.env }, { method: 'DELETE', key: `rm-${f.env}` })}>
                  {LAB_UI.remove}
                </GButton>
              )}
            </span>
          </div>
        ))}
      <span className="lab2g-row-tools">
        {(row.action.kind === 'connect' || row.action.kind === 'reconnect') && (
          <GButton size="sm" variant="ink" disabled={!!lock} disabledReason={lock ?? undefined} busy={busy === 'connect'} onClick={connect}>
            {row.action.label}
          </GButton>
        )}
        {row.action.kind === 'disconnect' && (
          <GButton size="sm" disabled={!!lock} disabledReason={lock ?? undefined} onClick={() => setConfirm(true)}>
            {row.action.label}
          </GButton>
        )}
        {row.id === 'instagram' && row.action.kind !== 'paste' && !igPaste && (
          <GButton size="sm" disabled={!!lock} onClick={() => setIgPaste(true)}>{LAB_UI.pasteToken}</GButton>
        )}
        {row.state === 'error' && HEALTH_ID[row.id] && (
          <GButton size="sm" onClick={() => post('/api/lab/setup/health', { id: HEALTH_ID[row.id] }, { key: `health-${row.id}` })}>{LAB_UI.checkAgain}</GButton>
        )}
        {row.action.kind === 'manage_sources' && (
          <a data-g="LabLink" href="?setup=sources" className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.manageSources}</a>
        )}
      </span>
      {err && <p className="lab2g-dialog-warn" role="alert">{err}</p>}
      <GDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={row.action.label}
        confirmLabel={row.action.label}
        cancelLabel={LAB_UI.cancel}
        tone="danger"
        onConfirm={async () => {
          await post(`/api/lab/oauth/${provider}/disconnect`, null, { key: 'disc' });
          setConfirm(false);
        }}
      >
        <p>{fill(LAB_UI.disconnectConfirm, { title: row.title })}</p>
      </GDialog>
    </li>
  );
}

export function KeysSection({ keys, readOnly, filming }: { keys: LabKeyRow[]; readOnly: string | null; filming: boolean }) {
  return (
    <ul className="lab2g-keys">
      {keys.map((k) => <KeyRowView key={k.id} row={k} readOnly={readOnly} filming={filming} />)}
    </ul>
  );
}

function SourceList({ title, rows, readOnly, kind }: { title: string; rows: SourceRow[]; readOnly: string | null; kind: 'owned' | 'tracked' | 'suggested' | 'watch' }) {
  const { post } = useLabPost();
  if (!rows.length && kind === 'suggested') return null;
  return (
    <section className="lab2g-srclist" aria-label={title}>
      <h3 className="lab2g-plan-title" data-lab-ink="">{`${title} (${rows.length})`}</h3>
      {rows.length === 0 && kind === 'owned' && <p className="lab2g-muted" data-lab-ink="">{LAB_UI.addAccounts}</p>}
      <ul className="lab2g-rows lab2g-rows-flat">
        {rows.map((r) => (
          <li key={r.id} className="lab2g-row lab2g-row-static lab2g-srcrow" data-status={r.status}>
            <span className="lab2g-row-main" data-lab-ink="">{`@${r.handle}`}</span>
            <span className="lab2g-row-meta" data-lab-ink="">{[PLATFORM[r.platform] ?? r.platform, `${r.posts} ${LAB_UI.postsWord}`, r.status !== 'active' ? r.status : null].filter(Boolean).join(' · ')}</span>
            {kind === 'suggested' ? (
              <span className="lab2g-row-tools">
                <GButton size="sm" variant="ink" disabled={!!readOnly} disabledReason={readOnly ?? undefined} onClick={() => post('/api/lab/suggestions', { id: r.id, action: 'accept' }, { key: `acc-${r.id}` })}>{LAB_UI.track}</GButton>
                <GButton size="sm" disabled={!!readOnly} disabledReason={readOnly ?? undefined} onClick={() => post('/api/lab/suggestions', { id: r.id, action: 'dismiss' }, { key: `dis-${r.id}` })}>{LAB_UI.dismiss}</GButton>
              </span>
            ) : (
              <span className="lab2g-row-tools">
                <GButton size="sm" disabled={!!readOnly} disabledReason={readOnly ?? undefined} onClick={() => post('/api/lab/sources', { id: r.id, action: r.status === 'paused' ? 'resume' : 'pause' }, { key: `p-${r.id}` })}>
                  {r.status === 'paused' ? LAB_UI.resume : LAB_UI.pause}
                </GButton>
                <GButton size="sm" disabled={!!readOnly} disabledReason={readOnly ?? undefined} onClick={() => post('/api/lab/sources', { id: r.id, action: 'remove' }, { key: `rm-${r.id}` })}>
                  {LAB_UI.remove}
                </GButton>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SourcesSection({ setup, focusAdd, readOnly, sample }: { setup: SetupView; focusAdd: boolean; readOnly: string | null; sample: boolean }) {
  const s: SourcesSetupView = setup.sources;
  const [handle, setHandle] = useState('');
  const [kind, setKind] = useState<'owned' | 'tracked' | 'watch'>('tracked');
  const [platform, setPlatform] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { post, busy } = useLabPost();
  useEffect(() => {
    if (focusAdd) input.current?.focus();
  }, [focusAdd]);
  const add = async () => {
    const r = await post('/api/lab/sources', { kind, handle: handle.trim(), ...(kind === 'watch' ? { platform: 'x' } : platform ? { platform } : {}) }, { key: 'add', okText: kind === 'owned' ? LAB_UI.addedOwned : LAB_UI.nowTracking });
    if (r.ok) setHandle('');
  };
  return (
    <div className="lab2g-setup-sec">
      <form
        className="lab2g-addsrc"
        onSubmit={(e) => {
          e.preventDefault();
          if (handle.trim() && !readOnly) void add();
        }}
      >
        <GInput ref={input} aria-label={LAB_UI.handle} placeholder={LAB_UI.handle} value={handle} onChange={(e) => setHandle(e.target.value)} disabled={!!readOnly} title={readOnly ?? undefined} />
        <GSelect aria-label={LAB_UI.kindLabel} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} options={[{ value: 'tracked', label: LAB_UI.tracked }, { value: 'owned', label: LAB_UI.owned }, { value: 'watch', label: LAB_UI.watch }]} />
        {kind !== 'watch' && (
          <GSelect aria-label={LAB_UI.platform} value={platform} onChange={(e) => setPlatform(e.target.value)} options={[{ value: '', label: LAB_UI.fromUrl }, ...['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'].map((p) => ({ value: p, label: PLATFORM[p] }))]} />
        )}
        <GButton type="submit" variant="ink" disabled={!!readOnly || !handle.trim()} disabledReason={readOnly ?? undefined} busy={busy === 'add'}>
          {LAB_UI.add}
        </GButton>
      </form>
      {setup.notes.ownedHeader && <p className="lab2g-muted" data-lab-ink="">{setup.notes.ownedHeader}</p>}
      <SourceList title={LAB_UI.owned} rows={s.owned} readOnly={readOnly} kind="owned" />
      <SourceList title={LAB_UI.tracked} rows={s.tracked} readOnly={readOnly} kind="tracked" />
      <PlanPanel planner={setup.planner} gates={setup.gates} record={setup.forecastRecord} sample={sample} />
      <SourceList title={LAB_UI.suggested} rows={s.suggested} readOnly={readOnly} kind="suggested" />
      <SourceList title={LAB_UI.watch} rows={s.watch} readOnly={readOnly} kind="watch" />
      <section className="lab2g-srclist" aria-label={LAB_UI.radarSources}>
        <h3 className="lab2g-plan-title" data-lab-ink="">{LAB_UI.radarSources}</h3>
        <ul className="lab2g-rows lab2g-rows-flat">
          {s.radarSources.map((r) => (
            <li key={r.id} className="lab2g-row lab2g-row-static">
              <span className="lab2g-row-main" data-lab-ink="">{r.id}</span>
              <span className="lab2g-row-meta" data-lab-ink="">{r.lastOkAt ? fill(LAB_UI.okAgo, { age: fmtAge((Date.now() - Date.parse(r.lastOkAt)) / 3_600_000) }) : r.state}</span>
              <GToggle
                checked={r.enabled}
                disabled={!!readOnly}
                disabledReason={readOnly ?? undefined}
                aria-label={r.id}
                onCheckedChange={(on) => post('/api/lab/radar', { action: on ? 'enable' : 'disable', source: r.id }, { key: `rs-${r.id}` })}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SpendSection({ spend, readOnly }: { spend: SpendView; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [edit, setEdit] = useState<string | null>(null);
  const [usd, setUsd] = useState('');
  const saveCap = async (target: string) => {
    const r = await post('/api/lab/setup/caps', { target, usd: Number(usd) }, { key: `cap-${target}` });
    if (r.ok) setEdit(null);
  };
  const capEditor = (target: string, cap: number | null) =>
    edit === target ? (
      <span className="lab2g-keyinput">
        <GInput type="number" min={0} max={1000} step={0.01} aria-label={`${LAB_UI.capEditor} ${target}`} value={usd} onChange={(e) => setUsd(e.target.value)} />
        <GButton size="sm" variant="ink" busy={busy === `cap-${target}`} disabled={!!readOnly || usd === ''} disabledReason={readOnly ?? undefined} onClick={() => saveCap(target)}>{LAB_UI.saveCap}</GButton>
        <GButton size="sm" onClick={() => setEdit(null)}>{LAB_UI.cancel}</GButton>
      </span>
    ) : (
      <button data-g="LabButton"
        type="button"
        className="lab2-pill lab2-seeall"
        aria-disabled={readOnly ? true : undefined}
        onClick={() => {
          if (readOnly) return;
          setEdit(target);
          setUsd(cap === null ? '' : String(cap));
        }}
      >
        <span data-lab-ink="">{LAB_UI.capEditor}</span>
      </button>
    );
  return (
    <div className="lab2g-setup-sec">
      <p className="lab2g-setup-lead" data-lab-ink="">{fill(LAB_UI.monthTotal, { usd: fmtUsd(spend.monthTotal) })}</p>
      {spend.blocked && (
        <div className="lab2g-banner-line lab2g-draft">
          <span data-lab-ink="">{spend.blocked.message}</span>
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={readOnly ? true : undefined} onClick={() => !readOnly && post('/api/lab/run', { override: true }, { key: 'pass', capRetry: false })}>
            <span data-lab-ink="">{LAB_UI.runPassCap}</span>
          </button>
        </div>
      )}
      {spend.providers.map((p) => (
        <section key={p.provider} className="lab2g-provider" aria-label={p.label}>
          <div className="lab2g-key-head">
            <span className="lab2g-job-label" data-lab-ink="">{p.label}</span>
            <span className="lab2g-muted" data-lab-ink="">{p.provider === 'llm' ? LAB_UI.llmFree : p.cap === null ? fmtUsd(p.spent) : fill(LAB_UI.ofCap, { spent: fmtUsd(p.spent), cap: fmtUsd(p.cap) })}</span>
          </div>
          {p.cap !== null && p.provider !== 'llm' && <CapViz spent={p.spent} cap={Math.max(p.cap, 0.01)} w={480} h={14} />}
          {p.offReason && <p className="lab2g-muted" data-lab-ink="">{p.offReason}</p>}
          {p.capWarning && <p className="lab2g-dialog-warn" data-lab-ink="">{p.capWarning}</p>}
          {p.provider !== 'llm' && capEditor(p.provider, p.cap)}
          <ul className="lab2g-rows lab2g-rows-flat">
            {p.lines.map((l) => (
              <li key={l.line} className="lab2g-row lab2g-row-static lab2g-line">
                <span className="lab2g-row-main" data-lab-ink="">{l.label}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{l.offReason ?? (l.cap === null ? fmtUsd(l.spent) : fill(LAB_UI.ofCap, { spent: fmtUsd(l.spent), cap: fmtUsd(l.cap) }))}</span>
                {l.cap !== null && !l.offReason && <CapViz spent={l.spent} cap={Math.max(l.cap, 0.01)} w={120} h={14} />}
                {l.priceNote && <span className="lab2g-muted lab2g-line-note" data-lab-ink="">{l.priceNote}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="lab2g-srclist" aria-label={LAB_UI.runLogTitle}>
        <h3 className="lab2g-plan-title" data-lab-ink="">{LAB_UI.runLogTitle}</h3>
        <ul className="lab2g-rows lab2g-rows-flat">
          {spend.runs.slice(0, 50).map((r) => (
            <li key={r.id} className="lab2g-row lab2g-row-static" data-status={r.status}>
              <span className="lab2g-row-main" data-lab-ink="">{[r.kind, r.actor].filter(Boolean).join(' · ')}</span>
              <span className="lab2g-row-meta" data-lab-ink="">
                {[fmtLabDay(r.at), r.items !== null ? `${r.items} ${LAB_UI.itemsWord}` : null, r.costUsd !== null ? fmtUsd(r.costUsd) : null, r.actualSource, r.status, r.error].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
