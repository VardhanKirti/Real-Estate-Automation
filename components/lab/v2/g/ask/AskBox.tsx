'use client';
/**
 * Ask the Lab, GladOS tree (07 7.12, 01 7.8 and 20): the input with example and recent questions (Today's
 * Ask panel), the deterministic answer line with its filter chips, and the evidence cards. Submitting
 * pushes `?ask=` (the Ask sheet). Recent questions live only in this browser (`lab.ask.recent`).
 */
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { GButton, GInput } from '@/components/g';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

import type { AskView } from '@/lib/lab/gen/view';
import type { SectionState } from '@/lib/lab/view/shared';
import { PostCard } from '../PostCard';
import { Panel, SectionNote } from '../bits';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

const RECENT_KEY = 'lab.ask.recent';

export function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberAsk(q: string): void {
  try {
    const next = [q, ...readRecent().filter((x) => x !== q)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* per-viewer convenience only */
  }
}

export function submitAsk(q: string): void {
  const t = q.trim().slice(0, 300);
  if (!t) return;
  rememberAsk(t);
  const u = new URL(window.location.href);
  u.searchParams.set('ask', t);
  openSheetHref(`?${u.searchParams.toString()}`, { title: LAB_UI.kindAsk });
}

export function AskBox({ disabled, disabledReason, autoFocus }: { disabled?: boolean; disabledReason?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    submitAsk(q);
  };
  return (
    <form className="lab2g-askbox" role="search" onSubmit={submit}>
      <GInput
        aria-label={LAB_UI.askTitle}
        placeholder={LAB_UI.askPlaceholder}
        value={q}
        maxLength={300}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        autoFocus={autoFocus}
      />
      <GButton type="submit" variant="ink" disabled={disabled || !q.trim()} disabledReason={disabledReason}>
        {LAB_UI.askSubmit}
      </GButton>
    </form>
  );
}

/** Today's Ask panel (01 7.8). */
export function AskPanel({ panel }: { panel: { state: SectionState; recent: { q: string; href: string }[]; examples: string[] } }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  const off = panel.state.kind === 'not_built';
  return (
    <Panel title={LAB_UI.askTitle} className="lab2g-askpanel" id="lab2g-askpanel">
      {off && <SectionNote state={panel.state} />}
      <AskBox disabled={off} disabledReason={panel.state.message ?? undefined} autoFocus={!off} />
      {!off && (
        <div className="lab2g-askchips">
          <span className="lab2g-muted" data-lab-ink="">{LAB_UI.askExamples}</span>
          {panel.examples.map((x) => (
            <button data-g="LabButton" key={x} type="button" className="lab2-pill lab2-seeall" onClick={() => submitAsk(x)}>
              <span data-lab-ink="">{x}</span>
            </button>
          ))}
        </div>
      )}
      {!off && recent.length > 0 && (
        <div className="lab2g-askchips">
          <span className="lab2g-muted" data-lab-ink="">{LAB_UI.askRecent}</span>
          {recent.map((x) => (
            <button data-g="LabButton" key={x} type="button" className="lab2-pill lab2-seeall" onClick={() => submitAsk(x)}>
              <span data-lab-ink="">{x}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

const MATCH: Record<string, string> = { close: LAB_UI.matchClose, related: LAB_UI.matchRelated, filter: LAB_UI.matchFilter };

/** The answer: summary line verbatim from 07, filter chips, then the cards. */
export function AskAnswer({ ask, chips, refineHref }: { ask: AskView; chips: { label: string; removeHref: string }[]; refineHref: string | null }) {
  return (
    <div className="lab2g-ask">
      {ask.indexing && <p className="lab2g-muted" data-lab-ink="">{fill(LAB_UI.indexing, { done: String(ask.indexing.done), total: String(ask.indexing.total) })}</p>}
      <p className="lab2g-ask-summary" data-lab-ink="">{ask.summary}</p>
      {chips.length > 0 && (
        <div className="lab2g-askchips">
          {chips.map((c) => (
            <a data-g="LabLink" key={c.label} href={c.removeHref} className="lab2-pill lab2-seeall" aria-label={fill(LAB_UI.removeChip, { label: c.label })}>
              <span data-lab-ink="">{c.label}</span>
            </a>
          ))}
          {refineHref && (
            <Link data-g="LabLink" href={refineHref} className="lab2-textlink" data-lab-ink="">{LAB_UI.openInBreakouts}</Link>
          )}
        </div>
      )}
      <div className="lab2g-cardgrid lab2g-cardgrid-ask">
        {ask.cards.map((c, i) => (
          <span key={c.postId} className="lab2g-rise" style={{ ['--lab-rise-i' as string]: String(Math.min(i, 7)) }}>
            <EvidenceCard card={c.card} match={c.match} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function EvidenceCard({ card, match }: { card: AskView['cards'][number]['card']; match: 'close' | 'related' | 'filter' }) {
  return <PostCard card={card} chip={MATCH[match]} sharedPrefix="ask" />;
}
