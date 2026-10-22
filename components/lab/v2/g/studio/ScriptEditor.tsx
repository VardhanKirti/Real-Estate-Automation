'use client';
/**
 * The script editor, GladOS tree (07 7.8 inside 01 17's sheet): the strand rail with one SectionCard per
 * beat, the HookPicker with the judge's line, Duration and Platform, and the side panel with Checks,
 * Grounding and Versions. Everything it says about a rule, a budget or the judge is 07's text.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { GInput, GSegmented, GTextarea } from '@/components/g';
import { Segmented } from '@/components/lab/v2/shared';
import { prefersReducedMotion } from '@/components/lab/v2/shared/motion/useReducedMotion';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';

import { fmtDelta, fmtRatio } from '@/lib/lab/view/format';
import type { ScriptSheetView } from '@/lib/lab/gen/view';
import type { LabRuleResult, LabScriptBody } from '@/lib/schemas';
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

export type Body = LabScriptBody;

export function RuleChip({ r }: { r: LabRuleResult }) {
  const tone = r.ok ? 'ok' : r.severity === 'block' ? 'bad' : r.severity === 'warn' ? 'warn' : 'info';
  return (
    <span className="lab2g-rule" data-tone={tone} title={`${r.detail}${r.source ? ` (${r.source})` : ''}`} data-lab-ink="">
      {r.label}
    </span>
  );
}

export function WordChip({ words, budget, deltaPct, over }: { words: number; budget: number; deltaPct: number; over: boolean }) {
  const off = Math.abs(deltaPct) >= 0.5;
  return (
    <span className="lab2g-words" data-over={over ? '' : undefined} data-warn={Math.abs(deltaPct) > 25 ? '' : undefined} data-lab-ink="">
      {fill(LAB_UI.wordsOf, { words: String(words), budget: String(budget) })}
      {off ? ` ${fmtDelta(deltaPct)}` : ''}
    </span>
  );
}

export function SectionCard({
  section,
  text,
  readOnly,
  onChange,
  onBlur,
  onRegenerate,
  regenerating,
}: {
  section: ScriptSheetView['sections'][number];
  text: { spoken: string; onScreen: string; visualNote: string };
  readOnly: boolean;
  onChange: (patch: Partial<{ spoken: string; onScreen: string; visualNote: string }>) => void;
  onBlur: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const id = `lab2g-sec-${section.index}`;
  return (
    <section className="lab2g-section" aria-labelledby={`${id}-t`} data-beat={section.type}>
      <header className="lab2g-section-head">
        <h3 id={`${id}-t`} className="lab2g-section-title" data-lab-ink="">
          {section.label}
          <span className="lab2g-muted">{` ${Math.round(section.startPct)} to ${Math.round(section.endPct)}%`}</span>
        </h3>
        <WordChip words={section.words} budget={section.budget} deltaPct={section.deltaPct} over={section.over} />
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={readOnly ? true : undefined} onClick={() => !readOnly && onRegenerate()}>
          <span data-lab-ink="">{regenerating ? LAB_UI.rewriting : LAB_UI.regenerate}</span>
        </button>
      </header>
      {section.rules.length > 0 && (
        <div className="lab2g-rules">
          {section.rules.map((r) => <RuleChip key={`${r.id}-${r.section}`} r={r} />)}
        </div>
      )}
      <div className="lab2g-section-fields">
        <label className="lab2g-fieldlabel" htmlFor={`${id}-s`} data-lab-ink="">{LAB_UI.spoken}</label>
        <GTextarea id={`${id}-s`} value={text.spoken} readOnly={readOnly} onChange={(e) => onChange({ spoken: e.target.value })} onBlur={onBlur} maxLines={10} />
        <span className="lab2g-section-pair">
          <span>
            <label className="lab2g-fieldlabel" htmlFor={`${id}-o`} data-lab-ink="">{LAB_UI.onScreen}</label>
            <GTextarea id={`${id}-o`} value={text.onScreen} readOnly={readOnly} onChange={(e) => onChange({ onScreen: e.target.value })} onBlur={onBlur} maxLines={4} />
          </span>
          <span>
            <label className="lab2g-fieldlabel" htmlFor={`${id}-v`} data-lab-ink="">{LAB_UI.visualNote}</label>
            <GTextarea id={`${id}-v`} value={text.visualNote} readOnly={readOnly} onChange={(e) => onChange({ visualNote: e.target.value })} onBlur={onBlur} maxLines={4} />
          </span>
        </span>
      </div>
    </section>
  );
}

export function HookPicker({ data, choice, readOnly, onPick, onJudge, judging }: { data: ScriptSheetView; choice: number; readOnly: boolean; onPick: (i: number) => void; onJudge: () => void; judging: boolean }) {
  return (
    <section className="lab2g-section lab2g-hooks" aria-labelledby="lab2g-hooks-t" data-beat="hook">
      <header className="lab2g-section-head">
        <h3 id="lab2g-hooks-t" className="lab2g-section-title" data-lab-ink="">{LAB_UI.hook}</h3>
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={readOnly ? true : undefined} onClick={() => !readOnly && onJudge()}>
          <span data-lab-ink="">{judging ? LAB_UI.loading : LAB_UI.askJudge}</span>
        </button>
      </header>
      <div role="radiogroup" aria-label={LAB_UI.hook} className="lab2g-hooklist">
        {data.hooks.map((h) => (
          <button data-g="LabButton"
            key={h.index}
            type="button"
            role="radio"
            aria-checked={h.index === choice}
            className="lab2g-hook"
            disabled={readOnly}
            onClick={() => onPick(h.index)}
          >
            <span className="lab2g-hook-n" data-lab-ink="">{h.index + 1}</span>
            <span className="lab2g-hook-text" data-lab-ink="">{h.spoken}</span>
            <span className="lab2g-hook-meta" data-lab-ink="">
              {[`${h.formLabel}, ${h.triggerLabel}`, fill(LAB_UI.wordsOf, { words: String(h.words), budget: String(h.budget) }), h.judgeWins !== null ? fill(LAB_UI.judgeWins, { n: String(h.judgeWins) }) : null].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
      <p className="lab2g-muted" data-lab-ink="">{data.judge.message}</p>
    </section>
  );
}

const DURATIONS = [30, 45, 60, 90] as const;
const PLATFORMS = [
  { value: 'instagram', label: 'Reel' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'Short' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'X' },
  { value: 'multi', label: LAB_UI.anyPlatform },
];

export function ScriptControls({ data, readOnly, onDuration, onPlatform }: { data: ScriptSheetView; readOnly: boolean; onDuration: (s: number) => void; onPlatform: (p: string) => void }) {
  const platform = data.body.platform ?? 'multi';
  const dur = DURATIONS.includes(data.plan.durationS as 30) ? String(data.plan.durationS) : 'custom';
  const customRef = useRef<HTMLInputElement>(null);
  return (
    <div className="lab2g-scriptctl">
      <span className="lab2g-ctl">
        <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.platformLabel}</span>
        <GSegmented label={LAB_UI.platformLabel} value={platform} onChange={(v) => !readOnly && onPlatform(v)} options={PLATFORMS} />
      </span>
      <span className="lab2g-ctl">
        <span className="lab2g-fieldlabel" data-lab-ink="">{LAB_UI.duration}</span>
        <GSegmented
          label={LAB_UI.duration}
          value={dur}
          onChange={(v) => {
            if (readOnly) return;
            if (v === 'custom') customRef.current?.focus();
            else onDuration(Number(v));
          }}
          options={[...DURATIONS.map((d) => ({ value: String(d), label: `${d}s` })), { value: 'custom', label: LAB_UI.custom }]}
        />
        <GInput
          ref={customRef}
          size="compact"
          className="lab2g-num lab2g-custom"
          type="number"
          min={10}
          max={1800}
          defaultValue={data.plan.durationS}
          aria-label={LAB_UI.customSeconds}
          readOnly={readOnly}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const n = Number((e.target as HTMLInputElement).value);
            if (n >= 10 && n <= 1800) onDuration(Math.round(n));
          }}
        />
      </span>
      <span className="lab2g-muted" data-lab-ink="">{fill(LAB_UI.planLine, { words: String(data.plan.words), wpm: String(data.plan.wpm) })}</span>
    </div>
  );
}

type SideTab = 'checks' | 'grounding' | 'versions';

export function SidePanel({
  data,
  tab,
  onTab,
  viewing,
  onVersion,
  onRestore,
  readOnly,
}: {
  data: ScriptSheetView;
  tab: SideTab;
  onTab: (t: SideTab) => void;
  viewing: number;
  onVersion: (v: number | null) => void;
  onRestore: (v: number) => void;
  readOnly: boolean;
}) {
  const g = data.grounding;
  const failing = [...data.gate.rules].sort((a, b) => Number(a.ok) - Number(b.ok));
  let body: ReactNode;
  if (tab === 'checks') {
    body = (
      <div className="lab2g-sidebody">
        <p className="lab2-card-text" data-lab-ink="">{data.gate.passed ? LAB_UI.gateReady : fill(LAB_UI.gateNot, { b: String(data.gate.toFix), w: String(data.gate.toConsider) })}</p>
        <ul className="lab2g-rulelist">
          {failing.map((r) => (
            <li key={`${r.id}-${r.section}`} className="lab2g-rulerow" data-ok={r.ok ? '' : undefined}>
              <RuleChip r={r} />
              <span className="lab2g-muted" data-lab-ink="">{r.detail}</span>
            </li>
          ))}
        </ul>
        {data.sections.flatMap((s) => s.checks.filter((c) => !c.ok)).map((c) => (
          <p key={`${c.id}-${c.section}`} className="lab2g-muted" data-lab-ink="">{`${c.label}: ${c.detail}`}</p>
        ))}
        {data.skills.filter((s) => !s.found).map((s) => (
          <p key={s.slug} className="lab2g-muted" data-lab-ink="">{fill(LAB_UI.voiceMissing, { slug: s.slug })}</p>
        ))}
      </div>
    );
  } else if (tab === 'grounding') {
    body = (
      <div className="lab2g-sidebody">
        {g.thin && <p className="lab2g-muted" data-lab-ink="">{fill(LAB_UI.thinGrounding, { n: String(g.exemplars.length) })}</p>}
        {g.contrast && <p className="lab2-card-text" data-lab-ink="">{g.contrast}</p>}
        <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.exemplars}</span>
        <ul className="lab2g-rows lab2g-rows-flat">
          {g.exemplars.map((x) => (
            <li key={x.postId}>
              <a data-g="LabLink" href={`?post=${x.postId}`} className="lab2g-row" data-lab-shared={`gx-${x.postId}`}>
                <span className="lab2g-row-main" data-lab-ink="">{x.hookText}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{fmtRatio(x.ratio)}</span>
              </a>
            </li>
          ))}
        </ul>
        {g.duds.length > 0 && <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.duds}</span>}
        <ul className="lab2g-rows lab2g-rows-flat">
          {g.duds.map((x) => (
            <li key={x.postId}>
              <a data-g="LabLink" href={`?post=${x.postId}`} className="lab2g-row" data-lab-shared={`gd-${x.postId}`}>
                <span className="lab2g-row-main" data-lab-ink="">{x.hookText}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{fmtRatio(x.ratio)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="lab2g-sidebody">
        {viewing !== data.version && (
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => onVersion(null)}>
            <span data-lab-ink="">{LAB_UI.backToLatest}</span>
          </button>
        )}
        <ul className="lab2g-rows lab2g-rows-flat">
          {[...data.versions].sort((a, b) => b.version - a.version).map((x) => (
            <li key={x.version} className="lab2g-versionrow" aria-current={x.version === viewing ? 'true' : undefined}>
              <button data-g="LabButton" type="button" className="lab2g-row" onClick={() => onVersion(x.version === data.version ? null : x.version)}>
                <span className="lab2g-row-main" data-lab-ink="">{`v${x.version}${x.edit ? `, ${LAB_UI.edited}` : ''}${x.frozen ? `, ${LAB_UI.frozenWord}` : ''}`}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{`${fmtLabDay(x.createdAt)} · ${x.passed ? LAB_UI.gateReady : LAB_UI.gateNotShort}`}</span>
              </button>
              {x.version !== data.version && (
                <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={readOnly ? true : undefined} onClick={() => !readOnly && onRestore(x.version)}>
                  <span data-lab-ink="">{LAB_UI.restore}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <aside className="lab2g-side" aria-label={LAB_UI.checks}>
      <Segmented
        label={LAB_UI.kindScript}
        value={tab}
        onChange={onTab}
        options={[
          { id: 'checks', label: LAB_UI.checks },
          { id: 'grounding', label: LAB_UI.grounding },
          { id: 'versions', label: LAB_UI.versions },
        ]}
        controls="lab2g-side-panel"
      />
      <div id="lab2g-side-panel" role="tabpanel">{body}</div>
    </aside>
  );
}

/** The 03.9 seal: plays once, on the freeze action's success only; a reload shows it at rest. */
export function FreezeSeal({ text, play }: { text: string; play: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!play || !el || typeof el.animate !== 'function') return;
    if (prefersReducedMotion()) return;
    el.animate(
      [
        { opacity: 0, transform: 'scale(1.2) rotate(-6deg)' },
        { opacity: 1, transform: 'scale(1) rotate(-6deg)' },
      ],
      { duration: LAB_DUR.seal, delay: 60, easing: LAB_EASE.snap, fill: 'both' },
    );
  }, [play]);
  return (
    <span ref={ref} className="lab2g-seal" data-lab-ink="">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      {text}
    </span>
  );
}
