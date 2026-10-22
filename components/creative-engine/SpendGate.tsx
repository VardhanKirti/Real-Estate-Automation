'use client';

import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '@/components/ui/use-dialog';
import { useEscapeLayer } from '@/components/creative-engine/workflow/hooks';
import { fmtCredits, plural } from '@/lib/creative-engine/format';
import { OBtn } from '@/components/creative-engine/skin';

/**
 * The one cost confirmation for anything that spends Arcads credits (SPEC
 * §3.1.7, S05a X4/D3, S05b FR-58): the Motion console's Generate and probe,
 * and the workflow builder's Run. It always opens. It names what will be sent,
 * the balance and the session cap, and states the charge rule. It never
 * predicts a price: GladOS has no Arcads price table, so the most a line shows
 * is "last charged" history from the ledger, labelled as history (Q-WF-3).
 * In dry mode it says nothing is charged. When the server answers that the
 * session cap is reached, Confirm becomes "Pass the cap once".
 *
 * Two ways to describe the requests, one component:
 * - console: `items` (one ReactNode per line) and `session={{ spent, cap }}`;
 *   a `block` replaces Confirm with the reason and one button that fixes it.
 * - builder: `lines` (one entry per paid request, listed with a count heading),
 *   `sessionSpent` / `sessionCap`, optional `children`; `blocked` disables
 *   Confirm with the reason; `container` portals the gate (the builder sits
 *   under a transformed ancestor that would trap a fixed overlay).
 *
 * Renders inside `.ae-octane` (it reads the `--o-*` tokens). Dialog semantics
 * come from useDialog (X1): role="dialog", aria-modal, focus trap starting on
 * Cancel, focus returns to the opener. Escape closes it and only it.
 */

export type SpendBlock = { text: string; actionLabel?: string; onAction?: () => void };
export type SpendLine = { key: string; label: ReactNode; detail?: ReactNode; note?: ReactNode };

type BaseProps = {
  title: string;
  /** Dry mode: nothing is charged; the gate says so and drops the charge warning. */
  dry: boolean;
  /** Arcads credits remaining, or null when not read yet. */
  balance: number | null;
  /** The server refused for the session cap: the message, and Confirm becomes "Pass the cap once". */
  capAsk?: string | null;
  busy?: boolean;
  confirmLabel?: string;
  /** The extra line that warns about the charge; default is Arcads' charge-at-submit rule. */
  chargeNote?: string;
  /** Stable id for the Escape stack. */
  id?: string;
  onConfirm: (override: boolean) => void;
  onCancel: () => void;
};

export type ConsoleSpendProps = BaseProps & {
  /** What will be sent, one line each (model and shape, request count, uploads). */
  items: ReactNode[];
  session: { spent: number; cap: number };
  /** Why Confirm cannot run. When set, Confirm is not rendered. */
  block?: SpendBlock | null;
  /** An error from the last attempt, shown inside the gate. */
  error?: string | null;
};

export type BuilderSpendProps = BaseProps & {
  /** One entry per paid request. */
  lines: SpendLine[];
  /** The count line; default "N paid requests to Arcads". */
  heading?: ReactNode;
  /** Anything else worth saying before the money line (local steps, re-charge warnings). */
  children?: ReactNode;
  sessionSpent: number;
  sessionCap: number;
  /** A reason Confirm can't be pressed (nothing to run, a blocked scope). */
  blocked?: string | null;
  /** Portal target. */
  container: Element;
};

export type SpendGateProps = ConsoleSpendProps | BuilderSpendProps;

const CHARGE_NOTE = 'Arcads charges at submit. A content-check rejection is not refunded.';

