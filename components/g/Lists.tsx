'use client';

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type MouseEventHandler, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cx } from './cx';
import { nextSort, sortRows, type SortDir } from './logic';

/**
 * Lists and tables (SPEC S00 §5.3). Rows are 44px minimum (48 on coarse
 * pointers), no dividers unless `divided`; tables use --g-line rules only,
 * numbers right-aligned in sans tabular (never mono).
 */

export type GListProps = {
  children: ReactNode;
  divided?: boolean;
  /** Names the list for assistive tech when it has no visible heading. */
  label?: string;
  className?: string;
};

export function GList({ children, divided = false, label, className }: GListProps) {
  return (
    <ul data-g="GList" data-divided={divided || undefined} aria-label={label} className={cx('g-list', className)}>
      {children}
    </ul>
  );
}

export type GRowProps = {
  title: ReactNode;
  meta?: ReactNode;
  /** Leading icon, GBlob or GCheck (a GCheck stays its own control, outside the row button). */
  leading?: ReactNode;
  /** Trailing value, tabular. */
  trailing?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Hover title for the whole row. */
  hint?: string;
  className?: string;
};

/**
 * One row. With `href` or `onClick` the text block is the action; a
 * `leading` control (GCheck) stays a sibling so controls never nest.
 */
export function GRow({ title, meta, leading, trailing, href, onClick, selected = false, disabled = false, disabledReason, hint, className }: GRowProps) {
  const text = (
    <>
      <span className="g-row-text">
        <span className="g-row-title">{title}</span>
        {meta != null && <span className="g-row-meta">{meta}</span>}
      </span>
      {trailing != null && <span className="g-row-trail">{trailing}</span>}
    </>
  );
  let main: ReactNode;
  if (href && !disabled) {
    main = (
      <Link href={href} className="g-row-main" aria-current={selected ? 'true' : undefined}>
        {text}
      </Link>
    );
  } else if (onClick || (href && disabled)) {
    main = (
      <button type="button" className="g-row-main" onClick={onClick} disabled={disabled} aria-pressed={onClick ? selected : undefined}>
        {text}
      </button>
    );
  } else {
    main = <span className="g-row-main">{text}</span>;
  }
  return (
    <li
      data-g="GRow"
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      data-action={href || onClick ? '' : undefined}
      title={disabled && disabledReason ? disabledReason : hint}
      className={cx('g-row', className)}
    >
      {leading != null && <span className="g-row-lead">{leading}</span>}
      {main}
    </li>
  );
}

export type GColumn<T> = {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right';
  /** Numbers right-align and sort descending first. */
  numeric?: boolean;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => ReactNode;
  /** Header hover title (what the column is, its window). */
  title?: string;
};

export type GTableProps<T> = {
  columns: readonly GColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible table name. */
  caption: string;
  /** Show the caption visually (otherwise it is screen-reader only). */
  showCaption?: boolean;
  /** Initial sort. */
  sort?: { key: string; dir: SortDir } | null;
  /** Shown in one full-width cell when there are no rows. */
  empty?: ReactNode;
  /** Sticky header inside a scrolling parent. */
  sticky?: boolean;
  /**
   * Makes each row the action (drill in, open the record, open a drawer): the
   * row is focusable, Enter or Space (or a click outside an inner control)
   * activates it, and `rowLabel` names it for assistive tech.
   */
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  /** Dims a row (a filter that keeps it listed but out of focus). */
  rowDim?: (row: T) => boolean;
  /** key of the row whose drawer is open (ringed) */
  selectedKey?: string | null;
  className?: string;
};

export function GTable<T>({ columns, rows, rowKey, caption, showCaption = false, sort: initial = null, empty, sticky = true, onRowClick, rowLabel, rowDim, selectedKey = null, className }: GTableProps<T>) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    return col?.sortValue ? sortRows(rows, col.sortValue, sort.dir) : rows;
  }, [rows, columns, sort]);
  return (
    <table data-g="GTable" data-sticky={sticky || undefined} className={cx('g-table', className)}>
      <caption className={showCaption ? 'g-table-cap' : 'g-sr'}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => {
            const on = sort?.key === c.key;
            const align = c.align ?? (c.numeric ? 'right' : 'left');
            return (
              <th
                key={c.key}
                scope="col"
                data-align={align}
                title={c.title}
                aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
              >
                {c.sortValue ? (
                  <button type="button" className="g-th-sort" data-g="GTableSort" onClick={() => setSort(nextSort(sort, c.key, Boolean(c.numeric)))}>
                    {c.label}
                    {on ? (
                      sort!.dir === 'asc' ? <ArrowUp size={12} strokeWidth={1.75} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <ChevronsUpDown size={12} strokeWidth={1.5} aria-hidden className="g-th-idle" />
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="g-table-empty">
              {empty ?? 'Nothing to show'}
            </td>
          </tr>
        ) : (
          sorted.map((r) => (
            <tr
              key={rowKey(r)}
              data-dim={rowDim?.(r) || undefined}
              data-selected={selectedKey !== null && selectedKey === rowKey(r) ? '' : undefined}
              {...(onRowClick
                ? {
                    'data-g': 'GTableRow',
                    'data-action': '',
                    tabIndex: 0,
                    'aria-label': rowLabel?.(r),
                    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
                      if (!(e.target as HTMLElement).closest('a, button, input, select, textarea')) onRowClick(r);
                    },
                    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                        e.preventDefault();
                        onRowClick(r);
                      }
                    },
                  }
                : {})}
            >
              {columns.map((c) => (
                <td key={c.key} data-align={c.align ?? (c.numeric ? 'right' : 'left')}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export type GKeyValueProps = {
  items: readonly { label: ReactNode; value: ReactNode; title?: string; key?: string }[];
  className?: string;
};

/** Label left muted, value right ink; no dotted leaders, no mono. */
export function GKeyValue({ items, className }: GKeyValueProps) {
  return (
    <dl data-g="GKeyValue" className={cx('g-kv', className)}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="g-kv-row" title={it.title}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
