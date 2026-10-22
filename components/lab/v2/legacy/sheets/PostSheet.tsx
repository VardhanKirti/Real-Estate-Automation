'use client';
/**
 * Post sheet (01 14) under Bennett Legacy: one post read at its age, as an FO panel. Tabs: overview,
 * transcript, contact sheet, metrics, comments (hidden by 01's rules). Same writes as the Classic sheet:
 * POST /api/lab/posts, /api/lab/frames and /api/lab/comments (the last two behind the spend gate).
 */
import { useState } from 'react';
import { BigStat } from '@/components/legacy';
import type { PostSheetView } from '@/lib/lab/view/sheets/post';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { CapDialog, Dialog, Field } from '../dialogs';
import { Btn, IntervalBar, KV, LState, Tag, shows } from '../parts';
import { AgeCurve, Strand } from '../viz';
import { Block, InnerTabs, type SheetCommon } from './common';

export function postTitle(v: PostSheetView): { title: string; caption: string | null } {
  return { title: C.sheetKind.post, caption: `${v.creator.displayName} · ${v.formatLabel ?? v.platform}` };
}

const FLAG_REASONS = C.sheet.flagReasons;

function Overview({ v, readOnly }: { v: PostSheetView; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [flag, setFlag] = useState(false);
  const [reason, setReason] = useState(FLAG_REASONS[0]);
  const [hyp, setHyp] = useState(v.hypothesis ?? '');
  const r = v.read;
  const testNew = () => { const u = new URL(window.location.href); u.searchParams.delete('post'); u.searchParams.set('test', 'new'); u.searchParams.set('post', v.postId); openSheetHref(u.pathname + u.search); };
  return (
    <>
      <p className="l-lab-hook">{v.hookText}</p>
      {v.strand && <Strand strand={v.strand} label={v.hookText} tall />}

      <div data-l="LabRead" className="l-lab-read">
        {r.state === 'judged' ? (
          <>
            <BigStat display={r.text} caption={`${r.atLabel ?? ''} · n ${r.n}`} />
            <span className="l-lab-read-side">
              <IntervalBar lo={r.lo} hi={r.hi} point={r.ratio} />
              {r.rangeText && <span className="l-muted">{r.rangeText}</span>}
            </span>
          </>
        ) : (
          <p className="l-lab-state-text">{r.text}</p>
        )}
      </div>

      <div data-l="LabCheckpoints" className="l-lab-checkpoints" aria-label={C.sheet.readAt}>
        {v.checkpoints.map((c) => (
          <span key={c.h} className="l-lab-checkpoint" data-state={c.state}>
            <span className="l-micro">{c.label}</span>
            <span className="l-lab-checkpoint-v">{c.state === 'read' ? c.ratioText ?? fmtCount(c.views ?? 0) : c.state === 'missed' ? `${C.sheet.missed} ${c.label}` : C.sheet.pendingRead}</span>
          </span>
        ))}
      </div>

      {v.curve && v.curve.points.length >= 2 && (
        <Block title={C.sheet.viewsAt}>
          <AgeCurve curve={v.curve} />
        </Block>
      )}

      <dl className="l-lab-kvs">
        <KV k={C.sheet.niche} v={v.nicheRatio.enough && v.nicheRatio.text ? `${v.nicheRatio.text} · n ${v.nicheRatio.n}` : `${C.notEnough} · n ${v.nicheRatio.n}`} />
        {v.metrics.depthText && <KV k={C.sheet.depth} v={v.metrics.depthText} />}
        {v.dualHigh && <KV k={C.sheet.dualHigh} v={<Tag tone="strong">{C.breakouts.dualChip}</Tag>} />}
        {v.exogenous.flagged && <KV k={C.breakouts.outsideChip} v={v.exogenous.reason ?? ''} />}
      </dl>
      {v.platformNote && <p className="l-body-text">{v.platformNote}</p>}

      {v.why.length > 0 && (
        <Block title={C.sheet.why}>
          <ul className="l-lab-list">
            {v.why.map((w, i) => (
              <li key={i}>
                <span>{`${w.featureLabel}: ${w.valueLabel}`}</span>
                <span className="l-muted">{`${w.liftText} · n ${w.n}`}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {v.prediction.state !== 'not_owned' && v.prediction.state !== 'not_built' && (
        <Block title={C.studio.prediction}>
          <p className="l-lab-pred">
            {v.prediction.state === 'none' && C.sheet.noPrediction}
            {v.prediction.state === 'hidden' && v.prediction.chip?.hiddenReason}
            {v.prediction.state === 'shown' && v.prediction.chip?.text}
          </p>
          {v.prediction.state === 'shown' && v.prediction.chip?.record && <span className="l-muted">{v.prediction.chip.record}</span>}
        </Block>
      )}

      {v.dissection && (
        <Block title={C.sheet.dissection}>
          <dl className="l-lab-kvs">
            <KV k={C.sheet.hookForm} v={v.dissection.hookFormLabel} />
            <KV k={C.sheet.trigger} v={v.dissection.triggerLabel} />
            <KV k={C.sheet.structure} v={v.dissection.structureLabel} />
            {v.dissection.tension && <KV k={C.studio.peopleThink} v={v.dissection.tension.falseBelief} />}
          </dl>
        </Block>
      )}

      {v.actions.canHypothesis && (
        <Block title={C.sheet.hypothesis}>
          <textarea className="l-textarea" value={hyp} maxLength={280} onChange={(e) => setHyp(e.target.value)} disabled={!!readOnly} aria-label={C.sheet.hypothesis} />
          <span className="l-lab-actrow"><Btn disabled={!!readOnly || hyp.trim().length < 10} title={readOnly ?? undefined} onClick={() => void post('/api/lab/posts', { id: v.postId, action: 'hypothesis', text: hyp.trim() }, { okText: C.setupSheet.saved })}>{C.sheet.saveHypothesis}</Btn></span>
        </Block>
      )}

      {v.tests.length > 0 && (
        <ul className="l-lab-list">
          {v.tests.map((t) => <li key={t.id}><a href={t.href} className="l-link">{t.label}</a></li>)}
        </ul>
      )}

      <div className="l-lab-actrow">
        <a href={v.actions.openOriginal} target="_blank" rel="noopener noreferrer" data-l="Pressable" data-lens="c" className="l-pressable is-primary l-btn">{C.sheet.openOriginal}</a>
        {v.actions.canFlag && (
          v.exogenous.flagged ? (
            <Btn disabled={!!readOnly} title={readOnly ?? undefined} busy={busy === 'flag'} onClick={() => void post('/api/lab/posts', { id: v.postId, action: 'unflag_exogenous' }, { key: 'flag' })}>{C.sheet.unflag}</Btn>
          ) : (
            <Btn disabled={!!readOnly} title={readOnly ?? undefined} onClick={() => setFlag(true)}>{C.sheet.flag}</Btn>
          )
        )}
        {v.actions.canAddToTest && v.tests.length === 0 && <Btn onClick={testNew}>{C.sheet.addTest}</Btn>}
      </div>

      <Dialog
        open={flag}
        onClose={() => setFlag(false)}
        title={C.sheet.flag}
        footer={
          <>
            <Btn onClick={() => setFlag(false)}>{C.dialog.cancel}</Btn>
            <Btn primary onClick={async () => { await post('/api/lab/posts', { id: v.postId, action: 'flag_exogenous', reason }, { okText: C.sheet.flagged }); setFlag(false); }}>{C.sheet.flag}</Btn>
          </>
        }
      >
        <Field label={C.dialog.reason}>
          <select className="l-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {FLAG_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </Dialog>
    </>
  );
}

export function PostSheet({ view, readOnly, setInner, st }: { view: PostSheetView } & SheetCommon) {
  const v = view;
  const { post, busy } = useLabPost();
  const [cap, setCap] = useState<{ data: Record<string, unknown>; retry: () => void } | null>(null);
  const tabs: { id: string; label: string }[] = [{ id: 'overview', label: C.sheet.overview }, { id: 'transcript', label: C.sheet.transcript }];
  if (v.frames.src || v.frames.canBuild) tabs.push({ id: 'frames', label: C.sheet.frames });
  tabs.push({ id: 'metrics', label: C.sheet.metrics });
  if (v.comments.state.kind !== 'not_built') tabs.push({ id: 'comments', label: C.sheet.comments });

  const build = (override = false) => post('/api/lab/frames', { action: 'build', postId: v.postId, ...(override ? { override: true } : {}) }, { key: 'frames', onCap: (_retry, d) => setCap({ data: d, retry: () => void build(true) }) });
  const fetchComments = (override = false) => post('/api/lab/comments', { action: 'run', postIds: [v.postId], ...(override ? { override: true } : {}) }, { key: 'comments', onCap: (_retry, d) => setCap({ data: d, retry: () => void fetchComments(true) }) });

  return (
    <div data-l="LabPostSheet" className="l-lab-sheetbody">
      <InnerTabs tabs={tabs} st={st} setInner={setInner} label={C.sheetKind.post}>
        {(tab) => {
          if (tab === 'transcript') {
            const t = v.transcript;
            if (!t || t.status !== 'done') return <p className="l-lab-state-text">{`${C.sheet.noTranscript}${t ? `: ${t.status}` : ''}`}</p>;
            return (
              <div className="l-lab-transcript">
                {t.segments.map((s, i) => (
                  <p key={i} className="l-lab-tseg">
                    <span className="l-lab-beat l-lab-beat-dot" data-beat={s.type} aria-hidden />
                    <span>{s.text}</span>
                  </p>
                ))}
              </div>
            );
          }
          if (tab === 'frames') {
            return (
              <>
                <LState state={v.frames.state} />
                {v.frames.src && <img src={v.frames.src} alt={v.frames.caption} className="l-lab-contact" />}
                <p className="l-body-text">{v.frames.caption}</p>
                {v.frames.canBuild && !v.frames.src && <span className="l-lab-actrow"><Btn primary disabled={!!readOnly} busy={busy === 'frames'} onClick={() => void build()}>{busy === 'frames' ? C.sheet.building : C.sheet.buildSheet}</Btn></span>}
              </>
            );
          }
          if (tab === 'metrics') {
            const m = v.metrics;
            return (
              <>
                <dl className="l-strip l-lab-strip">
                  <div><dt>{C.sheet.views}</dt><dd>{m.views !== null ? fmtCount(m.views) : ''}</dd></div>
                  <div><dt>{C.sheet.likesK}</dt><dd>{m.likes !== null ? fmtCount(m.likes) : ''}</dd></div>
                  <div><dt>{C.sheet.commentsK}</dt><dd>{m.comments !== null ? fmtCount(m.comments) : ''}</dd></div>
                  <div><dt>{C.sheet.shares}</dt><dd>{m.shares !== null ? fmtCount(m.shares) : ''}</dd></div>
                </dl>
                {m.saves !== null && <dl className="l-lab-kvs"><KV k={C.sheet.saves} v={fmtCount(m.saves)} /></dl>}
                <div className="l-lab-table-wrap">
                  <table className="l-lab-table">
                    <thead><tr><th scope="col">{C.sheet.age}</th><th scope="col" className="is-num">{C.sheet.views}</th><th scope="col" className="is-num">{C.sheet.likesK}</th></tr></thead>
                    <tbody>
                      {v.snapshots.map((s) => (
                        <tr key={s.capturedAt}>
                          <td>{s.hoursSincePost !== null ? `${Math.round(s.hoursSincePost)}h` : ''}</td>
                          <td className="is-num">{s.views !== null ? fmtCount(s.views) : ''}</td>
                          <td className="is-num">{s.likes !== null ? fmtCount(s.likes) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {v.retention.state.kind !== 'ready' && <LState state={v.retention.state} compact />}
                {v.retention.beatsText && <p className="l-body-text">{v.retention.beatsText}</p>}
              </>
            );
          }
          if (tab === 'comments') {
            const c = v.comments;
            return (
              <>
                <LState state={c.state} />
                {c.intentText && <p className="l-lab-note">{c.intentText}</p>}
                {shows(c.state) && c.rows.length > 0 && (
                  <ul className="l-lab-comments">
                    {c.rows.map((r) => (
                      <li key={r.id}>
                        <Tag tone={r.intent === 'request' ? 'strong' : 'quiet'}>{r.intentLabel}</Tag>
                        <span className="l-lab-comment-text">{r.text}</span>
                        <span className="l-muted">{`${fmtCount(r.likes)} ${C.sheet.likes}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.canFetch && <span className="l-lab-actrow"><Btn primary disabled={!!readOnly} busy={busy === 'comments'} onClick={() => void fetchComments()}>{busy === 'comments' ? C.sheet.fetching : C.sheet.fetchComments}</Btn></span>}
              </>
            );
          }
          return <Overview v={v} readOnly={readOnly} />;
        }}
      </InnerTabs>
      <CapDialog ask={cap?.data ?? null} onClose={() => setCap(null)} onPass={() => { const r = cap?.retry; setCap(null); r?.(); }} />
    </div>
  );
}
