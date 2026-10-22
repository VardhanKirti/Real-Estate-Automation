'use client';
/**
 * Launch event sheet (`?event=`), GladOS tree (01 15). Every label is section 05's, rendered as given.
 * Wave: covering posts by hours since launch, ratio up the side (log), wave position as the mark.
 * Angles: 05's AngleCell grid; the recommended angle is 05's, never re-ranked here. Make this posts 07's
 * `from_event`; Not a launch posts 05's `dismiss` after a confirm. There is no Mute (D15).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GDialog, GSelect, useToast } from '@/components/g';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtClock, fmtRatio } from '@/lib/lab/view/format';
import type { EventSheetUi } from '@/lib/lab/view/sheets/event';
import type { AngleId } from '@/lib/lab/radar/angles';
import { SheetShell, SheetTabs, type SheetCtx } from './SheetShell';
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

type Tab = 'wave' | 'angles' | 'sources';
const FAMILY: Record<string, string> = { hn: 'HN', hf: 'Hugging Face', github: 'GitHub', vendor: 'Vendor', x: 'X', producthunt: 'Product Hunt', tiktok: 'TikTok' };

function WaveChart({ posts }: { posts: EventSheetUi['data']['posts'] }) {
  const rated = posts.filter((p) => p.ratio !== null);
  const W = 500;
  const H = 150;
  const maxH = Math.max(6, ...posts.map((p) => p.hoursSinceT0)) * 1.15;
  const ys = rated.map((p) => Math.log10(Math.max(0.1, p.ratio as number)));
  const lo = Math.min(-0.5, ...ys);
  const hi = Math.max(0.7, ...ys);
  const x = (h: number) => Math.round((8 + (Math.max(0, h) / maxH) * (W - 16)) * 10) / 10;
  const y = (r: number | null) => (r === null ? H - 10 : Math.round((10 + (1 - (Math.log10(Math.max(0.1, r)) - lo) / (hi - lo)) * (H - 20)) * 10) / 10);
  return (
    <svg className="lab2g-wave" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={LAB_UI.waveChartLabel} data-lab-mark="">
      <line x1="0" x2={W} y1={y(1)} y2={y(1)} className="lab2g-wave-one" />
      {posts.map((p) => (
        <circle key={p.postId} cx={x(p.hoursSinceT0)} cy={y(p.ratio)} r={p.isOwned ? 5 : 3.5} className="lab2g-wave-dot" data-pos={p.wavePosition} data-owned={p.isOwned ? '' : undefined} />
      ))}
    </svg>
  );
}

export function EventSheet({ ctx, view }: { ctx: SheetCtx; view: EventSheetUi | null | undefined }) {
  const initial = (typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('st') : null) as Tab | null;
  const [tab, setTab] = useState<Tab>(initial ?? 'wave');
  const [angle, setAngle] = useState<AngleId | null>(null);
  const [dismiss, setDismiss] = useState(false);
  const { post, busy } = useLabPost();
  const router = useRouter();
  const { toast } = useToast();
  const v = view ?? null;
  const d = v?.data;
  const chosen = angle ?? v?.make.defaultAngle ?? null;
  const make = async () => {
    if (!d || !chosen) return;
    const r = await post('/api/lab/ideas', { action: 'from_event', eventId: d.id, angle: chosen }, { key: 'make', refresh: false });
    if (r.ok && typeof r.data.href === 'string') {
      toast({ text: r.data.existing ? LAB_UI.ideaExists : fill(LAB_UI.ideaFromEvent, { name: d.name }), tone: 'ok' });
      router.push(r.data.href);
    }
  };
  const ro = ctx.frame.readOnly;
  return (
    <SheetShell
      kind="event"
      ctx={ctx}
      notFound={view === null}
      title={d ? d.name : undefined}
      caption={v ? [d?.noveltyLabel, d?.classLabel, v.stateText].filter(Boolean).join(' · ') : undefined}
      tabs={
        v && (
          <SheetTabs
            tabs={[
              { id: 'wave', label: LAB_UI.wave },
              { id: 'angles', label: LAB_UI.angles },
              { id: 'sources', label: LAB_UI.sources },
            ]}
            value={tab}
            label={LAB_UI.kindEvent}
            onChange={(t) => {
              setTab(t);
              ctx.setInner('st', t === 'wave' ? null : t);
            }}
          />
        )
      }
      footer={
        v &&
        d && (
          <div className="lab2g-sheetfoot">
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={ro || !d.actions.dismiss ? true : undefined} title={ro ?? undefined} onClick={() => !ro && d.actions.dismiss && setDismiss(true)}>
              <span data-lab-ink="">{LAB_UI.notALaunch}</span>
            </button>
            <span className="lab2g-grow" />
            <label className="lab2g-inline-field">
              <span className="lab2g-muted" data-lab-ink="">{LAB_UI.angle}</span>
              <GSelect value={chosen ?? ''} onChange={(e) => setAngle(e.target.value as AngleId)} options={v.make.options.map((o) => ({ value: o.id, label: `${o.label}${o.recommended ? `, ${LAB_UI.recommended}` : o.taken ? `, ${LAB_UI.takenWord}` : ''}` }))} />
            </label>
            <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={v.make.disabledReason ? true : undefined} title={v.make.disabledReason ?? undefined} onClick={() => !v.make.disabledReason && make()}>
              {busy === 'make' ? LAB_UI.making : LAB_UI.makeThis}
            </button>
          </div>
        )
      }
    >
      {v && d && tab === 'wave' && (
        <div className="lab2g-sheetbody">
          {d.posts.length ? <WaveChart posts={d.posts} /> : <p className="lab2g-text" data-lab-ink="">{LAB_UI.noCoverage}</p>}
          <p className="lab2-card-text" data-lab-ink="">{v.waveSummary}</p>
          <p className="lab2g-muted" data-lab-ink="">{v.waveLiftPrior}</p>
          {v.make.note && <p className="lab2g-muted" data-lab-ink="">{v.make.note}</p>}
          {v.possibleMatches.length > 0 && (
            <div className="lab2g-list">
              <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.possibleMatch}</span>
              {v.possibleMatches.map((p) => (
                <div key={p.postId} className="lab2g-matchrow">
                  <a data-g="LabLink" href={`?post=${p.postId}`} className="lab2g-rowlink" data-lab-shared={`event-post-${p.postId}`} data-lab-ink="">{`${p.creator}: ${p.hook}`}</a>
                  <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/radar', { action: 'coverage', eventId: d.id, postId: p.postId, keep: true }, { key: `keep-${p.postId}` })}>
                    <span data-lab-ink="">{LAB_UI.keep}</span>
                  </button>
                  <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/radar', { action: 'coverage', eventId: d.id, postId: p.postId, keep: false }, { key: `drop-${p.postId}` })}>
                    <span data-lab-ink="">{LAB_UI.notAboutThis}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <ul className="lab2g-rows">
            {d.posts.map((p) => (
              <li key={p.postId}>
                <a data-g="LabLink" href={`?post=${p.postId}`} className="lab2g-row" data-lab-shared={`wave-${p.postId}`}>
                  <span className="lab2g-row-main" data-lab-ink="">{p.hook}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{`${p.creator} · ${p.ratioLabel}`}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {v && d && tab === 'angles' && (
        <div className="lab2g-anglegrid">
          {d.angles.map((c) => (
            <div key={c.angle} className="lab2g-angle" data-taken={c.taken ? '' : undefined} data-rec={c.recommended ? '' : undefined}>
              <span className="lab2g-angle-name" data-lab-ink="">{c.label}</span>
              <span className="lab2g-angle-state" data-lab-ink="">
                {c.recommended ? LAB_UI.recommended : c.taken ? fill(LAB_UI.taken, { n: String(c.posts) }) : LAB_UI.openAngle}
              </span>
              <span className="lab2g-angle-num" data-lab-ink="">
                {c.n >= 5 && c.medianRatio !== null ? `${fmtRatio(c.medianRatio)}, n ${c.n}` : c.posts > 0 ? `${LAB_COPY.notEnough}, n ${c.n}` : ''}
              </span>
              {c.prior && <span className="lab2g-muted" data-lab-ink="">{fill(LAB_UI.anglePrior, { lift: c.prior.lift, n: String(c.prior.n) })}</span>}
            </div>
          ))}
        </div>
      )}
      {v && d && tab === 'sources' && (
        <ul className="lab2g-rows">
          {d.pings.map((p, i) => (
            <li key={i}>
              <a data-g="LabLink" href={p.url} target="_blank" rel="noopener noreferrer" className="lab2g-row">
                <span className="lab2g-row-main" data-lab-ink="">{p.title}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{`${FAMILY[p.family] ?? p.family} · ${fmtLabDay(p.at)} ${fmtClock(p.at)}`}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <GDialog
        open={dismiss}
        onClose={() => setDismiss(false)}
        title={LAB_UI.notALaunch}
        confirmLabel={LAB_UI.notALaunch}
        cancelLabel={LAB_UI.cancel}
        tone="danger"
        busy={busy === 'dismiss'}
        onConfirm={async () => {
          if (!d) return;
          const r = await post('/api/lab/radar', { action: 'dismiss', id: d.id, reason: 'Not a launch' }, { key: 'dismiss' });
          setDismiss(false);
          if (r.ok) ctx.onClose();
        }}
      >
        <p>{d ? fill(LAB_UI.dismissConfirm, { name: d.name }) : ''}</p>
      </GDialog>
    </SheetShell>
  );
}
