'use client';
/** Ask the Lab sheet (01 20), Classic tree: 07's answer line, the filter chips, and the matching posts. */
import Link from 'next/link';
import type { AskSheetView } from '@/lib/lab/view/sheets/ask';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { BreakoutCard } from '../BreakoutsPage';
import { Tag } from '../parts';
import type { SheetCommon } from './common';

export function AskSheet({ view }: { view: AskSheetView } & SheetCommon) {
  if (view.state === 'not_built' || !view.ask) {
    return (
      <div className="lab2c-sheetbody">
        <p className="lab2c-state-text" data-lab-ink="">{C.ask.notBuilt}</p>
        <span><Link href="/lab/breakouts" className="lab2c-btn">{C.ask.openBreakouts}</Link></span>
      </div>
    );
  }
  const a = view.ask;
  return (
    <div className="lab2c-sheetbody">
      {a.indexing && <p className="lab2c-muted" data-lab-ink="">{fill(C.ask.indexing, { done: a.indexing.done, total: a.indexing.total })}</p>}
      <p className="lab2c-ask-answer" data-lab-ink="">{a.summary}</p>
      {(view.chips.length > 0 || view.refineHref) && (
        <div className="lab2c-actrow">
          {view.chips.map((c) => (
            <Link key={c.label} href={c.removeHref} scroll={false} className="lab2c-fchip" aria-label={`${C.ask.remove} ${c.label}`}>
              {c.label}
              <span aria-hidden="true" className="lab2c-chip-x" />
            </Link>
          ))}
          {view.refineHref && <Link href={view.refineHref} className="lab2-textlink" data-lab-ink="">{C.ask.openInBreakouts}</Link>}
        </div>
      )}
      {a.cards.length > 0 && (
        <div className="lab2c-ask-cards">
          {a.cards.map((c) => (
            <div key={c.postId} className="lab2c-ask-card">
              <BreakoutCard c={c.card as never} tag={<Tag tone={c.match === 'close' ? 'strong' : 'quiet'}>{C.ask.match[c.match] ?? c.match}</Tag>} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
