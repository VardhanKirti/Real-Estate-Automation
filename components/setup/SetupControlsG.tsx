'use client';

import { Clapperboard, KeyRound, Lock, LogOut, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { GButton, GInput, GTag } from '@/components/g';
import { useManualCheck } from '@/components/SetupManualCheck';
import { useKeySave } from '@/components/SetupKeyInput';
import { useFilmingToggle } from '@/components/SetupFilming';
import { usePasswordForm } from '@/components/SetupSecurity';

/**
 * The /setup controls under the GladOS style (SPEC S05 F05.93, F05.94, §3.2):
 * the same hooks and endpoints as the Classic controls, drawn from the kit.
 */

export function ManualCheckG({ id, marked, title }: { id: string; marked: boolean; title: string }) {
  const { busy, toggle } = useManualCheck(id, marked);
  return (
    <GButton variant="sm" onClick={toggle} busy={busy} aria-label={marked ? `Undo done: ${title}` : `Mark done: ${title}`}>
      {marked ? 'Undo done' : 'Mark done'}
    </GButton>
  );
}

export function KeyInputG({ envVar, present, masked }: { envVar: string; present: boolean; masked: string }) {
  const { value, setValue, state, setState, error, save } = useKeySave(envVar, present);
  return (
    <div className="kg-keyinput">
      {state === 'saved' ? (
        <>
          <GTag tone="ok" dot>
            Set{masked ? ` · ${masked}` : ''}
          </GTag>
          <GButton variant="sm" onClick={() => setState('idle')}>
            Replace
          </GButton>
        </>
      ) : (
        <>
          <GInput
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={envVar}
            aria-label={`Value for ${envVar}`}
            className="kg-keyinput-field"
          />
          <GButton variant="ink" size="sm" onClick={save} busy={state === 'saving'} disabled={!value.trim()} disabledReason="Paste a value first">
            Save
          </GButton>
        </>
      )}
      {error && <span className="kg-err-line">{error}</span>}
    </div>
  );
}

export function FilmingG({ filming, pinned, dataDir }: { filming: boolean; pinned: boolean; dataDir: string }) {
  const { busy, error, toggle } = useFilmingToggle(filming);
  return (
    <div className="kg-setting">
      <div className="kg-setting-head">
        <Clapperboard size={16} strokeWidth={1.7} aria-hidden="true" />
        <span className="kg-setting-title">Filming mode</span>
        <GTag tone={filming ? 'warn' : 'neutral'} dot>
          {filming ? 'On' : 'Off'}
        </GTag>
      </div>
      <p className="kg-body">
        {filming
          ? 'Reading the sample dataset. Nothing on screen is real, and nothing written here reaches your live stores.'
          : 'Reading your real data. Turn this on before you record anything.'}
      </p>
      <p className="kg-mono" data-mono-ok="" data-setup-datadir="" title="The directory every store reads">
        {dataDir}
      </p>
      {error ? <p className="kg-err-line">{error}</p> : null}
      <div className="kg-setting-actions">
        <GButton variant="sm" onClick={toggle} busy={busy} disabled={pinned} disabledReason="Pinned by GLADOS_DATA_DIR on this host">
          {pinned ? <Lock size={12} strokeWidth={1.8} aria-hidden="true" /> : null}
          {filming ? 'Switch to real data' : 'Switch to sample data'}
        </GButton>
        {pinned && <span className="kg-cap">Pinned by GLADOS_DATA_DIR on this host</span>}
      </div>
    </div>
  );
}

export function SecurityG({ configured }: { configured: boolean }) {
  const { mode, current, setCurrent, next, setNext, confirm, setConfirm, busy, error, notice, open, close, submit, spec } = usePasswordForm();
  const submitOff = Boolean((spec?.needsCurrent && !current) || (spec?.needsNew && (!next || !confirm)));
  return (
    <div id="security" className="kg-setting scroll-mt-24">
      <div className="kg-setting-head">
        {configured ? <ShieldCheck size={16} strokeWidth={1.7} aria-hidden="true" /> : <ShieldOff size={16} strokeWidth={1.7} aria-hidden="true" />}
        <span className="kg-setting-title">Operator password</span>
        <GTag tone={configured ? 'ok' : 'warn'} dot>
          {configured ? 'Password set' : 'Not configured'}
        </GTag>
      </div>
      <p className="kg-body">
        {configured
          ? 'Every page and API route asks for this password. It is stored as a scrypt hash in .env.local on this host and is never in git. Forgot it: delete the GLADOS_PASSWORD_HASH line from .env.local, restart, and set a new one here.'
          : 'No password yet, so the console answers only on this machine: the server refuses to listen on any other address until one exists. Set a password to sign in from other devices on your network.'}
      </p>
      {notice && (
        <GTag tone="ok" dot>
          {notice}
        </GTag>
      )}
      {mode === 'idle' && (
        <div className="kg-setting-actions">
          {configured ? (
            <>
              <GButton variant="sm" onClick={() => open('change')}>
                <KeyRound size={12} strokeWidth={1.8} aria-hidden="true" /> Change
              </GButton>
              <GButton variant="sm" onClick={() => open('rotate')}>
                <LogOut size={12} strokeWidth={1.8} aria-hidden="true" /> Sign out others
              </GButton>
              <GButton variant="sm" onClick={() => open('remove')}>
                <Trash2 size={12} strokeWidth={1.8} aria-hidden="true" /> Remove
              </GButton>
            </>
          ) : (
            <GButton variant="ink" size="sm" onClick={() => open('set')}>
              Set password
            </GButton>
          )}
        </div>
      )}
      {spec && (
        <form onSubmit={submit} className="kg-form">
          <div className="kg-setting-title">{spec.title}</div>
          {spec.needsCurrent && (
            <GInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" aria-label="Current password" autoComplete="current-password" autoFocus />
          )}
          {spec.needsNew && (
            <>
              <GInput type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" autoComplete="new-password" autoFocus={!spec.needsCurrent} />
              <GInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" aria-label="Repeat new password" autoComplete="new-password" />
            </>
          )}
          {mode === 'remove' && <p className="kg-cap">Removing it signs this device out and puts the OS back to loopback-only until a new password is set.</p>}
          {error && <p className="kg-err-line">{error}</p>}
          <div className="kg-setting-actions">
            <GButton type="submit" variant={mode === 'remove' ? 'danger' : 'ink'} size="sm" busy={busy} disabled={submitOff} disabledReason="Fill in every field first">
              {spec.button}
            </GButton>
            <GButton variant="sm" onClick={close}>
              Cancel
            </GButton>
          </div>
        </form>
      )}
    </div>
  );
}
