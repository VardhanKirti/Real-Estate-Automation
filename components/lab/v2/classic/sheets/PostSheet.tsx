'use client';
/**
 * Post sheet (01 14), Classic tree: one post read at its age. Tabs: overview, transcript, contact sheet,
 * metrics, comments (hidden by 01's rules). Writes go to POST /api/lab/posts, /api/lab/frames and
 * /api/lab/comments.
 */
import { useState } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { BandViz } from '@/components/lab/v2/shared';
import type { PostSheetView } from '@/lib/lab/view/sheets/post';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { Btn, CapDialog, Dialog } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { IntervalBar, KV, StateLine, Tag, shows } from '../parts';
import { Strand } from '../viz';
import { Block, InnerTabs, type SheetCommon } from './common';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

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
      <p className="lab2-postsheet-hook" data-lab-ink="">{v.hookText}</p>
      {v.strand && <Strand strand={v.strand} label={v.hookText} tall />}

      <div className="lab2c-read">
        {r.state === 'judged' ? (
          <>
            <span className="lab2c-read-num" data-lab-ink="">{r.text}</span>
            <span className="lab2c-read-side">
              <span className="lab2c-muted" data-lab-ink="">{`${r.atLabel ?? ''} · n ${r.n}`}</span>
              <IntervalBar lo={r.lo} hi={r.hi} point={r.ratio} />
              {r.rangeText && <span className="lab2c-muted" data-lab-ink="">{r.rangeText}</span>}
            </span>
          </>
        ) : (
          <p className="lab2c-state-text" data-lab-ink="">{r.text}</p>
        )}
      </div>

      <div className="lab2c-checkpoints" aria-label={C.sheet.readAt}>
        {v.checkpoints.map((c) => (
          <span key={c.h} className="lab2c-checkpoint" data-state={c.state}>
            <span className="lab2c-kv-k" data-lab-ink="">{c.label}</span>
            <span className="lab2c-checkpoint-v" data-lab-ink="">
              {c.state === 'read' ? c.ratioText ?? fmtCount(c.views ?? 0) : c.state === 'missed' ? `${C.sheet.missed} ${c.label}` : C.sheet.pendingRead}
            </span>
          </span>
        ))}
      </div>

      {v.curve && v.curve.points.length >= 2 && (
        <Block title={C.sheet.viewsAt}>
          <BandViz
            ageH={v.curve.points[v.curve.points.length - 1].h}
            points={v.curve.points.map((p) => ({ h: p.h, v: p.views }))}
            band={v.curve.band.map((b) => ({ h: b.h, lo: b.lo, hi: b.hi, mid: Math.sqrt(b.lo * b.hi) }))}
            w={500}
            h={120}
          />
        </Block>
      )}

      <dl className="lab2c-kvs">
        <KV k={C.sheet.niche} v={v.nicheRatio.enough && v.nicheRatio.text ? `${v.nicheRatio.text} · n ${v.nicheRatio.n}` : `${C.notEnough} · n ${v.nicheRatio.n}`} />
        {v.metrics.depthText && <KV k={C.sheet.depth} v={v.metrics.depthText} />}
        {v.dualHigh && <KV k={C.sheet.dualHigh} v={<Tag tone="strong">{C.breakouts.dualChip}</Tag>} />}
        {v.exogenous.flagged && <KV k={C.breakouts.outsideChip} v={v.exogenous.reason ?? ''} />}
      </dl>
      {v.platformNote && <p className="lab2c-muted" data-lab-ink="">{v.platformNote}</p>}

      {v.why.length > 0 && (
        <Block title={C.sheet.why}>
          <ul className="lab2c-why">
            {v.why.map((w, i) => (
              <li key={i}>
                <span data-lab-ink="">{`${w.featureLabel}: ${w.valueLabel}`}</span>
                <span className="lab2c-muted" data-lab-ink="">{`${w.liftText} · n ${w.n}`}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {v.prediction.state !== 'not_owned' && v.prediction.state !== 'not_built' && (
        <Block title={C.studio.prediction}>
          <p className="lab2c-pred" data-lab-ink="">
            {v.prediction.state === 'none' && C.sheet.noPrediction}
            {v.prediction.state === 'hidden' && v.prediction.chip?.hiddenReason}
            {v.prediction.state === 'shown' && v.prediction.chip?.text}
          </p>
          {v.prediction.state === 'shown' && v.prediction.chip?.record && <span className="lab2c-muted" data-lab-ink="">{v.prediction.chip.record}</span>}
        </Block>
      )}

      {v.dissection && (
        <Block title={C.sheet.dissection}>
          <dl className="lab2c-kvs">
            <KV k={C.sheet.hookForm} v={v.dissection.hookFormLabel} />
            <KV k={C.sheet.trigger} v={v.dissection.triggerLabel} />
            <KV k={C.sheet.structure} v={v.dissection.structureLabel} />
            {v.dissection.tension && <KV k={C.studio.peopleThink} v={v.dissection.tension.falseBelief} />}
          </dl>
        </Block>
      )}

      {v.actions.canHypothesis && (
        <Block title={C.sheet.hypothesis}>
          <textarea className="lab2c-input" value={hyp} maxLength={280} onChange={(e) => setHyp(e.target.value)} disabled={!!readOnly} aria-label={C.sheet.hypothesis} />
          <span><Btn disabled={!!readOnly || hyp.trim().length < 10} title={readOnly ?? undefined} onClick={() => void post('/api/lab/posts', { id: v.postId, action: 'hypothesis', text: hyp.trim() }, { okText: C.setupSheet.saved })}>{C.sheet.saveHypothesis}</Btn></span>
        </Block>
      )}

      {v.tests.length > 0 && (
        <ul className="lab2c-why">
          {v.tests.map((t) => <li key={t.id}><a href={t.href} className="lab2-textlink">{t.label}</a></li>)}
        </ul>
      )}

      <div className="lab2c-actrow">
        <a href={v.actions.openOriginal} target="_blank" rel="noopener noreferrer" className="lab2c-btn lab2c-btn-primary">{C.sheet.openOriginal}</a>
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
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.dialog.reason}</span>
          <select className="lab2c-input" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus="">
            {FLAG_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
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
    <div className="lab2-postsheet">
      <InnerTabs tabs={tabs} st={st} setInner={setInner} label={C.sheetKind.post}>
        {(tab) => {
          if (tab === 'transcript') {
            const t = v.transcript;
            if (!t || t.status !== 'done') return <p className="lab2c-state-text" data-lab-ink="">{`${C.sheet.noTranscript}${t ? `: ${t.status}` : ''}`}</p>;
            return (
              <div className="lab2c-transcript">
                {t.segments.map((s, i) => (
                  <p key={i} className="lab2c-tseg">
                    <span className="lab2c-beat lab2c-beat-dot" data-beat={s.type} />
                    <span data-lab-ink="">{s.text}</span>
                  </p>
                ))}
              </div>
            );
          }
          if (tab === 'frames') {
            return (
              <>
                <StateLine state={v.frames.state} />
                {v.frames.src && <img src={v.frames.src} alt={v.frames.caption} className="lab2c-contact" />}
                <p className="lab2c-muted" data-lab-ink="">{v.frames.caption}</p>
                {v.frames.canBuild && !v.frames.src && <span><Btn primary disabled={!!readOnly} busy={busy === 'frames'} onClick={() => void build()}>{busy === 'frames' ? C.sheet.building : C.sheet.buildSheet}</Btn></span>}
              </>
            );
          }
          if (tab === 'metrics') {
            const m = v.metrics;
            return (
              <>
                <dl className="lab2c-kvs">
                  <KV k={C.sheet.views} v={m.views !== null ? fmtCount(m.views) : ''} />
                  <KV k={C.sheet.likesK} v={m.likes !== null ? fmtCount(m.likes) : ''} />
                  <KV k={C.sheet.commentsK} v={m.comments !== null ? fmtCount(m.comments) : ''} />
                  <KV k={C.sheet.shares} v={m.shares !== null ? fmtCount(m.shares) : ''} />
                  {m.saves !== null && <KV k={C.sheet.saves} v={fmtCount(m.saves)} />}
                </dl>
                <div className="lab2c-table-wrap">
                  <table className="lab2c-table">
                    <thead><tr><th scope="col">{C.sheet.age}</th><th scope="col" className="lab2c-num-col">{C.sheet.views}</th><th scope="col" className="lab2c-num-col">{C.sheet.likesK}</th></tr></thead>
                    <tbody>
                      {v.snapshots.map((s) => (
                        <tr key={s.capturedAt}>
                          <td data-lab-ink="">{s.hoursSincePost !== null ? `${Math.round(s.hoursSincePost)}h` : ''}</td>
                          <td className="lab2c-num-col" data-lab-ink="">{s.views !== null ? fmtCount(s.views) : ''}</td>
                          <td className="lab2c-num-col" data-lab-ink="">{s.likes !== null ? fmtCount(s.likes) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {v.retention.state.kind !== 'ready' && <StateLine state={v.retention.state} compact />}
                {v.retention.beatsText && <p className="lab2c-muted" data-lab-ink="">{v.retention.beatsText}</p>}
              </>
            );
          }
          if (tab === 'comments') {
            const c = v.comments;
            return (
              <>
                {c.state.kind === 'off' && c.state.message ? (
                  <div className="lab2c-state"><p className="lab2c-state-text" data-lab-ink="">{c.state.message}</p>{c.state.action && <SetupLink href={c.state.action.href} label={c.state.action.label} className="lab2-setup" />}</div>
                ) : (
                  <StateLine state={c.state} />
                )}
                {c.intentText && <p className="lab2c-note" data-lab-ink="">{c.intentText}</p>}
                {shows(c.state) && c.rows.length > 0 && (
                  <ul className="lab2c-comments">
                    {c.rows.map((r) => (
                      <li key={r.id}>
                        <Tag tone={r.intent === 'request' ? 'strong' : 'quiet'}>{r.intentLabel}</Tag>
                        <span className="lab2c-comment-text" data-lab-ink="">{r.text}</span>
                        <span className="lab2c-muted" data-lab-ink="">{`${fmtCount(r.likes)} ${C.sheet.likes}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.canFetch && <span><Btn primary disabled={!!readOnly} busy={busy === 'comments'} onClick={() => void fetchComments()}>{busy === 'comments' ? C.sheet.fetching : C.sheet.fetchComments}</Btn></span>}
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
