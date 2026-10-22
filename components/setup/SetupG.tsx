'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, CircleDashed, ExternalLink, UserRound } from 'lucide-react';
import { GButton, GCard, GHeroCard, GRuler, GSectionHeader, GTag } from '@/components/g';
import { KeyInputG, ManualCheckG } from './SetupControlsG';
import type { SystemPhase, SystemSetup, SystemStep } from '@/lib/system-setup';

/**
 * /setup under the GladOS style (SPEC S05 F05.90 to F05.95). Same data and
 * functions as the Classic tree; the order is Appearance, Bring-up, Recording
 * and Security, then the phases. Done steps collapse into one row per phase.
 */

export type KeyState = { present: boolean; masked: string };

const OPEN_KEY = 'glados-setup-done-open';

/** First open step's element id, for the hero's scroll target. */
const stepId = (id: string) => `setup-step-${id}`;

/** Bring-up hero (F05.92): one number, its split, and a jump to the first open step. */
export function BringUpHero({ totals, firstOpen }: { totals: SystemSetup['totals']; firstOpen: string | null }) {
  const done = totals.verified + totals.marked;
  const pct = totals.total > 0 ? Math.round((done / totals.total) * 100) : 0;
  const allDone = totals.open === 0;
  const jump = () => {
    if (!firstOpen) return;
    const el = document.getElementById(stepId(firstOpen));
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    const target = el.querySelector<HTMLElement>('input, button, a');
    target?.focus({ preventScroll: true });
  };
  return (
    <GHeroCard
      variant="a"
      caption="Bring-up"
      value={`${pct}%`}
      label={`Bring-up ${pct} percent: ${done} of ${totals.total} steps done`}
      title="Steps verified by a live probe or marked done by you, out of every bring-up step (lib/system-setup)"
      status={
        allDone
          ? `All ${totals.total} steps done`
          : `${done} of ${totals.total} done · ${totals.verified} verified · ${totals.marked} marked · ${totals.open} open`
      }
      strip={<GRuler value={done} max={Math.max(1, totals.total)} onHero label={`${done} of ${totals.total} steps`} />}
      onClick={allDone ? undefined : jump}
      size="sm"
      className="kg-setup-hero"
    />
  );
}

function StepIcon({ status }: { status: SystemStep['status'] }) {
  if (status === 'open') return <CircleDashed size={16} strokeWidth={1.7} className="kg-step-icon" data-status="open" aria-label="Open" />;
  return <CheckCircle2 size={16} strokeWidth={1.7} className="kg-step-icon" data-status={status} aria-label={status === 'verified' ? 'Verified' : 'Marked done'} />;
}

function StepRow({ step, keys }: { step: SystemStep; keys: Record<string, KeyState> }) {
  const key = step.envVar ? keys[step.envVar] : undefined;
  return (
    <li className="kg-step" id={stepId(step.id)} data-status={step.status}>
      <StepIcon status={step.status} />
      <div className="kg-step-body">
        <div className="kg-step-head">
          <span className="kg-step-title">{step.title}</span>
          {step.auto ? (
            <GTag size="xs" tone={step.status === 'verified' ? 'ok' : 'neutral'}>
              {step.status === 'verified' ? 'Auto-verified' : 'Auto-checks'}
            </GTag>
          ) : (
            <GTag size="xs" tone="outline">
              <UserRound size={10} strokeWidth={1.8} aria-hidden="true" /> Yours to confirm
            </GTag>
          )}
          <span className="kg-step-actions">
            {!step.auto && <ManualCheckG id={step.id} marked={step.status === 'marked'} title={step.title} />}
            {step.href && (
              <GButton variant="sm" href={step.href} aria-label={`Open ${step.title}`}>
                Open <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
              </GButton>
            )}
          </span>
        </div>
        <p className="kg-step-detail">{step.detail}</p>
        {step.envVar && step.status === 'open' && (
          <div className="kg-step-key">
            <KeyInputG envVar={step.envVar} present={key?.present ?? false} masked={key?.masked ?? ''} />
          </div>
        )}
      </div>
    </li>
  );
}

function readOpen(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** One phase (F05.94): header with count, open steps as rows, done steps behind one disclosure. */
export function PhaseCard({ phase, keys }: { phase: SystemPhase; keys: Record<string, KeyState> }) {
  const open = phase.steps.filter((s) => s.status === 'open');
  const done = phase.steps.filter((s) => s.status !== 'open');
  const [expanded, setExpanded] = useState(false);
  // Stays expanded for the session once opened (S05 §6), restored after mount.
  useEffect(() => {
    if (readOpen().includes(String(phase.n))) setExpanded(true);
  }, [phase.n]);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      const set = new Set(readOpen());
      if (next) set.add(String(phase.n));
      else set.delete(String(phase.n));
      sessionStorage.setItem(OPEN_KEY, JSON.stringify([...set]));
    } catch {
      /* storage blocked: the disclosure still works for this view */
    }
  };
  const panelId = `setup-done-${phase.n}`;
  return (
    <GCard as="section" p={24} aria-labelledby={`setup-phase-${phase.n}`} className="kg-phase">
      <GSectionHeader
        size={22}
        id={`setup-phase-${phase.n}`}
        title={`Phase ${phase.n} · ${phase.title}`}
        caption={phase.blurb}
        action={
          <GTag tone={open.length === 0 ? 'ok' : 'neutral'} title={`${done.length} of ${phase.steps.length} steps done`}>
            {done.length}/{phase.steps.length}
          </GTag>
        }
      />
      {open.length > 0 && (
        <ul className="kg-steps">
          {open.map((s) => (
            <StepRow key={s.id} step={s} keys={keys} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div className="kg-done">
          <GButton variant="sm" aria-expanded={expanded} aria-controls={panelId} onClick={toggle} className="kg-done-toggle">
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" className="kg-chev" data-open={expanded || undefined} />
            {done.length} done
          </GButton>
          {expanded && (
            <ul className="kg-steps" id={panelId}>
              {done.map((s) => (
                <StepRow key={s.id} step={s} keys={keys} />
              ))}
            </ul>
          )}
        </div>
      )}
    </GCard>
  );
}

/** Titled settings card (Recording, Security). */
export function SettingCard({ title, caption, children }: { title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <GCard as="section" p={24} className="kg-setting-card" aria-label={title}>
      <GSectionHeader size={22} title={title} caption={caption} />
      <div className="kg-setting-wrap">{children}</div>
    </GCard>
  );
}

export { stepId };
