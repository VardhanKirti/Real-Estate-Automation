'use client';
/** Ask the Lab sheet (`?ask=`), GladOS tree (01 20, 07 7.12). 720px wide (02 13). */
import Link from 'next/link';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { AskSheetView } from '@/lib/lab/view/sheets/ask';
import { AskAnswer, AskBox } from '../ask/AskBox';
import { SheetShell, type SheetCtx } from './SheetShell';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

export function AskSheet({ ctx, view, q }: { ctx: SheetCtx; view: AskSheetView | null | undefined; q: string }) {
  const v = view ?? null;
  return (
    <SheetShell kind="ask" ctx={ctx} title={LAB_UI.askTitle} caption={v?.q ?? q}>
      {v && (
        <div className="lab2g-sheetbody">
          <AskBox />
          {v.state === 'not_built' || !v.ask ? (
            <div className="lab2g-sheet-msg">
              <p className="lab2g-text" data-lab-ink="">{LAB_COPY.layer.ask}</p>
              <Link data-g="LabLink" href="/lab/breakouts" className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.openBreakouts}</Link>
            </div>
          ) : v.ask.n === 0 && v.ask.indexing === null && v.ask.cards.length === 0 && /indexed/i.test(v.ask.summary) ? (
            <p className="lab2g-text" data-lab-ink="">{LAB_UI.nothingIndexed}</p>
          ) : (
            <AskAnswer ask={v.ask} chips={v.chips} refineHref={v.refineHref} />
          )}
        </div>
      )}
    </SheetShell>
  );
}
