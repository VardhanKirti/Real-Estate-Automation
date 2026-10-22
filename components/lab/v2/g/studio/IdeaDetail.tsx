'use client';
/**
 * One idea, GladOS tree (01 16): angle and launch, the tension as two lines, target shape, the
 * prediction block (never a score: only 06's chip text, or its hidden reason alone), hook
 * recommendations with n, variants, and the grounding posts. Used as the Idea sheet body and as
 * Studio's selected-idea column (D5). Actions post to the v1 and 07 idea routes.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GDialog, GField, GInput, GSelect, useToast } from '@/components/g';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { openWizard, type WizardOpenDetail } from '@/lib/wizard-dock';
import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import { Chip } from '../bits';
import { PostCard } from '../PostCard';
import { StrandBar } from '../Strand';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const DISMISS = ['Not my angle', 'Already covered', 'Window closed', 'Other'];

export function IdeaBody({ ui }: { ui: IdeaSheetUi }) {
  const d = ui.data;
  return (
    <div className="lab2g-idea">
      <div className="lab2g-idea-meta">
        <Chip>{ui.angleLabel}</Chip>
        {ui.event && (
          <a data-g="LabLink" href={ui.event.href} className="lab2-chip lab2g-chiplink" data-lab-ink="" data-lab-shared={`idea-event-${ui.event.id}`}>
            {`${ui.event.name} · ${ui.event.stateText}`}
          </a>
        )}
        <Chip>{d.familyLabel}</Chip>
        {ui.windowText && <Chip>{ui.windowText}</Chip>}
      </div>
      {d.tension && (
        <dl className="lab2g-tension">
          <dt data-lab-ink="">{LAB_UI.peopleThink}</dt>
          <dd data-lab-ink="">{d.tension.falseBelief}</dd>
          <dt data-lab-ink="">{LAB_UI.actually}</dt>
          <dd data-lab-ink="">{d.tension.reframe}</dd>
        </dl>
      )}
      {d.strand && (
        <div className="lab2g-block">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.targetShape}</span>
          <StrandBar strand={d.strand} />
        </div>
      )}
      <div className="lab2g-block">
        <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.prediction}</span>
        <p className="lab2-card-text" data-lab-ink="">
          {ui.prediction.state === 'shown'
            ? [ui.prediction.chip?.text, ui.prediction.chip?.record].filter(Boolean).join(' · ')
            : ui.prediction.state === 'hidden'
              ? ui.prediction.chip?.hiddenReason
              : ui.prediction.state === 'not_built'
                ? LAB_COPY.layer.ledger
                : LAB_UI.noScriptPrediction}
        </p>
      </div>
      {d.hookRecs.length > 0 && (
        <div className="lab2g-block">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.hookRecs}</span>
          <ul className="lab2g-rows lab2g-rows-flat">
            {d.hookRecs.map((h) => (
              <li key={`${h.form}-${h.trigger}`} className="lab2g-row lab2g-row-static">
                <span className="lab2g-row-main" data-lab-ink="">{`${h.formLabel}, ${h.triggerLabel}`}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{h.enough && h.liftText ? `${h.liftText} · n ${h.n}` : `${LAB_COPY.notEnough} · n ${h.n}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.variants.state === 'ready' && d.variants.items.length > 0 && (
        <div className="lab2g-block">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.variants}</span>
          <ul className="lab2g-rows lab2g-rows-flat">
            {d.variants.items.map((x) => (
              <li key={x.id} className="lab2g-row lab2g-row-static">
                <span className="lab2g-row-main" data-lab-ink="">{x.hook}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{x.whyText}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.variants.state === 'not_built' && <p className="lab2g-muted" data-lab-ink="">{LAB_COPY.layer.gen}</p>}
      <div className="lab2g-block">
        <span className="lab2-stat-label" data-lab-ink="">{ui.groundingText}</span>
        <div className="lab2g-cardgrid lab2g-cardgrid-3">
          {d.evidence.slice(0, 6).map((e) => (
            <PostCard key={e.postId} card={e.card} sharedPrefix="ground" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Write script, Creative Engine, Wizard, Dismiss, Mark used, Reopen. */
