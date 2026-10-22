'use client';

import { useState } from 'react';
import { ChevronLeft, Hammer, KeyRound, UserRound } from 'lucide-react';
import { GButton, GCard, GEmpty, GErrorLine, GHeroCard, GInput, GPage, GRuler, GSectionHeader, GTag } from '@/components/g';
import { openWizard } from '@/lib/wizard-dock';
import type { SetupStep } from '@/lib/agent-setup';
import { AgentFace } from './AgentFace';

/**
 * /agents/setup/[id] under the GladOS style (glados-ui SPEC S04 §4.2). One
 * hero counts only the steps this host can verify (an env key present);
 * external and build steps are the operator's or owed and never count as
 * done (F-B2, AC04.12). Steps are kit cards; the key field posts to
 * /api/keys exactly like the Classic SetupKeyInput.
 */
export type SetupView = {
  agent: { id: string; name: string; role: string; status: string; model: string };
  avatar: string | null;
  blurb: string;
  steps: SetupStep[] | null;
  keys: Record<string, { present: boolean; masked: string }>;
};

function KeyField({ envVar, present, masked, onSaved }: { envVar: string; present: boolean; masked: string; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(present ? 'saved' : 'idle');
  const [error, setError] = useState('');
  const save = async () => {
    if (!value.trim()) return;
    setState('saving');
    setError('');
    try {
      const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ envVar, value: value.trim() }) });
      if (r.ok) {
        setState('saved');
        setValue('');
        onSaved();
      } else {
        setState('error');
        setError((await r.json().catch(() => ({}))).error?.toString?.() ?? 'Save failed');
      }
    } catch (e) {
      setState('error');
      setError(String(e));
    }
  };
  if (state === 'saved') {
    return (
      <div className="wg-key">
        <GTag tone="ok" dot>
          Saved{masked ? ` · ${masked}` : ''}
        </GTag>
        <GButton variant="sm" onClick={() => setState('idle')}>
          Replace
        </GButton>
      </div>
    );
  }
  return (
    <form
      className="wg-key"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <GInput type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={envVar} aria-label={envVar} autoComplete="off" className="wg-key-in" />
      <GButton type="submit" variant="ink" busy={state === 'saving'} disabled={!value.trim()} disabledReason="Paste the key first">
        Save
      </GButton>
      {error && <GErrorLine align="left">{error}</GErrorLine>}
    </form>
  );
}

export function SetupG({ view }: { view: SetupView }) {
  const [saved, setSaved] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.entries(view.keys).map(([k, v]) => [k, v.present])));
  const steps = view.steps && view.steps.length > 0 ? view.steps : null;
  const envSteps = (steps ?? []).filter((s): s is Extract<SetupStep, { kind: 'env' }> => s.kind === 'env');
  const done = envSteps.filter((s) => saved[s.envVar]).length;
  const next = steps?.find((s) => (s.kind === 'env' ? !saved[s.envVar] : true)) ?? null;

  return (
    <GPage className="wg-page">
      <div>
        <GButton variant="sm" href="/agents">
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden /> Agents
        </GButton>
      </div>
      <div className="wg-setup-head">
        <AgentFace src={view.avatar} name={view.agent.name} size={56} />
        <GSectionHeader size="page" title={`${view.agent.name} · Setup`} caption={view.blurb} />
      </div>

      {!steps ? (
        <GEmpty
          title="No setup guide yet"
          body="Describe what it should do in a Wizard session and the guide gets built with it."
          action={{ label: 'Ask the Wizard', onClick: () => openWizard({ text: `Write a setup guide for the ${view.agent.name} agent`, source: 'agent-setup' }) }}
        />
      ) : (
        <div className="wg-setup">
          <GHeroCard
            variant="a"
            size="sm"
            caption="Setup progress"
            value={envSteps.length > 0 ? `${done}/${envSteps.length}` : null}
            label={`${done} of ${envSteps.length} verifiable steps done`}
            status={
              envSteps.length > 0
                ? `${done} of ${envSteps.length} verifiable steps done${next ? ` · next: ${next.label}` : ''}`
                : 'No step here can be checked from this host'
            }
            title="Only key steps can be verified on this host (the key is present). External and build steps are never counted as done."
            strip={envSteps.length > 0 ? <GRuler label={`${done} of ${envSteps.length} verifiable steps done`} value={done} max={envSteps.length} onHero /> : undefined}
          />
          <div className="wg-setup-steps">
            <ol className="wg-step-list">
              {steps.map((step, i) => {
                const present = step.kind === 'env' ? Boolean(saved[step.envVar]) : false;
                return (
                  <li key={i}>
                    <GCard p={20} className="wg-step">
                      <div className="wg-step-head">
                        <span className="wg-step-num">{i + 1}</span>
                        <span className="wg-step-icon" aria-hidden>
                          {step.kind === 'env' ? <KeyRound size={15} strokeWidth={1.6} /> : step.kind === 'build' ? <Hammer size={15} strokeWidth={1.6} /> : <UserRound size={15} strokeWidth={1.6} />}
                        </span>
                        <span className="wg-step-label">{step.label}</span>
                        {step.kind === 'env' ? (
                          present ? (
                            <GTag tone="ok" dot>
                              Saved
                            </GTag>
                          ) : (
                            <GTag tone="accent">Key needed</GTag>
                          )
                        ) : step.kind === 'build' ? (
                          <GTag tone="warn">Build owed</GTag>
                        ) : (
                          <GTag tone="outline">Yours to do</GTag>
                        )}
                      </div>
                      {step.kind === 'env' ? (
                        <div className="wg-step-body">
                          {step.hint && <p className="wg-cap">{step.hint}</p>}
                          <KeyField
                            envVar={step.envVar}
                            present={view.keys[step.envVar]?.present ?? false}
                            masked={view.keys[step.envVar]?.masked ?? ''}
                            onSaved={() => setSaved((s) => ({ ...s, [step.envVar]: true }))}
                          />
                        </div>
                      ) : (
                        <div className="wg-step-body">
                          <p className="wg-step-detail">{step.detail}</p>
                          {'href' in step && step.href && (
                            <GButton variant="sm" href={step.href} external>
                              Open
                            </GButton>
                          )}
                        </div>
                      )}
                    </GCard>
                  </li>
                );
              })}
            </ol>
            <p className="wg-cap">Keys land in .env.local on this host and take effect immediately. The agent turns active once its wiring is proven, not when boxes are ticked.</p>
          </div>
        </div>
      )}
    </GPage>
  );
}
