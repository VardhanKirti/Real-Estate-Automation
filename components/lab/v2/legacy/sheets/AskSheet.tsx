'use client';
/** Ask the Lab sheet (01 20) under Bennett Legacy: 07's answer line, the filter chips, the matching specimens. */
import Link from 'next/link';
import type { AskSheetView } from '@/lib/lab/view/sheets/ask';
import type { PostCardView } from '@/lib/lab/view/breakouts';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, Tag } from '../parts';
import { SpecimenCard } from '../SpecimenCard';
import type { SheetCommon } from './common';

export function AskSheet({ view }: { view: AskSheetView } & SheetCommon) {
  if (view.state === 'not_built' || !view.ask) {
    return (
      <div data-l="LabAskSheet" className="l-lab-sheetbody">
        <p className="l-lab-state-text">{C.ask.notBuilt}</p>
        <span className="l-lab-actrow"><Btn href="/lab/breakouts">{C.ask.openBreakouts}</Btn></span>
      </div>
    );
  }
  const a = view.ask;
  return (
    <div data-l="LabAskSheet" className="l-lab-sheetbody">
      {a.indexing && <p className="l-body-text">{fill(C.ask.indexing, { done: a.indexing.done, total: a.indexing.total })}</p>}
      <p className="l-lab-answer"><span aria-hidden className="l-lab-caret">▌</span>{a.summary}</p>
      {(view.chips.length > 0 || view.refineHref) && (
        <div className="l-chip-row">
          {view.chips.map((c) => (
            <Link key={c.label} href={c.removeHref} scroll={false} data-l="ToggleChip" data-on="true" className="l-pressable l-toggle-chip l-lab-fchip" aria-label={`${C.ask.remove} ${c.label}`}>
              {c.label}
              <span aria-hidden className="l-lab-chip-x" />
            </Link>
          ))}
          {view.refineHref && <Link href={view.refineHref} className="l-link">{C.ask.openInBreakouts}</Link>}
        </div>
      )}
      {a.cards.length > 0 && (
        <div className="l-lab-askcards">
          {a.cards.map((c) => (
            <SpecimenCard key={c.postId} c={c.card as unknown as PostCardView} tag={<Tag tone={c.match === 'close' ? 'strong' : 'quiet'}>{C.ask.match[c.match] ?? c.match}</Tag>} />
          ))}
        </div>
      )}
    </div>
  );
}
