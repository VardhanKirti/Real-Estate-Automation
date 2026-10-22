'use client';
/**
 * The one open sheet (01 13, D2 to D4) under Bennett Legacy, on the shared `useSheetRoute` the other trees
 * use: same-page sheet links are intercepted and pushed, the body loads from GET /api/lab/sheet, back
 * closes it, a deep link arrives already resolved (`initial`). This host draws the FO panel, keeps the D5
 * Studio rule and the 17.5 discard guard.
 */
import { useCallback, useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LSkeleton } from '@/components/legacy';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { SheetKind } from '@/lib/lab/view/shared';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { useSheetRoute } from '@/components/lab/v2/shared/useSheetRoute';
import { sheetGuard, useMinWidth } from '../../classic/hooks';
import { Btn } from '../parts';
import { Panel } from './Panel';
import { PostSheet, postTitle } from './PostSheet';
import { EventSheet } from './EventSheet';
import { IdeaSheet } from './IdeaSheet';
import { ScriptSheet } from './ScriptSheet';
import { TestSheet } from './TestSheet';
import { SetupSheet } from './SetupSheet';
import { AskSheet } from './AskSheet';

function titleOf(p: SheetPayload): { title: string; caption: string | null } {
  switch (p.kind) {
    case 'post': return p.view ? postTitle(p.view) : { title: C.sheetKind.post, caption: null };
    case 'event': return { title: p.view?.data.name ?? C.sheetKind.event, caption: p.view ? `${C.sheetKind.event} · ${p.view.stateText}` : null };
    case 'idea': return { title: p.view?.data.title ?? C.sheetKind.idea, caption: p.view ? `${C.sheetKind.idea} · ${p.view.angleLabel}` : null };
    case 'script': return { title: p.view?.data.title ?? C.sheetKind.script, caption: p.view ? `${C.sheetKind.script} · v${p.view.viewingVersion} · ${p.view.headerText}` : null };
    case 'test': return { title: p.view?.mode === 'view' ? p.view.test.test.title : C.sheetKind.test, caption: p.view?.mode === 'view' ? `${p.view.test.kindLabel} · ${p.view.test.statusLabel}` : null };
    case 'setup': return { title: C.sheetKind.setup, caption: p.view.setup.mode.dryLabel };
    case 'ask': return { title: p.view.q, caption: C.sheetKind.ask };
  }
}

export function SheetHost({ initial, frame }: { initial: SheetPayload | null; frame: LabFrameView }) {
  const sheet = useSheetRoute(initial);
  const pathname = usePathname();
  const params = useSearchParams();
  const wide = useMinWidth(768);

  // 01 17.5: a sheet with unsaved edits holds the close until its Discard dialog says go.
  const close = useCallback(() => {
    if (sheetGuard.fn && !sheetGuard.fn(() => { sheetGuard.fn = null; sheet.close(); })) return;
    sheet.close();
  }, [sheet]);

  // The Script sheet's version rows change ?ver= in place and ask for a reload.
  const { reload } = sheet;
  useEffect(() => {
    const on = () => reload();
    window.addEventListener('lab:sheet-reload', on);
    return () => window.removeEventListener('lab:sheet-reload', on);
  }, [reload]);

  const s = sheet.state;
  const kind: SheetKind | null = s?.kind ?? null;
  // D5: Studio shows ?idea= in its right column at >= 768px, never as a sheet.
  const suppressed = kind === 'idea' && pathname.endsWith('/studio') && wide;
  const open = !!kind && !suppressed;
  const payload = s?.payload ?? null;
  const t = payload ? titleOf(payload) : { title: s?.title ?? (kind ? C.sheetKind[kind] : ''), caption: null };

  let body: ReactNode = null;
  let footer: ReactNode = undefined;
  if (payload) {
    if (!payload.view) {
      body = <p className="l-lab-state-text">{C.notFound[payload.kind]}</p>;
      footer = <Btn onClick={close}>{C.close}</Btn>;
    } else {
      const common = { readOnly: frame.readOnly, setInner: sheet.setInner, st: params.get('st') };
      switch (payload.kind) {
        case 'post': body = <PostSheet view={payload.view} {...common} />; break;
        case 'event': body = <EventSheet view={payload.view} {...common} onClose={close} />; break;
        case 'idea': body = <IdeaSheet view={payload.view} {...common} />; break;
        case 'script': body = <ScriptSheet view={payload.view} {...common} />; break;
        case 'test': body = <TestSheet view={payload.view} {...common} />; break;
        case 'setup': body = <SetupSheet view={payload.view} {...common} />; break;
        case 'ask': body = <AskSheet view={payload.view} {...common} />; break;
      }
    }
  } else if (s?.loading) {
    body = <LSkeleton lines={4} />;
  }

  return (
    <Panel kind={kind ?? 'post'} open={open} onClose={close} title={t.title} caption={t.caption ?? undefined} busy={!!s?.loading} error={s?.error ?? null} onRetry={reload} footer={footer}>
      {body}
    </Panel>
  );
}