export function SpendGate(props: SpendGateProps) {
  const { title, dry, balance, capAsk = null, busy = false, chargeNote = CHARGE_NOTE, onConfirm, onCancel } = props;
  const builder = 'lines' in props;
  const titleId = useId();
  const autoId = useId();
  const escapeId = props.id ?? (builder ? 'spend-gate' : `spend-gate${autoId}`);
  // Escape goes through the builder's layer helper, which stops the key there
  // so no other window listener closes its own layer on the same press.
  const dlg = useDialog({ open: true, onClose: onCancel, labelledBy: titleId, id: escapeId, lockScroll: false, closeOnEscape: false });
  useEscapeLayer(true, escapeId, onCancel);

  const spent = builder ? props.sessionSpent : props.session.spent;
  const cap = builder ? props.sessionCap : props.session.cap;
  const capState = cap > 0 && spent >= cap ? 'over' : cap > 0 && spent >= cap * 0.8 ? 'warn' : 'ok';
  const block = builder ? null : props.block ?? null;
  const blocked = builder ? props.blocked ?? null : null;
  const error = builder ? null : props.error ?? null;
  const n = builder ? props.lines.length : 0;
  const label = props.confirmLabel ?? (dry ? 'Run dry' : `Confirm${n > 1 ? ` ×${n}` : ''}`);

  const panel = (
    <div className="ae-o-gate" onClick={onCancel}>
      <div {...dlg.props} className={`ae-o-panel ae-o-spend ae-o-spendgate w-full ${builder ? 'max-w-[480px]' : 'max-w-[460px]'} p-6`} data-dry={dry} onClick={(e) => e.stopPropagation()}>
        <div id={titleId} className="flex items-center gap-2 text-[16px] font-medium">
          {builder && dry ? `Dry run · ${title}` : title}
          {!builder && dry && <span className="ae-o-pill" data-display-only="mode" title="Dry run: nothing is sent to Arcads and no credits are charged">Dry run</span>}
        </div>
        {builder && (<>
          <div className="mt-3 text-[13px]">{props.heading ?? <><b>{plural(n, 'paid request')}</b> to Arcads</>}</div>
          {n > 0 && (
            <ul className="ae-o-spend-list" aria-label="Requests">
              {props.lines.map((l) => (<li key={l.key}><span className="t">{l.label}</span>{l.detail && <span className="d">{l.detail}</span>}{l.note && <span className="nt">{l.note}</span>}</li>))}
            </ul>
          )}
          {props.children}
        </>)}
        <ul className={`${builder ? 'mt-3' : 'mt-4'} space-y-1.5 text-[13px] text-[var(--o-muted)]`}>
          {!builder && props.items.map((it, i) => <li key={i}>{it}</li>)}
          {(!dry || !builder) && (
            <li>
              Balance <span className="text-[var(--o-text)]">{dry ? 'dry run' : balance != null ? `${fmtCredits(balance)} credits` : 'not read yet'}</span>, session{' '}
              <span data-cap={capState}>{fmtCredits(spent)} of {fmtCredits(cap)}</span>{builder ? '' : '. Prices are never predicted; the charge is read after delivery.'}
            </li>
          )}
          {dry
            ? <li>No credits will be charged. {builder ? 'Paid nodes' : 'Requests'} resolve with placeholder outputs.</li>
            : <li className="ae-o-spend-warn">{chargeNote}</li>}
        </ul>
        {block && (
          <div className="ae-o-gate-block mt-4 rounded-[10px] p-3 text-[12.5px]" role="status">
            <span>{block.text}.</span>
            {block.actionLabel && block.onAction && <OBtn kind="link" cls="ae-o-linkbtn ml-2" keep="ml-2"  onClick={block.onAction}>{block.actionLabel}</OBtn>}
          </div>
        )}
        {capAsk && <div className="ae-o-shake ae-o-spend-cap mt-3 rounded-[10px] p-3 text-[12.5px]" role="alert">{capAsk}</div>}
        {error && !capAsk && <div className="ae-o-shake mt-3 text-[12.5px] text-[var(--o-red-text)]">{error}</div>}
        {blocked && <div className="ae-o-spend-blocked mt-3 text-[12.5px]" role="status">{blocked}</div>}
        <div className="mt-5 flex justify-end gap-3">
          <OBtn kind="pill" cls="ae-o-pill" data-dialog-close data-cancel onClick={onCancel} >Cancel</OBtn>
          {!block && (
            <OBtn kind="primary" cls="ae-o-generate" onClick={() => onConfirm(!!capAsk)} disabled={busy || !!blocked}  data-busy={busy}>
              <i /> {busy ? (builder ? 'Starting' : 'Sending') : capAsk ? 'Pass the cap once' : label}
            </OBtn>
          )}
        </div>
      </div>
    </div>
  );
  return builder ? createPortal(panel, props.container) : panel;
}
