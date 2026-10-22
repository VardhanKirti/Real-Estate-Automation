'use client';
/**
 * Event sheet (01 15) under Bennett Legacy: the launch, its wave, the angle map (a monochrome scatter with
 * square markers, pages/lab.md) and its sources. 05's labels render as given; Make this goes through 07's
 * from_event, Not a launch through 05's dismiss. No Mute (D15).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { EventSheetUi } from '@/lib/lab/view/sheets/event';
import { fmtAge, fmtClock, fmtRatio } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { ConfirmDialog, Field } from '../dialogs';
import { Btn, ChipButton, Tag } from '../parts';
import { AngleMap } from '../viz';
import { LEGACY_LAB as L } from '../copy';
import { r2 } from '../../classic/geom';
import { Block, InnerTabs, type SheetCommon } from './common';

/** Covering posts: when each went up after launch, and how it did against its creator's normal. Square markers, yours filled. */
function WaveChart({ posts }: { posts: EventSheetUi['data']['posts'] }) {
  const pts = posts.filter((p) => p.ratio !== null);
  if (!pts.length) return null;
  const maxH = Math.max(24, ...pts.map((p) => p.hoursSinceT0));
  const maxR = Math.max(3, ...pts.map((p) => p.ratio ?? 0));
  return (
    <figure data-l="LabWave" className="l-lab-wave-fig">
      <figcaption className="l-body-text">{C.sheet.waveAxis}</figcaption>
      <div className="l-lab-wave" role="list">
        <span className="l-lab-wave-one" style={{ bottom: `${r2((1 / maxR) * 100)}%` }}>
          <span className="l-lab-wave-one-label">{C.sheet.waveNormal}</span>
        </span>
        {pts.map((p) => (
          <Link
            key={p.postId}
            role="listitem"
            href={`?post=${p.postId}`}
            scroll={false}
            className="l-lab-wave-pt"
            data-owned={p.isOwned ? '' : undefined}
            style={{ left: `${r2((Math.max(0, p.hoursSinceT0) / maxH) * 100)}%`, bottom: `${r2(((p.ratio ?? 0) / maxR) * 100)}%` }}
            aria-label={`${p.creator}, ${p.ratioLabel}`}
            title={`${p.creator}: ${p.hook}`}
            data-lab-shared={`wave-${p.postId}`}
          />
        ))}
      </div>
      <div className="l-axis" aria-hidden="true">
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
    <div data-l="LabEventSheet" className="l-lab-sheetbody">
      <div className="l-chip-row">
        <Tag tone="strong">{d.noveltyLabel}</Tag>
        {!readOnly && <Btn onClick={() => setNovelty((n) => !n)} aria-expanded={novelty}>{C.sheet.change}</Btn>}
        <Tag>{d.classLabel}</Tag>
        <span className="l-muted">{view.stateText}</span>
      </div>
      {novelty && (
        <div className="l-chip-row">
          {view.noveltyOptions.map((n) => (
            <ChipButton key={n.id} on={d.novelty === n.id} onClick={async () => { await post('/api/lab/radar', { action: 'novelty', id: d.id, novelty: n.id }, { okText: C.sheet.tagChanged }); setNovelty(false); }}>{n.label}</ChipButton>
          ))}
        </div>
      )}
      <InnerTabs tabs={[{ id: 'wave', label: C.sheet.wave }, { id: 'angles', label: C.sheet.angles }, { id: 'sources', label: C.sheet.sources }]} st={st} setInner={setInner} label={C.sheetKind.event}>
        {(tab) => {
          if (tab === 'angles') {
            return (
              <>
                <Block title={L.angleMap}>
                  <p className="l-body-text">{L.angleMapSub}</p>
                  <AngleMap cells={d.angles} recommended={d.recommendedAngle} label={L.angleMap} axis={{ x: L.angleAxisX, y: L.angleAxisY }} />
                </Block>
                <ul className="l-lab-rows">
                  {d.angles.map((a) => (
                    <li key={a.angle} className="l-lab-anglerow" data-taken={a.taken ? '' : undefined} data-rec={a.angle === d.recommendedAngle ? '' : undefined}>
                      <span className="l-lab-anglerow-name">{a.label}</span>
                      <span className="l-muted">{`${a.taken ? `${C.sheet.taken} ${a.posts}` : C.sheet.openAngle}${a.angle === d.recommendedAngle ? ` · ${C.sheet.recommended}` : ''}`}</span>
                      <span className="l-num">{a.medianRatio !== null && a.n >= 5 ? `${fmtRatio(a.medianRatio)} · n ${a.n}` : `${C.notEnough} · n ${a.n}`}</span>
                      {a.prior && <span className="l-muted l-lab-anglerow-prior">{fill(C.sheet.priorLine, { n: a.prior.n, lift: a.prior.lift })}</span>}
                    </li>
                  ))}
                </ul>
              </>
            );
          }
          if (tab === 'sources') {
            return (
              <ul className="l-lab-rows">
                {d.pings.map((p, i) => (
                  <li key={i}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-source">
                      <span className="l-lab-ping is-static" data-family={p.family} aria-hidden />
                      <span className="l-lab-source-title">{p.title}</span>
                      <span className="l-muted">{`${p.reason} · ${fmtClock(p.at)}`}</span>
                    </a>
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <>
              <p className="l-lab-lead">{view.waveSummary}</p>
              {d.posts.length === 0 ? <p className="l-body-text">{C.sheet.noCoverage}</p> : <WaveChart posts={d.posts} />}
              <p className="l-body-text">{view.waveLiftPrior}</p>
              <p className="l-body-text">{d.noveltyPrior}</p>
              {view.possibleMatches.length > 0 && (
                <Block title={C.sheet.possible}>
                  <ul className="l-lab-rows">
                    {view.possibleMatches.map((p) => (
                      <li key={p.postId} className="l-lab-match">
                        <span>{`${p.creator}: ${p.hook}`}</span>
                        <span className="l-lab-actrow">
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

      <div data-l="LabMake" className="l-lab-make">
        <Field label={C.sheet.angle}>
          <select className="l-select" value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} disabled={!!makeDisabled}>
            {view.make.options.map((o) => <option key={o.id} value={o.id}>{o.recommended ? `${o.label} (${C.sheet.recommended})` : o.taken ? `${o.label} (${C.sheet.taken})` : o.label}</option>)}
          </select>
        </Field>
        <Btn primary disabled={!!makeDisabled} title={makeDisabled ?? undefined} busy={busy === 'make'} onClick={() => void make()}>{busy === 'make' ? C.today.making : C.today.makeThis}</Btn>
        {d.actions.dismiss && <Btn disabled={!!readOnly} title={readOnly ?? undefined} onClick={() => setDismiss(true)}>{C.sheet.notLaunch}</Btn>}
      </div>
      {view.make.note && <p className="l-body-text">{view.make.note}</p>}

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
