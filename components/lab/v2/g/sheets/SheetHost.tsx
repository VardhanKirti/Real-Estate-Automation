'use client';
/**
 * The one sheet slot of a GladOS Lab page (01 13, D4). It keeps the last sheet rendered while it closes so
 * the close motion runs, and renders the same kind component through loading and loaded so the FLIP
 * plays once.
 */
import { useRef } from 'react';
import { useSheetRoute, type SheetState } from '@/components/lab/v2/shared/useSheetRoute';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import { AskSheet } from './AskSheet';
import { EventSheet } from './EventSheet';
import { IdeaSheet } from './IdeaSheet';
import { PostSheet } from './PostSheet';
import { ScriptSheet } from './ScriptSheet';
import { SetupSheet } from './SetupSheet';
import type { SheetCtx } from './SheetShell';
import { TestSheet } from './TestSheet';

type ViewOf<K extends SheetPayload['kind']> = Extract<SheetPayload, { kind: K }>['view'];
function viewOf<K extends SheetPayload['kind']>(s: SheetState, kind: K): ViewOf<K> | undefined {
  if (!s.payload || s.payload.kind !== kind) return undefined;
  return (s.payload.view ?? undefined) as ViewOf<K> | undefined;
}

export function GSheetHost({ initial, frame }: { initial: SheetPayload | null; frame: LabFrameView }) {
  const r = useSheetRoute(initial);
  const last = useRef<SheetState | null>(null);
  if (r.state) last.current = r.state;
  const s = r.state ?? last.current;
  if (!s) return null;
  const ctx: SheetCtx = {
    open: !!r.state,
    onClose: r.close,
    originId: s.originId,
    loading: s.loading,
    error: s.error,
    title: s.title,
    reload: r.reload,
    setInner: r.setInner,
    frame,
  };
  const key = `${s.kind}:${s.id}`;
  switch (s.kind) {
    case 'post':
      return <PostSheet key={key} ctx={ctx} view={viewOf(s, 'post')} />;
    case 'event':
      return <EventSheet key={key} ctx={ctx} view={viewOf(s, 'event')} />;
    case 'idea':
      return <IdeaSheet key={key} ctx={ctx} view={viewOf(s, 'idea')} />;
    case 'script':
      return <ScriptSheet key={key} ctx={ctx} view={viewOf(s, 'script')} />;
    case 'test':
      return <TestSheet key={key} ctx={ctx} view={viewOf(s, 'test')} />;
    case 'setup':
      return <SetupSheet key="setup" ctx={ctx} view={viewOf(s, 'setup')} section={s.payload?.kind === 'setup' ? s.payload.id : s.id} />;
    case 'ask':
      return <AskSheet key={key} ctx={ctx} view={viewOf(s, 'ask')} q={s.id} />;
  }
}
