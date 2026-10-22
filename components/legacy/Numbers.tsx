import type { ReactNode } from 'react';
import { CountUp } from './CountUp';
import { Chip } from './Status';
import { isKnown, type CountKind, type StatChip } from './format';

/**
 * The 50px headline number, status chips beside it, a caption under it (FO
 * kit BigStat). Honest: with no value and no display it reads "unknown", never 0.
 */
export function BigStat({
  value,
  kind = 'int',
  display,
  unit,
  chips = [],
  caption,
  size = 50,
}: {
  value?: number | null;
  kind?: CountKind;
  /** Preformatted headline when the count formats do not fit (4.2M, 68%). */
  display?: string;
  unit?: string;
  chips?: StatChip[];
  caption?: ReactNode;
  size?: 50 | 30;
}) {
  return (
    <div data-l="BigStat">
      <div className="l-bigstat-row">
        <span className={size === 50 ? 'l-bigstat' : 'l-bigstat is-small'}>
          {display != null ? display : isKnown(value) ? <CountUp value={value} kind={kind} /> : <span data-unknown className="l-unknown">unknown</span>}
          {unit && <span className="l-bigstat-unit">{unit}</span>}
        </span>
        {chips.map((c) => (
          <Chip key={c.text} tone={c.tone}>
            {c.text}
          </Chip>
        ))}
      </div>
      {caption && <div className="l-caption">{caption}</div>}
    </div>
  );
}
