'use client';
/**
 * Section 07's script editor, Classic tree (07 7.8; 01 17): the strand rail with one card per section
 * (spoken, on-screen, visual note, word chip, rule chips, Regenerate), the HookPicker with the judge line,
 * and the side panel (Checks, Grounding, Versions). Every write is a POST /api/lab/scripts action.
 */
import { useState } from 'react';
import type { ScriptSheetView } from '@/lib/lab/gen/view';
import type { LabRuleResult, LabScriptBody } from '@/lib/schemas';
import { fmtClock, fmtDelta, fmtRatio } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn } from '../dialogs';
import { Tag } from '../parts';
import { Strand } from '../viz';
import { InnerTabs, type SheetCommon } from '../sheets/common';


export function RuleChip({ r }: { r: LabRuleResult }) {
  const tone = r.ok ? 'quiet' : r.severity === 'block' ? 'err' : r.severity === 'warn' ? 'warn' : 'quiet';
  return (
    <span className="lab2c-rule-chip" title={r.detail}>
      <Tag tone={tone}>{r.label}</Tag>
    </span>
  );
}

export function HookPicker({ data, choice, onPick, onJudge, disabled, busy }: { data: ScriptSheetView; choice: number; onPick: (i: number) => void; onJudge: () => void; disabled: string | null; busy: boolean }) {
  return (
    <div className="lab2c-hooks" role="radiogroup" aria-label={C.script.hooks}>
      {data.hooks.map((h) => (
        <button
          key={h.index}
          type="button"
          role="radio"
          aria-checked={h.index === choice}
          className="lab2c-hook"
          onClick={() => !disabled && onPick(h.index)}
          aria-disabled={disabled ? 'true' : undefined}
          title={disabled ?? undefined}
        >
          <span className="lab2c-hook-n" data-lab-ink="">{h.index + 1}</span>
          <span className="lab2c-hook-text" data-lab-ink="">{h.spoken}</span>
          <span className="lab2c-hook-meta" data-lab-ink="">
            {`${h.formLabel} · ${h.triggerLabel} · ${fill(C.script.words, { w: h.words, b: h.budget })}`}
            {h.judgeWins !== null ? ` · ${fill(C.script.judgeWins, { n: h.judgeWins })}` : ''}
          </span>
        </button>
      ))}
      <div className="lab2c-judge">
        <span className="lab2c-muted" data-lab-ink="">{data.judge.message}</span>
        <Btn onClick={onJudge} disabled={!!disabled} title={disabled ?? undefined} busy={busy}>{C.script.askJudge}</Btn>
      </div>
    </div>
  );
}

