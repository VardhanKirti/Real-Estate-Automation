'use client';
/**
 * Event sheet (01 15), Classic tree: the launch, its wave, the angle grid and its sources. 05's labels
 * render as given; Make this goes through 07's from_event; Not a launch through 05's dismiss. No Mute (D15).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { EventSheetUi } from '@/lib/lab/view/sheets/event';
import { fmtAge, fmtClock, fmtRatio } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, ConfirmDialog } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Tag } from '../parts';
import { Block, InnerTabs, type SheetCommon } from './common';
import { r2 } from '../geom';

function WaveChart({ posts }: { posts: EventSheetUi['data']['posts'] }) {
  const pts = posts.filter((p) => p.ratio !== null);
  if (!pts.length) return null;
  const maxH = Math.max(24, ...pts.map((p) => p.hoursSinceT0));
  const maxR = Math.max(3, ...pts.map((p) => p.ratio ?? 0));
  return (
    <figure className="lab2c-wave-fig">
    <figcaption className="lab2c-wave-cap" data-lab-ink="">{C.sheet.waveAxis}</figcaption>
    <div className="lab2c-wave" role="list">
      <span className="lab2c-wave-one" style={{ bottom: `${r2((1 / maxR) * 100)}%` }}>
        <span className="lab2c-wave-one-label" data-lab-ink="">{C.sheet.waveNormal}</span>
      </span>
      {pts.map((p) => (
        <Link
          key={p.postId}
          role="listitem"
          href={`?post=${p.postId}`}
          scroll={false}
          className="lab2c-wave-dot"
          data-pos={p.wavePosition}
          data-owned={p.isOwned ? '' : undefined}
          style={{ left: `${r2((Math.max(0, p.hoursSinceT0) / maxH) * 100)}%`, bottom: `${r2(((p.ratio ?? 0) / maxR) * 100)}%` }}
          aria-label={`${p.creator}, ${p.ratioLabel}`}
          title={`${p.creator}: ${p.hook}`}
          data-lab-shared={`wave-${p.postId}`}
        />
      ))}
    </div>
    <div className="lab2c-wave-x" data-lab-ink="" aria-hidden="true">
      <span>{C.sheet.waveLaunch}</span>
      <span>{fill(C.sheet.waveAfter, { age: fmtAge(maxH) })}</span>
    </div>
    </figure>
  );
}

export function EventSheet({ view, readOnly, setInner, st, onClose }: { view: EventSheetUi; onClose?: () => void } & SheetCommon) {
  const router = useRouter();
  const { post, busy } = useLabPost();
  const d = view.data;
  const [angle, setAngle] = useState(view.make.defaultAngle);
  const [dismiss, setDismiss] = useState(false);
  const [novelty, setNovelty] = useState(false);
  const make = async () => {
    const r = await post('/api/lab/ideas', { action: 'from_event', eventId: d.id, angle }, { key: 'make', refresh: false });
    if (r.ok && typeof r.data.href === 'string') router.push(r.data.href);
  };
  const makeDisabled = view.make.disabledReason ?? readOnly;
  return (
    <div className="lab2c-sheetbody">
      <div className="lab2c-idea-meta">
        <Tag tone="strong">{d.noveltyLabel}</Tag>
        {!readOnly && <button type="button" className="lab2c-linkbtn" onClick={() => setNovelty((n) => !n)} aria-expanded={novelty} data-lab-ink="">{C.sheet.change}</button>}
        <Tag>{d.classLabel}</Tag>
        <span className="lab2c-muted" data-lab-ink="">{view.stateText}</span>
      </div>
      {novelty && (
        <div className="lab2c-actrow">
          {view.noveltyOptions.map((n) => (
            <button key={n.id} type="button" className="lab2c-fchip" aria-current={d.novelty === n.id ? 'true' : undefined} onClick={async () => { await post('/api/lab/radar', { action: 'novelty', id: d.id, novelty: n.id }, { okText: C.sheet.tagChanged }); setNovelty(false); }}>{n.label}</button>
          ))}
        </div>
      )}
      <InnerTabs tabs={[{ id: 'wave', label: C.sheet.wave }, { id: 'angles', label: C.sheet.angles }, { id: 'sources', label: C.sheet.sources }]} st={st} setInner={setInner} label={C.sheetKind.event}>
        {(tab) => {
          if (tab === 'angles') {
            return (
              <div className="lab2c-angles">
                {d.angles.map((a) => (
                  <div key={a.angle} className="lab2c-angle" data-taken={a.taken ? '' : undefined} data-rec={a.angle === d.recommendedAngle ? '' : undefined}>
                    <span className="lab2c-angle-name" data-lab-ink="">{a.label}</span>
                    <span className="lab2c-muted" data-lab-ink="">
                      {a.taken ? `${C.sheet.taken} ${a.posts}` : C.sheet.openAngle}
                      {a.angle === d.recommendedAngle ? ` · ${C.sheet.recommended}` : ''}
                    </span>
                    <span className="lab2c-angle-ratio" data-lab-ink="">{a.medianRatio !== null && a.n >= 5 ? `${fmtRatio(a.medianRatio)} · n ${a.n}` : `${C.notEnough} · n ${a.n}`}</span>
                    {a.prior && <span className="lab2c-muted" data-lab-ink="">{fill(C.sheet.priorLine, { n: a.prior.n, lift: a.prior.lift })}</span>}
                  </div>
                ))}
              </div>
            );
          }
          if (tab === 'sources') {
            return (
              <ul className="lab2c-sources">
                {d.pings.map((p, i) => (
                  <li key={i}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="lab2c-source">
                      <span className="lab2c-ping lab2c-ping-static" data-family={p.family} data-lab-mark="" />
                      <span className="lab2c-source-title" data-lab-ink="">{p.title}</span>
                      <span className="lab2c-muted" data-lab-ink="">{`${p.reason} · ${fmtClock(p.at)}`}</span>
                    </a>
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <>
              <p className="lab2c-wave-summary" data-lab-ink="">{view.waveSummary}</p>
              {d.posts.length === 0 ? <p className="lab2c-muted" data-lab-ink="">{C.sheet.noCoverage}</p> : <WaveChart posts={d.posts} />}
              <p className="lab2c-muted" data-lab-ink="">{view.waveLiftPrior}</p>
              <p className="lab2c-muted" data-lab-ink="">{d.noveltyPrior}</p>
              {view.possibleMatches.length > 0 && (
                <Block title={C.sheet.possible}>
                  <ul className="lab2c-matches">
                    {view.possibleMatches.map((p) => (
                      <li key={p.postId}>
                        <span className="lab2c-match-text" data-lab-ink="">{`${p.creator}: ${p.hook}`}</span>
                        <span className="lab2c-actrow">
                          <Btn disabled={!!readOnly} onClick={() => void post('/api/lab/radar', { action: 'coverage', eventId: d.id, postId: p.postId, keep: true })}>{C.sheet.keep}</Btn>
                          <Btn disabled={!!readOnly} onClick={() => void post('/api/lab/radar', { action: 'coverage', eventId: d.id, postId: p.postId, keep: false })}>{C.sheet.notAbout}</Btn>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </>
          );
        }}
      </InnerTabs>

      <div className="lab2c-make">
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.sheet.angle}</span>
          <select className="lab2c-input" value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} disabled={!!makeDisabled}>
            {view.make.options.map((o) => <option key={o.id} value={o.id}>{o.recommended ? `${o.label} (${C.sheet.recommended})` : o.taken ? `${o.label} (${C.sheet.taken})` : o.label}</option>)}
          </select>
        </label>
        <Btn primary disabled={!!makeDisabled} title={makeDisabled ?? undefined} busy={busy === 'make'} onClick={() => void make()}>{busy === 'make' ? C.today.making : C.today.makeThis}</Btn>
        {d.actions.dismiss && <Btn disabled={!!readOnly} title={readOnly ?? undefined} onClick={() => setDismiss(true)}>{C.sheet.notLaunch}</Btn>}
      </div>
      {view.make.note && <p className="lab2c-muted" data-lab-ink="">{view.make.note}</p>}

      <ConfirmDialog
        open={dismiss}
        title={C.sheet.notLaunch}
        body={fill(C.sheet.dismissConfirm, { name: d.name })}
        confirmLabel={C.sheet.notLaunch}
        onClose={() => setDismiss(false)}
        onConfirm={async () => {
          setDismiss(false);
          const r = await post('/api/lab/radar', { action: 'dismiss', id: d.id, reason: 'Not a launch' });
          if (r.ok) onClose?.();
        }}
      />
    </div>
  );
}
