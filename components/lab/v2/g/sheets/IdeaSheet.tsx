'use client';
/** Idea sheet (`?idea=`, every page but Studio at 768px and wider), GladOS tree (01 16). */

import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import { IdeaActions, IdeaBody } from '../studio/IdeaDetail';
import { SheetShell, type SheetCtx } from './SheetShell';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const STATUS: Record<string, string> = { open: 'Open', used: 'Used', dismissed: 'Dismissed' };

export function IdeaSheet({ ctx, view }: { ctx: SheetCtx; view: IdeaSheetUi | null | undefined }) {
  const v = view ?? null;
  return (
    <SheetShell
      kind="idea"
      ctx={ctx}
      notFound={view === null}
      title={v ? v.data.title : LAB_UI.kindIdea}
      caption={v ? [LAB_UI.kindIdea, STATUS[v.data.status] ?? v.data.status].join(' · ') : undefined}
      footer={v && <IdeaActions ui={v} />}
    >
      {v && <IdeaBody ui={v} />}
    </SheetShell>
  );
}
