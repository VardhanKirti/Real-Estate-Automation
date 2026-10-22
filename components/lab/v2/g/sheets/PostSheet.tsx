'use client';
/**
 * Post sheet (`?post=`), GladOS tree (01 14): the post read honestly at its age. Overview mirrors the
 * approved sheet frame (hook, the age-matched number with its range, the curve against the normal band,
 * the checkpoints, why it may have worked), then prediction, dissection and actions.
 */
import { useState } from 'react';
import { GDialog, GField, GSelect, GTextarea } from '@/components/g';
import { BandViz } from '@/components/lab/v2/shared';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtAge, fmtCount } from '@/lib/lab/view/format';
import type { PostSheetView } from '@/lib/lab/view/sheets/post';
import { SectionNote } from '../bits';
import { SheetShell, SheetTabs, type SheetCtx } from './SheetShell';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

type Tab = 'overview' | 'transcript' | 'frames' | 'metrics' | 'comments';
const PLATFORM: Record<string, string> = { instagram: 'Reel', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };
const REASONS = ['Collab', 'Newsletter or email push', 'Paid boost', 'Other'];

function Overview({ v }: { v: PostSheetView }) {
  const { post, busy } = useLabPost();
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [hyp, setHyp] = useState(v.hypothesis ?? '');
  const read = v.read;
  const split = read.ratioText ? read.ratioText.replace(/x$/, '') : null;
  const curve = v.curve;
  return (
    <div className="lab2-postsheet lab2g-postsheet">
      <p className="lab2-postsheet-hook" data-lab-ink="">{v.hookText}</p>
      <div className="lab2-stats">
        <span className="lab2-stat">
          {split ? (
            <span className="lab2-stat-num lab2g-bignum" data-lab-ink="">{split}<sup>x</sup></span>
          ) : (
            <span className="lab2g-word" data-lab-ink="">{read.text}</span>
          )}
          <span className="lab2-stat-label" data-lab-ink="">{[read.atLabel, `n ${read.n}`].filter(Boolean).join(', ')}</span>
        </span>
        {read.rangeText && (
          <span className="lab2-stat">
            <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.range}</span>
            <span className="lab2-card-text" data-lab-ink="">{`90% ${read.rangeText}`}</span>
          </span>
        )}
        {v.nicheRatio.text && (
          <span className="lab2-stat">
            <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.nicheLabel}</span>
            <span className="lab2-card-text" data-lab-ink="">{v.nicheRatio.text}{v.dualHigh ? ` · ${LAB_UI.dualHighChip}` : ''}</span>
          </span>
        )}
      </div>
      {read.state === 'too_new' && <p className="lab2g-text" data-lab-ink="">{fill(LAB_UI.tooNewSheet, { age: fmtAge(Math.max(0, 6 - (Date.now() - Date.parse(v.postedAt ?? '')) / 3_600_000)) })}</p>}
      {read.state === 'no_baseline' && <p className="lab2g-text" data-lab-ink="">{LAB_UI.noBaselineSheet.replace('{n}', String(read.n))}</p>}
      {curve && (
        <BandViz
          ageH={Math.max(...curve.points.map((p) => p.h), 1)}
          points={curve.points.map((p) => ({ h: p.h, v: p.views }))}
          band={curve.band.map((b) => ({ h: b.h, lo: b.lo, hi: b.hi, mid: Math.sqrt(Math.max(1, b.lo) * Math.max(1, b.hi)) }))}
          w={500}
          h={120}
        />
      )}
      <div className="lab2-postsheet-reads">
        <span className="lab2-card-cap" data-lab-ink="">{LAB_UI.readAt}</span>
        {v.checkpoints.map((c) => (
          <span key={c.h} className="lab2-chip" data-state={c.state} data-lab-ink="">
            {c.state === 'read' ? (c.ratioText ? `${c.label} ${c.ratioText}` : c.views !== null ? `${c.label} ${fmtCount(c.views)} ${LAB_COPY.labels.views.toLowerCase()}` : `${c.label} ${LAB_COPY.notEnough}`) : c.state === 'pending' ? `${c.label} ${LAB_UI.pending.toLowerCase()}` : `${LAB_UI.noReadNear} ${c.label}`}
          </span>
        ))}
      </div>
      {v.platformNote && <p className="lab2g-muted" data-lab-ink="">{v.platformNote}</p>}
      {v.why.length > 0 && (
        <div className="lab2-stat">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.whyWorked}</span>
          <ul className="lab2g-bullets">
            {v.why.map((w) => (
              <li key={`${w.feature}-${w.value}`} className="lab2-card-text" data-lab-ink="">
                {`${w.featureLabel}: ${w.valueLabel}, ${w.liftText} (n ${w.n})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.prediction.state !== 'not_owned' && (
        <div className="lab2-stat">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.prediction}</span>
          <p className="lab2-card-text" data-lab-ink="">
            {v.prediction.state === 'shown'
              ? [v.prediction.chip?.text, v.prediction.chip?.record].filter(Boolean).join(' · ')
              : v.prediction.state === 'hidden'
                ? v.prediction.chip?.hiddenReason
                : v.prediction.state === 'not_built'
                  ? LAB_COPY.layer.ledger
                  : LAB_UI.noPrediction}
          </p>
        </div>
      )}
      {v.dissection && (
        <div className="lab2-stat">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.dissection}</span>
          <dl className="lab2g-kv">
            <dt data-lab-ink="">{LAB_UI.dHook}</dt><dd data-lab-ink="">{v.dissection.hookFormLabel}</dd>
            <dt data-lab-ink="">{LAB_UI.dTrigger}</dt><dd data-lab-ink="">{v.dissection.triggerLabel}</dd>
            <dt data-lab-ink="">{LAB_UI.dStructure}</dt><dd data-lab-ink="">{v.dissection.structureLabel}</dd>
            {v.dissection.tension && (
              <>
                <dt data-lab-ink="">{LAB_UI.dTension}</dt>
                <dd data-lab-ink="">{`${v.dissection.tension.falseBelief} / ${v.dissection.tension.reframe}`}</dd>
              </>
            )}
          </dl>
        </div>
      )}
      {v.actions.canHypothesis && (
        <div className="lab2-stat">
          <GField label={LAB_UI.hypothesis} htmlFor="lab2g-hyp">
            <GTextarea id="lab2g-hyp" value={hyp} maxLength={280} onChange={(e) => setHyp(e.target.value)} />
          </GField>
          <span>
            <button data-g="LabButton"
              type="button"
              className="lab2-pill lab2-seeall"
              aria-disabled={hyp.trim().length < 10 ? true : undefined}
              onClick={() => hyp.trim().length >= 10 && post('/api/lab/posts', { id: v.postId, action: 'hypothesis', text: hyp.trim() }, { key: 'hyp', okText: LAB_UI.saved })}
            >
              <span data-lab-ink="">{busy === 'hyp' ? LAB_UI.loading : LAB_UI.saveHypothesis}</span>
            </button>
          </span>
        </div>
      )}
      <div className="lab2g-actions-row">
        <a data-g="LabLink" href={v.actions.openOriginal} target="_blank" rel="noopener noreferrer" className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.openOriginal}</a>
        {v.actions.canFlag &&
          (v.exogenous.flagged ? (
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/posts', { id: v.postId, action: 'unflag_exogenous' }, { key: 'flag', okText: LAB_UI.saved })}>
              <span data-lab-ink="">{LAB_UI.clearOutside}</span>
            </button>
          ) : (
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => setFlagOpen(true)}>
              <span data-lab-ink="">{LAB_UI.markOutside}</span>
            </button>
          ))}
        {v.actions.canAddToTest && v.tests.length === 0 && (
          <a data-g="LabLink" href={`?test=new&post=${v.postId}`} className="lab2-pill lab2-seeall" data-lab-shared="post-log-test" data-lab-ink="">{LAB_UI.addToTest}</a>
        )}
      </div>
      <GDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        title={LAB_UI.markOutside}
        confirmLabel={LAB_UI.markOutside}
        cancelLabel={LAB_UI.cancel}
        busy={busy === 'flag'}
        onConfirm={async () => {
          const r = await post('/api/lab/posts', { id: v.postId, action: 'flag_exogenous', reason }, { key: 'flag', okText: LAB_UI.marked });
          if (r.ok) setFlagOpen(false);
        }}
      >
        <GField label={LAB_UI.outsideReason} htmlFor="lab2g-exo">
          <GSelect id="lab2g-exo" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS.map((r) => ({ value: r, label: r }))} />
        </GField>
      </GDialog>
    </div>
  );
}

function Transcript({ v }: { v: PostSheetView }) {
  if (!v.transcript) return <p className="lab2g-text" data-lab-ink="">{LAB_UI.noTranscript}</p>;
  return (
    <div className="lab2g-transcript">
      {v.transcript.segments.length ? (
        v.transcript.segments.map((s, i) => (
          <p key={i} className="lab2g-seg-text" data-beat={s.type} data-lab-ink="">{s.text}</p>
        ))
      ) : (
        <p className="lab2g-seg-text" data-lab-ink="">{v.transcript.text}</p>
      )}
    </div>
  );
}

function Frames({ v }: { v: PostSheetView }) {
  const { post, busy } = useLabPost();
  return (
    <div className="lab2g-frames">
      {v.frames.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.frames.src} alt={v.frames.caption} className="lab2g-contact" />
      ) : (
        <SectionNote state={v.frames.state} />
      )}
      <p className="lab2g-muted" data-lab-ink="">{v.frames.caption}</p>
      {v.frames.canBuild && (
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/frames', { action: 'build', postId: v.postId }, { key: 'frames' })}>
          <span data-lab-ink="">{busy === 'frames' ? LAB_UI.building : LAB_UI.buildSheet}</span>
        </button>
      )}
    </div>
  );
}

function Metrics({ v }: { v: PostSheetView }) {
  return (
    <table className="lab2g-table">
      <thead>
        <tr>
          <th data-lab-ink="">{LAB_UI.colAge}</th>
          <th data-lab-ink="">{LAB_UI.views}</th>
          <th data-lab-ink="">{LAB_UI.likes}</th>
          <th data-lab-ink="">{LAB_UI.comments}</th>
          <th data-lab-ink="">{LAB_UI.shares}</th>
        </tr>
      </thead>
      <tbody>
        {v.snapshots.map((s) => (
          <tr key={s.capturedAt}>
            <td data-lab-ink="">{s.hoursSincePost === null ? '' : `${Math.round(s.hoursSincePost)}h`}</td>
            <td data-lab-ink="">{s.views ?? ''}</td>
            <td data-lab-ink="">{s.likes ?? ''}</td>
            <td data-lab-ink="">{s.comments ?? ''}</td>
            <td data-lab-ink="">{s.shares ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Comments({ v }: { v: PostSheetView }) {
  const { post, busy } = useLabPost();
  const c = v.comments;
  return (
    <div className="lab2g-comments">
      {c.state.kind !== 'ready' && <SectionNote state={c.state} />}
      {c.intentText && <p className="lab2-card-text" data-lab-ink="">{c.intentText}</p>}
      <ul className="lab2g-commentlist">
        {c.rows.map((r) => (
          <li key={r.id} className="lab2g-comment">
            <span className="lab2-chip"><span data-lab-ink="">{r.intentLabel}</span></span>
            <span className="lab2g-comment-text" data-lab-ink="">{r.text}</span>
            <span className="lab2g-muted" data-lab-ink="">{`${r.likes} ${LAB_UI.likes.toLowerCase()}`}</span>
          </li>
        ))}
      </ul>
      {c.canFetch && (
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/comments', { action: 'run', postIds: [v.postId] }, { key: 'comments' })}>
          <span data-lab-ink="">{busy === 'comments' ? LAB_UI.fetching : LAB_UI.fetchComments}</span>
        </button>
      )}
    </div>
  );
}

export function PostSheet({ ctx, view }: { ctx: SheetCtx; view: PostSheetView | null | undefined }) {
  const initial = (typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('st') : null) as Tab | null;
  const [tab, setTab] = useState<Tab>(initial ?? 'overview');
  const v = view ?? null;
  const tabs: { id: Tab; label: string }[] = v
    ? ([
        { id: 'overview', label: LAB_UI.overview },
        { id: 'transcript', label: LAB_UI.transcript },
        v.frames.src || v.frames.canBuild ? { id: 'frames', label: LAB_UI.contactSheet } : null,
        { id: 'metrics', label: LAB_UI.metrics },
        v.comments.state.kind !== 'not_built' ? { id: 'comments', label: LAB_UI.comments } : null,
      ].filter(Boolean) as { id: Tab; label: string }[])
    : [];
  const age = v?.postedAt ? v.postedAt : null;
  return (
    <SheetShell
      kind="post"
      ctx={ctx}
      notFound={view === null}
      title={LAB_UI.kindPost}
      caption={v ? [v.creator.displayName, PLATFORM[v.platform] ?? v.platform, age ? v.read.atLabel?.replace(/^at /, '') : null].filter(Boolean).join(' · ') : undefined}
      tabs={
        v && (
          <SheetTabs
            tabs={tabs}
            value={tab}
            label={LAB_UI.kindPost}
            onChange={(t) => {
              setTab(t);
              ctx.setInner('st', t === 'overview' ? null : t);
            }}
          />
        )
      }
    >
      {v && tab === 'overview' && <Overview v={v} />}
      {v && tab === 'transcript' && <Transcript v={v} />}
      {v && tab === 'frames' && <Frames v={v} />}
      {v && tab === 'metrics' && <Metrics v={v} />}
      {v && tab === 'comments' && <Comments v={v} />}
    </SheetShell>
  );
}