export type EditorState = { body: LabScriptBody; dirty: boolean };

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
    <div className="lab2c-editor">
      <div className="lab2c-editor-rail">
        <div className="lab2c-editor-strand">
          <Strand strand={{ beats: data.strand.map((s) => ({ type: s.type as never, label: C.script.beat[s.type] ?? s.type, startPct: s.startPct, endPct: s.endPct, summary: '', token: '' })), hook: null, rehookTicks: [], durationS: data.plan.durationS, template: data.strand.map((s) => s.type).join(', ') }} label={data.title} tall />
        </div>
        <section className="lab2c-section-card" data-type="hook">
          <header className="lab2c-section-head">
            <span className="lab2c-section-title" data-lab-ink="">{C.script.hook}</span>
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
            <section key={s.index} className="lab2c-section-card" data-type={s.type} data-open={isOpen ? '' : undefined}>
              <header className="lab2c-section-head">
                <button type="button" className="lab2c-section-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
                  <span className="lab2c-beat lab2c-beat-dot" data-beat={s.type} />
                  <span className="lab2c-section-title" data-lab-ink="">{`${C.script.beat[s.type] ?? s.type} (${Math.round(s.startPct)} to ${Math.round(s.endPct)}%)`}</span>
                </button>
                <Tag tone={s.over ? 'warn' : 'quiet'}>{`${fill(C.script.words, { w: s.words, b: s.budget })}${s.deltaPct ? ` ${fmtDelta(s.deltaPct)}` : ''}`}</Tag>
                <Btn disabled={!!readOnly} busy={busy === `regen-${i}`} onClick={() => void post({ action: 'regenerate_section', section: i }, `regen-${i}`)}>{busy === `regen-${i}` ? C.script.rewriting : C.script.regenerate}</Btn>
              </header>
              {(s.rules.length > 0 || s.checks.some((c) => !c.ok)) && (
                <div className="lab2c-rule-chips">
                  {s.rules.filter((r) => !r.ok || r.severity !== 'info').map((r) => <RuleChip key={r.id} r={r} />)}
                  {s.checks.filter((c) => !c.ok).map((c) => <span key={c.id} className="lab2c-rule-chip" title={c.detail}><Tag tone="warn">{c.label}</Tag></span>)}
                </div>
              )}
              {isOpen && (
                <div className="lab2c-section-fields">
                  <label className="lab2c-field lab2c-field-wide">
                    <span className="lab2c-field-label" data-lab-ink="">{C.script.spoken}</span>
                    <textarea className="lab2c-input" value={sec.spoken} onChange={(e) => setSection(i, { spoken: e.target.value })} readOnly={!!readOnly} />
                  </label>
                  <label className="lab2c-field">
                    <span className="lab2c-field-label" data-lab-ink="">{C.script.onScreen}</span>
                    <textarea className="lab2c-input" value={sec.onScreen} onChange={(e) => setSection(i, { onScreen: e.target.value })} readOnly={!!readOnly} />
                  </label>
                  <label className="lab2c-field">
                    <span className="lab2c-field-label" data-lab-ink="">{C.script.visual}</span>
                    <textarea className="lab2c-input" value={sec.visualNote} onChange={(e) => setSection(i, { visualNote: e.target.value })} readOnly={!!readOnly} />
                  </label>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <aside className="lab2c-editor-side" aria-label={C.script.side}>
        <InnerTabs tabs={[{ id: 'checks', label: C.sheet.checks }, { id: 'grounding', label: C.sheet.grounding }, { id: 'versions', label: C.sheet.versions }]} st={st} setInner={setInner} label={C.script.side}>
          {(tab) => {
            if (tab === 'grounding') {
              const g = data.grounding;
              return (
                <div className="lab2c-sidelist">
                  {g.thin && <p className="lab2c-muted" data-lab-ink="">{fill(C.script.thin, { n: g.exemplars.length })}</p>}
                  {g.contrast && <p className="lab2c-pred" data-lab-ink="">{g.contrast}</p>}
                  {g.exemplars.map((e) => (
                    <a key={e.postId} href={`?post=${e.postId}`} className="lab2c-ground-card">
                      <span className="lab2c-ground-hook" data-lab-ink="">{e.hookText}</span>
                      <span className="lab2c-ground-foot" data-lab-ink=""><span>{e.angle}</span><span className="lab2c-ground-num">{fmtRatio(e.ratio)}</span></span>
                    </a>
                  ))}
                  {g.duds.length > 0 && <h3 className="lab2c-block-title" data-lab-ink="">{C.script.duds}</h3>}
                  {g.duds.map((e) => (
                    <a key={e.postId} href={`?post=${e.postId}`} className="lab2c-ground-card" data-dud="">
                      <span className="lab2c-ground-hook" data-lab-ink="">{e.hookText}</span>
                      <span className="lab2c-ground-foot" data-lab-ink=""><span>{e.angle}</span><span className="lab2c-ground-num">{fmtRatio(e.ratio)}</span></span>
                    </a>
                  ))}
                </div>
              );
            }
            if (tab === 'versions') {
              return (
                <ul className="lab2c-versions">
                  {data.versions.map((v) => (
                    <li key={v.version} className="lab2c-version">
                      <button type="button" className="lab2c-version-row" onClick={() => onViewVersion(v.version === data.version ? null : v.version)} aria-current={v.version === data.version ? 'true' : undefined}>
                        <span data-lab-ink="">{`v${v.version}`}</span>
                        <span className="lab2c-muted" data-lab-ink="">{fmtClock(v.createdAt)}</span>
                        <span className="lab2c-version-tags">
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
              <div className="lab2c-sidelist">
                <p className="lab2c-pred" data-lab-ink="">{data.gate.passed ? C.script.ready : fill(C.script.toFix, { b: data.gate.toFix, w: data.gate.toConsider })}</p>
                {failing.map((r) => (
                  <div key={r.id} className="lab2c-check">
                    <RuleChip r={r} />
                    <span className="lab2c-muted" data-lab-ink="">{r.detail}</span>
                  </div>
                ))}
                {data.gate.scores && (
                  <dl className="lab2c-kvs">
                    {Object.entries(data.gate.scores).map(([k, v]) => (
                      <div key={k} className="lab2c-kv"><dt className="lab2c-kv-k" data-lab-ink="">{C.script.scores[k] ?? k}</dt><dd className="lab2c-kv-v" data-lab-ink="">{`${v} / 5`}</dd></div>
                    ))}
                  </dl>
                )}
                {data.skills.filter((s) => !s.found).map((s) => <p key={s.slug} className="lab2c-muted" data-lab-ink="">{fill(C.script.skillMissing, { slug: s.slug })}</p>)}
              </div>
            );
          }}
        </InnerTabs>
      </aside>
    </div>
  );
}