export function IdeaActions({ ui }: { ui: IdeaSheetUi }) {
  const d = ui.data;
  const a = ui.actions;
  const { post, busy } = useLabPost();
  const router = useRouter();
  const { toast } = useToast();
  const [dismiss, setDismiss] = useState(false);
  const [reason, setReason] = useState(DISMISS[0]);
  const [other, setOther] = useState('');
  const write = async () => {
    if (d.scriptId) {
      router.push(`?script=${d.scriptId}`, { scroll: false });
      return;
    }
    const r = await post('/api/lab/ideas', { id: d.id, action: 'write_script' }, { key: 'write', refresh: false });
    if (r.ok && typeof r.data.scriptId === 'string') router.push(`?script=${r.data.scriptId}`, { scroll: false });
  };
  return (
    <div className="lab2g-sheetfoot lab2g-ideaactions">
      {a.dismiss && (
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => setDismiss(true)}>
          <span data-lab-ink="">{LAB_UI.dismiss}</span>
        </button>
      )}
      {a.markUsed && (
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/ideas', { id: d.id, action: 'used' }, { key: 'used', okText: LAB_UI.markedUsed })}>
          <span data-lab-ink="">{LAB_UI.markUsed}</span>
        </button>
      )}
      {a.reopen && (
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => post('/api/lab/ideas', { id: d.id, action: 'reopen' }, { key: 'reopen', okText: LAB_UI.reopened })}>
          <span data-lab-ink="">{LAB_UI.reopen}</span>
        </button>
      )}
      <span className="lab2g-grow" />
      <button data-g="LabButton"
        type="button"
        className="lab2-pill lab2-seeall"
        aria-disabled={a.askWizard.disabledReason ? true : undefined}
        title={a.askWizard.disabledReason ?? undefined}
        onClick={async () => {
          if (a.askWizard.disabledReason) return;
          const r = await post('/api/lab/ideas', { id: d.id, action: 'ask_wizard' }, { key: 'wizard', refresh: false });
          if (r.ok && r.data.wizard && typeof r.data.wizard === 'object') openWizard(r.data.wizard as WizardOpenDetail);
        }}
      >
        <span data-lab-ink="">{LAB_UI.askWizard}</span>
      </button>
      <button data-g="LabButton"
        type="button"
        className="lab2-pill lab2-seeall"
        aria-disabled={a.sendEngine.disabledReason ? true : undefined}
        title={a.sendEngine.disabledReason ?? undefined}
        onClick={async () => {
          if (a.sendEngine.disabledReason) return;
          const r = await post('/api/lab/ideas', { id: d.id, action: 'send_engine' }, { key: 'engine', refresh: false });
          if (r.ok) toast({ text: LAB_UI.sentEngine, tone: 'ok', action: { label: LAB_UI.openWord, onClick: () => router.push('/creative-engine') } });
        }}
      >
        <span data-lab-ink="">{LAB_UI.sendEngine}</span>
      </button>
      <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={a.writeScript.disabledReason ? true : undefined} title={a.writeScript.disabledReason ?? undefined} onClick={() => !a.writeScript.disabledReason && write()} data-lab-shared={`idea-script-${d.id}`}>
        {busy === 'write' ? LAB_UI.writing : a.writeScript.label}
      </button>
      <GDialog
        open={dismiss}
        onClose={() => setDismiss(false)}
        title={LAB_UI.dismissTitle}
        confirmLabel={LAB_UI.dismiss}
        cancelLabel={LAB_UI.cancel}
        busy={busy === 'dismiss'}
        onConfirm={async () => {
          const r = await post('/api/lab/ideas', { id: d.id, action: 'dismiss', reason: reason === 'Other' ? other.trim() || 'Other' : reason }, { key: 'dismiss', okText: LAB_UI.dismissed });
          if (r.ok) setDismiss(false);
        }}
      >
        <GField label={LAB_UI.outsideReason} htmlFor="lab2g-dismiss">
          <GSelect id="lab2g-dismiss" value={reason} onChange={(e) => setReason(e.target.value)} options={DISMISS.map((x) => ({ value: x, label: x }))} />
        </GField>
        {reason === 'Other' && <GInput aria-label={LAB_UI.outsideReason} value={other} onChange={(e) => setOther(e.target.value)} />}
      </GDialog>
    </div>
  );
}
