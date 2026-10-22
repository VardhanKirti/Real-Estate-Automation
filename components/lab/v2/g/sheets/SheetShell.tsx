'use client';
/**
 * The common sheet chrome of the GladOS tree (01 13): the shared Sheet (02 13, the FLIP), Copy link in
 * the header, inner tabs as a Segmented tablist that mirrors `st` with replaceState, a body skeleton
 * while the sheet loads, the error line with Try again, and the not-found copy with Close.
 */
import type { ReactNode } from 'react';
import { useToast } from '@/components/g';
import { Segmented, Sheet } from '@/components/lab/v2/shared';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetKind } from '@/lib/lab/view/shared';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

export type SheetCtx = {
  open: boolean;
  onClose: () => void;
  originId: string | null;
  loading: boolean;
  error: string | null;
  title: string | null;
  reload: () => void;
  setInner: (key: 'st' | 'ver', value: string | null) => void;
  frame: LabFrameView;
};

export const KIND_LABEL: Record<SheetKind, string> = {
  post: LAB_UI.kindPost,
  event: LAB_UI.kindEvent,
  idea: LAB_UI.kindIdea,
  script: LAB_UI.kindScript,
  test: LAB_UI.kindTest,
  setup: LAB_UI.kindSetup,
  ask: LAB_UI.kindAsk,
};

export function CopyLink() {
  const { toast } = useToast();
  return (
    <button data-g="LabButton"
      type="button"
      className="lab2-pill lab2-seeall lab2g-copylink"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href).then(
          () => toast({ text: LAB_COPY.linkCopied, tone: 'ok' }),
          () => toast({ text: window.location.href, tone: 'info' }),
        );
      }}
    >
      <span data-lab-ink="">{LAB_UI.copyLink}</span>
    </button>
  );
}

export function SheetTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return <Segmented options={tabs} value={value} onChange={onChange} label={label} controls="lab2g-sheet-panel" />;
}

export function SheetSkeleton() {
  return (
    <div className="lab2g-sheet-skel" aria-hidden="true">
      <span className="lab2-skel" style={{ width: '70%', height: 28 }} />
      <span className="lab2-skel" style={{ width: '40%', height: 44 }} />
      <span className="lab2-skel" style={{ width: '100%', height: 120 }} />
      <span className="lab2-skel" style={{ width: '85%', height: 18 }} />
      <span className="lab2-skel" style={{ width: '60%', height: 18 }} />
    </div>
  );
}

export function SheetShell({
  kind,
  ctx,
  title,
  caption,
  notFound,
  tabs,
  footer,
  actions,
  busy,
  children,
}: {
  kind: SheetKind;
  ctx: SheetCtx;
  title?: ReactNode;
  caption?: ReactNode;
  notFound?: boolean;
  tabs?: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
}) {
  const loading = ctx.loading;
  const body = loading ? (
    <SheetSkeleton />
  ) : ctx.error ? (
    <div className="lab2g-sheet-msg">
      <p className="lab2g-text" data-lab-ink="">{fill(LAB_UI.didNotLoad, { error: ctx.error })}</p>
      <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={ctx.reload}>
        <span data-lab-ink="">{LAB_UI.retry}</span>
      </button>
    </div>
  ) : notFound ? (
    <div className="lab2g-sheet-msg">
      <p className="lab2g-text" data-lab-ink="">{LAB_COPY.notFound[kind] ?? ''}</p>
      <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={ctx.onClose}>
        <span data-lab-ink="">{LAB_UI.close}</span>
      </button>
    </div>
  ) : (
    <div id="lab2g-sheet-panel" className="lab2g-sheet-panel" role={tabs ? 'tabpanel' : undefined}>
      {children}
    </div>
  );
  return (
    <Sheet
      kind={kind}
      open={ctx.open}
      onClose={ctx.onClose}
      originId={ctx.originId}
      title={title ?? ctx.title ?? KIND_LABEL[kind]}
      caption={caption}
      busy={busy || loading}
      actions={
        <>
          {actions}
          {!loading && <CopyLink />}
        </>
      }
      tabs={!loading && !ctx.error && !notFound ? tabs : undefined}
      footer={!loading && !ctx.error && !notFound ? footer : undefined}
    >
      {body}
    </Sheet>
  );
}
