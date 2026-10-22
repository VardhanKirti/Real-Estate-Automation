'use client';
/**
 * Section 07's script editor under Bennett Legacy (07 7.8; 01 17): the strand rail with one card per
 * section (spoken, on screen, visual note, the word chip, rule chips, Regenerate), the hook pair as SlabCards
 * side by side with the judge line, and the side panel (Checks, Grounding, Versions). Every write is a
 * POST /api/lab/scripts action, the same as the other trees.
 */
import { useState } from 'react';
import type { ScriptSheetView } from '@/lib/lab/gen/view';
import type { LabRuleResult, LabScriptBody } from '@/lib/schemas';
import { fmtClock, fmtDelta, fmtRatio } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, Tag, cx } from '../parts';
import { Strand } from '../viz';
import { InnerTabs, type SheetCommon } from './common';

export function RuleChip({ r }: { r: LabRuleResult }) {
  const tone = r.ok ? 'quiet' : r.severity === 'block' ? 'err' : r.severity === 'warn' ? 'warn' : 'quiet';
  return (
    <span className="l-lab-rulechip" title={r.detail}>
      <Tag tone={tone}>{r.label}</Tag>
    </span>
  );
}

/** The hooks as SlabCards side by side (pages/lab.md Studio: "hook pairs as two SlabCards"); one is chosen. */
export function HookPicker({ data, choice, onPick, onJudge, disabled, busy }: { data: ScriptSheetView; choice: number; onPick: (i: number) => void; onJudge: () => void; disabled: string | null; busy: boolean }) {
  return (
    <div data-l="HookPair" className="l-lab-hooks">
      <div className="l-lab-pair" role="radiogroup" aria-label={C.script.hooks}>
        {data.hooks.map((h) => (
          <button
            key={h.index}
            type="button"
            role="radio"
            aria-checked={h.index === choice}
            data-l="SlabCard"
            className={cx('l-card l-lab-paircard l-lab-hook', h.index === choice && 'is-on')}
            onClick={() => !disabled && onPick(h.index)}
            aria-disabled={disabled ? 'true' : undefined}
            title={disabled ?? undefined}
          >
            <span className="l-lab-hook-top">
              <span className="l-micro">{String.fromCharCode(65 + h.index)}</span>
              <span aria-hidden className="l-lab-hook-radio" data-on={h.index === choice ? '' : undefined} />
            </span>
            <span className="l-lab-paircard-hook">{h.spoken}</span>
            <span className="l-lab-hook-meta">
              {`${h.formLabel} · ${h.triggerLabel} · ${fill(C.script.words, { w: h.words, b: h.budget })}`}
              {h.judgeWins !== null ? ` · ${fill(C.script.judgeWins, { n: h.judgeWins })}` : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="l-lab-judge">
        <span className="l-body-text">{data.judge.message}</span>
        <Btn onClick={onJudge} disabled={!!disabled} title={disabled ?? undefined} busy={busy}>{C.script.askJudge}</Btn>
      </div>
    </div>
  );
}

export function ScriptEditor({
  data, body, setBody, readOnly, post, busy, setInner, st, onViewVersion,
}: {
  data: ScriptSheetView;
  body: LabScriptBody;
  setBody: (b: LabScriptBody) => void;
  readOnly: string | null;
  post: (body: Record<string, unknown>, key: string) => unknown;
  busy: string | null;
  onViewVersion: (v: number | null) => void;
} & Pick<SheetCommon, 'setInner' | 'st'>) {
  const [open, setOpen] = useState(0);
  const setSection = (i: number, patch: Partial<LabScriptBody['sections'][number]>) =>
    setBody({ ...body, sections: body.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div data-l="LabEditor" className="l-lab-editor">
      <div className="l-lab-editor-rail">
        <Strand
          strand={{ beats: data.strand.map((s) => ({ type: s.type as never, label: C.script.beat[s.type] ?? s.type, startPct: s.startPct, endPct: s.endPct, summary: '', token: '' })), hook: null, rehookTicks: [], durationS: data.plan.durationS, template: data.strand.map((s) => s.type).join(', ') }}
          label={data.title}
          tall
        />
        <section className="l-lab-section" data-type="hook">
          <header className="l-lab-section-head">
            <span className="l-lab-section-title">{C.script.hook}</span>
          </header>
          <HookPicker
            data={data}
            choice={body.hookChoice}
            onPick={(i) => void post({ action: 'set_hook', hookChoice: i }, 'hook')}
            onJudge={() => void post({ action: 'judge_hooks' }, 'judge')}
            disabled={readOnly}
            busy={busy === 'judge'}
          />
        </section>
        {data.sections.map((s, i) => {
          const sec = body.sections[i];
          if (!sec) return null;
          const isOpen = open === i;
          return (
            <section key={s.index} className="l-lab-section" data-type={s.type} data-open={isOpen ? '' : undefined}>
              <header className="l-lab-section-head">
                <button type="button" className="l-lab-section-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
                  <span className="l-lab-beat l-lab-beat-dot" data-beat={s.type} aria-hidden />
                  <span className="l-lab-section-title">{`${C.script.beat[s.type] ?? s.type} (${Math.round(s.startPct)} to ${Math.round(s.endPct)}%)`}</span>
                </button>
                <Tag tone={s.over ? 'warn' : 'quiet'}>{`${fill(C.script.words, { w: s.words, b: s.budget })}${s.deltaPct ? ` ${fmtDelta(s.deltaPct)}` : ''}`}</Tag>
                <Btn disabled={!!readOnly} busy={busy === `regen-${i}`} onClick={() => void post({ action: 'regenerate_section', section: i }, `regen-${i}`)}>{busy === `regen-${i}` ? C.script.rewriting : C.script.regenerate}</Btn>
              </header>
              {(s.rules.length > 0 || s.checks.some((c) => !c.ok)) && (
                <div className="l-chip-row">
                  {s.rules.filter((r) => !r.ok || r.severity !== 'info').map((r) => <RuleChip key={r.id} r={r} />)}
                  {s.checks.filter((c) => !c.ok).map((c) => <span key={c.id} className="l-lab-rulechip" title={c.detail}><Tag tone="warn">{c.label}</Tag></span>)}
                </div>
              )}
              {isOpen && (
                <div className="l-lab-section-fields">
                  <label className="l-lab-field" data-wide="">
                    <span className="l-field-label">{C.script.spoken}</span>
                    <textarea className="l-textarea" value={sec.spoken} onChange={(e) => setSection(i, { spoken: e.target.value })} readOnly={!!readOnly} />
                  </label>
                  <label className="l-lab-field">
                    <span className="l-field-label">{C.script.onScreen}</span>
                    <textarea className="l-textarea" value={sec.onScreen} onChange={(e) => setSection(i, { onScreen: e.target.value })} readOnly={!!readOnly} />
                  </label>
                  <label className="l-lab-field">
                    <span className="l-field-label">{C.script.visual}</span>
                    <textarea className="l-textarea" value={sec.visualNote} onChange={(e) => setSection(i, { visualNote: e.target.value })} readOnly={!!readOnly} />
                  </label>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <aside className="l-lab-editor-side" aria-label={C.script.side}>
        <InnerTabs tabs={[{ id: 'checks', label: C.sheet.checks }, { id: 'grounding', label: C.sheet.grounding }, { id: 'versions', label: C.sheet.versions }]} st={st} setInner={setInner} label={C.script.side}>
          {(tab) => {
            if (tab === 'grounding') {
              const g = data.grounding;
              return (
                <div className="l-lab-sidelist">
                  {g.thin && <p className="l-body-text">{fill(C.script.thin, { n: g.exemplars.length })}</p>}
                  {g.contrast && <p className="l-lab-pred">{g.contrast}</p>}
                  {g.exemplars.map((e) => (
                    <a key={e.postId} href={`?post=${e.postId}`} data-l="Pressable" data-lens="r" className="l-pressable is-row l-lab-ground-card">
                      <span className="l-lab-ground-hook">{e.hookText}</span>
                      <span className="l-lab-ground-foot"><span>{e.angle}</span><span className="l-num">{fmtRatio(e.ratio)}</span></span>
                    </a>
                  ))}
                  {g.duds.length > 0 && <h3 className="l-lab-block-title">{C.script.duds}</h3>}
                  {g.duds.map((e) => (
                    <a key={e.postId} href={`?post=${e.postId}`} data-l="Pressable" data-lens="r" className="l-pressable is-row l-lab-ground-card" data-dud="">
                      <span className="l-lab-ground-hook">{e.hookText}</span>
                      <span className="l-lab-ground-foot"><span>{e.angle}</span><span className="l-num">{fmtRatio(e.ratio)}</span></span>
                    </a>
                  ))}
                </div>
              );
            }
            if (tab === 'versions') {
              return (
                <ul className="l-lab-rows">
                  {data.versions.map((v) => (
                    <li key={v.version} className="l-lab-version">
                      <button type="button" data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-version-row" onClick={() => onViewVersion(v.version === data.version ? null : v.version)} aria-current={v.version === data.version ? 'true' : undefined}>
                        <span className="l-sym">{`v${v.version}`}</span>
                        <span className="l-muted">{fmtClock(v.createdAt)}</span>
                        <span className="l-chip-row">
                          {v.passed && <Tag tone="quiet">{C.script.ready}</Tag>}
                          {v.frozen && <Tag tone="strong">{C.script.frozen}</Tag>}
                        </span>
                      </button>
                      {v.version !== data.version && !readOnly && <Btn onClick={() => void post({ action: 'restore_version', version: v.version }, `restore-${v.version}`)}>{C.script.restore}</Btn>}
                    </li>
                  ))}
                </ul>
              );
            }
            const failing = data.gate.rules.filter((r) => !r.ok);
            return (
              <div className="l-lab-sidelist">
                <p className="l-lab-pred">{data.gate.passed ? C.script.ready : fill(C.script.toFix, { b: data.gate.toFix, w: data.gate.toConsider })}</p>
                {failing.map((r) => (
                  <div key={r.id} className="l-lab-check">
                    <RuleChip r={r} />
                    <span className="l-body-text">{r.detail}</span>
                  </div>
                ))}
                {data.gate.scores && (
                  <dl className="l-lab-kvs">
                    {Object.entries(data.gate.scores).map(([k, v]) => (
                      <div key={k} className="l-lab-kv"><dt>{C.script.scores[k] ?? k}</dt><dd>{`${v} / 5`}</dd></div>
                    ))}
                  </dl>
                )}
                {data.skills.filter((s) => !s.found).map((s) => <p key={s.slug} className="l-body-text">{fill(C.script.skillMissing, { slug: s.slug })}</p>)}
              </div>
            );
          }}
        </InnerTabs>
      </aside>
    </div>
  );
}
