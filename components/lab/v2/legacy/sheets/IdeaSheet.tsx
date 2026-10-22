'use client';
/**
 * The idea (01 16) under Bennett Legacy: the Idea sheet body and Studio's selected-idea column. Reads 01's
 * IdeaSheetUi; 07's IdeaSheetView rides unchanged in `data`. No virality score anywhere. Two variants show
 * as a hook pair of SlabCards side by side (pages/lab.md Studio).
 */
import Link from 'next/link';
import { useState } from 'react';
import { openWizard, type WizardOpenDetail } from '@/lib/wizard-dock';
import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { Dialog, Field } from '../dialogs';
import { Btn, Tag } from '../parts';
import { Strand } from '../viz';
import { LEGACY_LAB as L } from '../copy';
import { Block, type SheetCommon } from './common';

const DISMISS_REASONS = C.studio.dismissReasons;

export function IdeaActions({ view, readOnly }: { view: IdeaSheetUi; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [dismiss, setDismiss] = useState(false);
  const [reason, setReason] = useState(DISMISS_REASONS[0]);
  const [other, setOther] = useState('');
  const d = view.data;
  const a = view.actions;
  const openScript = (id: string) => {
    const u = new URL(window.location.href);
    u.searchParams.delete('idea');
    u.searchParams.set('script', id);
    openSheetHref(u.pathname + u.search);
  };
  const write = async () => {
    if (d.scriptId) return openScript(d.scriptId);
    const r = await post('/api/lab/ideas', { id: d.id, action: 'write_script' }, { key: 'write', refresh: false });
    if (r.ok && typeof r.data.scriptId === 'string') openScript(r.data.scriptId);
  };
  const act = (action: string, okText?: string, extra: Record<string, unknown> = {}) => post('/api/lab/ideas', { id: d.id, action, ...extra }, { key: action, okText });
  const writeDisabled = !d.scriptId && (a.writeScript.disabledReason ?? readOnly);
  return (
    <div data-l="LabActions" className="l-lab-actrow">
      <Btn primary onClick={() => void write()} disabled={!!writeDisabled} title={writeDisabled || undefined} busy={busy === 'write'} data-lab-shared={`write-${d.id}`}>
        {busy === 'write' ? C.today.writing : a.writeScript.label}
      </Btn>
      <Btn onClick={() => void act('send_engine')} disabled={!!(a.sendEngine.disabledReason ?? readOnly)} title={a.sendEngine.disabledReason ?? readOnly ?? undefined}>{C.studio.sendEngine}</Btn>
      <Btn
        onClick={async () => {
          const r = await act('ask_wizard');
          if (r.ok && r.data.wizard && typeof r.data.wizard === 'object') openWizard(r.data.wizard as WizardOpenDetail);
        }}
        disabled={!!(a.askWizard.disabledReason ?? readOnly)}
        title={a.askWizard.disabledReason ?? readOnly ?? undefined}
      >
        {C.studio.askWizard}
      </Btn>
      {a.markUsed && <Btn onClick={() => void act('used')} disabled={!!readOnly} title={readOnly ?? undefined}>{C.studio.markUsed}</Btn>}
      {a.reopen && <Btn onClick={() => void act('reopen')} disabled={!!readOnly} title={readOnly ?? undefined}>{C.studio.reopen}</Btn>}
      {a.dismiss && <Btn onClick={() => setDismiss(true)} disabled={!!readOnly} title={readOnly ?? undefined}>{C.studio.dismiss}</Btn>}
      <Dialog
        open={dismiss}
        onClose={() => setDismiss(false)}
        title={C.studio.dismiss}
        footer={
          <>
            <Btn onClick={() => setDismiss(false)}>{C.dialog.cancel}</Btn>
            <Btn primary onClick={async () => { await act('dismiss', undefined, { reason: reason === 'Other' ? other || reason : reason }); setDismiss(false); }}>{C.studio.dismiss}</Btn>
          </>
        }
      >
        <Field label={C.dialog.reason}>
          <select className="l-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {DISMISS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        {reason === 'Other' && <input className="l-input l-lab-gap" value={other} maxLength={120} onChange={(e) => setOther(e.target.value)} aria-label={C.dialog.reason} />}
      </Dialog>
    </div>
  );
}

export function IdeaBody({ view, inSheet }: { view: IdeaSheetUi; readOnly: string | null; inSheet?: boolean }) {
  const d = view.data;
  const p = view.prediction;
  const pair = d.variants.state === 'ready' ? d.variants.items.slice(0, 2) : [];
  const rest = d.variants.state === 'ready' ? d.variants.items.slice(2) : [];
  return (
    <div data-l="LabIdea" className="l-lab-idea">
      <div className="l-chip-row">
        <Tag tone="strong">{view.angleLabel}</Tag>
        {view.event && (
          <Link href={view.event.href} scroll={false} className="l-lab-taglink" data-lab-shared={`ev-${view.event.id}`}>
            <Tag>{`${view.event.name} · ${view.event.stateText}`}</Tag>
          </Link>
        )}
        {view.windowText && !view.event && <Tag tone="quiet">{view.windowText}</Tag>}
        <span className="l-muted">{d.familyLabel}</span>
      </div>

      {d.tension && (
        <dl className="l-lab-tension">
          <div>
            <dt className="l-micro">{C.studio.peopleThink}</dt>
            <dd>{d.tension.falseBelief}</dd>
          </div>
          <div>
            <dt className="l-micro">{C.studio.actually}</dt>
            <dd>{d.tension.reframe}</dd>
          </div>
        </dl>
      )}

      {d.strand && (
        <Block title={C.studio.targetShape}>
          <Strand strand={d.strand} label={C.studio.targetShape} tall />
        </Block>
      )}

      {pair.length > 0 && (
        <Block title={pair.length === 2 ? L.hookPair : C.studio.variants}>
          <div className="l-lab-pair" data-l="HookPair">
            {pair.map((v, i) => (
              <section key={v.id} data-l="SlabCard" className="l-card l-lab-paircard">
                <span className="l-micro">{String.fromCharCode(65 + i)}</span>
                <p className="l-lab-paircard-hook">{v.hook}</p>
                <p className="l-body-text">{v.whyText}</p>
              </section>
            ))}
          </div>
          {rest.length > 0 && (
            <ul className="l-lab-list">
              {rest.map((v) => (
                <li key={v.id}>
                  <span>{v.hook}</span>
                  <span className="l-muted">{v.whyText}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}

      <Block title={C.studio.prediction}>
        <p className="l-lab-pred">
          {p.state === 'no_script' && C.studio.noScript}
          {p.state === 'hidden' && p.chip?.hiddenReason}
          {p.state === 'shown' && p.chip?.text}
          {p.state === 'not_built' && view.groundingText}
        </p>
        {p.state === 'shown' && p.chip?.record && <span className="l-muted">{p.chip.record}</span>}
      </Block>

      {d.hookRecs.length > 0 && (
        <Block title={C.studio.hookRecs}>
          <ul className="l-lab-list">
            {d.hookRecs.map((h, i) => (
              <li key={i}>
                <span>{`${h.formLabel} · ${h.triggerLabel}`}</span>
                <span className="l-num">{h.enough && h.liftText ? `${h.liftText} · n ${h.n}` : `${C.notEnough} · n ${h.n}`}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title={C.studio.grounding}>
        <p className="l-body-text">{view.groundingText}</p>
        <div className="l-lab-ground" data-sheet={inSheet ? '' : undefined}>
          {d.evidence.slice(0, 6).map((e) => (
            <Link key={e.postId} href={`?post=${e.postId}`} scroll={false} data-l="Pressable" data-lens="r" className="l-pressable is-row l-lab-ground-card" data-lab-shared={`ground-${e.postId}`}>
              <span className="l-lab-ground-hook">{e.card.hookText}</span>
              <span className="l-lab-ground-foot">
                <span>{e.card.creator.displayName}</span>
                <span className="l-num">{e.card.ladder.text ?? ''}</span>
              </span>
            </Link>
          ))}
        </div>
      </Block>
    </div>
  );
}

export function IdeaSheet({ view, readOnly }: { view: IdeaSheetUi } & SheetCommon) {
  return (
    <div data-l="LabIdeaSheet" className="l-lab-sheetbody">
      <IdeaBody view={view} readOnly={readOnly} inSheet />
      <IdeaActions view={view} readOnly={readOnly} />
    </div>
  );
}
