'use client';
/**
 * The idea (01 16): the Idea sheet body and Studio's selected-idea column, Classic tree. Reads 01's
 * IdeaSheetUi; 07's IdeaSheetView rides unchanged in `data`. No virality score anywhere.
 */
import Link from 'next/link';
import { useState } from 'react';
import { openWizard, type WizardOpenDetail } from '@/lib/wizard-dock';
import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { Btn, Dialog } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Tag } from '../parts';
import { Strand } from '../viz';
import { Block, type SheetCommon } from './common';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

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
    <div className="lab2c-actrow">
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
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.dialog.reason}</span>
          <select className="lab2c-input" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus="">
            {DISMISS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {reason === 'Other' && <input className="lab2c-input lab2c-gap-s" value={other} maxLength={120} onChange={(e) => setOther(e.target.value)} aria-label={C.dialog.reason} />}
      </Dialog>
    </div>
  );
}

export function IdeaBody({ view, readOnly, inSheet }: { view: IdeaSheetUi; readOnly: string | null; inSheet?: boolean }) {
  const d = view.data;
  const p = view.prediction;
  return (
    <div className="lab2c-idea">
      <div className="lab2c-idea-meta">
        <Tag tone="strong">{view.angleLabel}</Tag>
        {view.event && (
          <Link href={view.event.href} scroll={false} className="lab2c-tag-link" data-lab-shared={`ev-${view.event.id}`}>
            <Tag>{`${view.event.name} · ${view.event.stateText}`}</Tag>
          </Link>
        )}
        {view.windowText && !view.event && <Tag tone="quiet">{view.windowText}</Tag>}
        <span className="lab2c-muted" data-lab-ink="">{d.familyLabel}</span>
      </div>

      {d.tension && (
        <dl className="lab2c-tension">
          <div>
            <dt className="lab2c-kv-k" data-lab-ink="">{C.studio.peopleThink}</dt>
            <dd className="lab2c-tension-text" data-lab-ink="">{d.tension.falseBelief}</dd>
          </div>
          <div>
            <dt className="lab2c-kv-k" data-lab-ink="">{C.studio.actually}</dt>
            <dd className="lab2c-tension-text" data-lab-ink="">{d.tension.reframe}</dd>
          </div>
        </dl>
      )}

      {d.strand && (
        <Block title={C.studio.targetShape}>
          <Strand strand={d.strand} label={C.studio.targetShape} tall />
        </Block>
      )}

      <Block title={C.studio.prediction}>
        <p className="lab2c-pred" data-lab-ink="">
          {p.state === 'no_script' && C.studio.noScript}
          {p.state === 'hidden' && p.chip?.hiddenReason}
          {p.state === 'shown' && p.chip?.text}
          {p.state === 'not_built' && view.groundingText}
        </p>
        {p.state === 'shown' && p.chip?.record && <span className="lab2c-muted" data-lab-ink="">{p.chip.record}</span>}
      </Block>

      {d.hookRecs.length > 0 && (
        <Block title={C.studio.hookRecs}>
          <ul className="lab2c-hookrecs">
            {d.hookRecs.map((h, i) => (
              <li key={i}>
                <span data-lab-ink="">{`${h.formLabel} · ${h.triggerLabel}`}</span>
                <span className="lab2c-muted" data-lab-ink="">{h.enough && h.liftText ? `${h.liftText} · n ${h.n}` : `${C.notEnough} · n ${h.n}`}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {d.variants.state === 'ready' && d.variants.items.length > 0 && (
        <Block title={C.studio.variants}>
          <ul className="lab2c-variants">
            {d.variants.items.map((v) => (
              <li key={v.id}>
                <span className="lab2c-variant-hook" data-lab-ink="">{v.hook}</span>
                <span className="lab2c-muted" data-lab-ink="">{v.whyText}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title={C.studio.grounding}>
        <p className="lab2c-muted" data-lab-ink="">{view.groundingText}</p>
        <div className="lab2c-ground" data-sheet={inSheet ? '' : undefined}>
          {d.evidence.slice(0, 6).map((e) => (
            <Link key={e.postId} href={`?post=${e.postId}`} scroll={false} className="lab2c-ground-card" data-lab-shared={`ground-${e.postId}`}>
              <span className="lab2c-ground-hook" data-lab-ink="">{e.card.hookText}</span>
              <span className="lab2c-ground-foot" data-lab-ink="">
                <span>{e.card.creator.displayName}</span>
                <span className="lab2c-ground-num">{e.card.ladder.text ?? ''}</span>
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
    <div className="lab2c-sheetbody">
      <IdeaBody view={view} readOnly={readOnly} inSheet />
      <IdeaActions view={view} readOnly={readOnly} />
    </div>
  );
}
