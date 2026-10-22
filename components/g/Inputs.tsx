'use client';

import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ArrowUp, Search } from 'lucide-react';
import { cx } from './cx';
import { textareaHeight } from './logic';
import { GButton } from './Controls';

/**
 * Inputs (SPEC S00 §5.3, GP3, C3). 12px radius on --g-card-2 with an inset
 * --g-line ring, 2px --g-ring on focus; `lg` is the 17/300 pill. Errors put
 * an --g-err ring on the field and a GErrorLine-style message under it
 * (through GField). The chevron and calendar icons are masks painted with
 * currentColor, so no literal stroke colour exists anywhere.
 */

type FieldSize = 'md' | 'lg' | 'compact';

export type GInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: FieldSize;
  /** Error ring; pair with GField's `error` for the message. */
  invalid?: boolean;
};

export const GInput = forwardRef<HTMLInputElement, GInputProps>(function GInput({ size = 'md', invalid, className, ...rest }, ref) {
  return <input ref={ref} data-g="GInput" data-size={size} aria-invalid={invalid || undefined} className={cx('g-input', className)} {...rest} />;
});

export type GTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; /** Grow up to this many lines (default 8). */ maxLines?: number };

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Multi-line GInput that grows with its content up to 8 lines, then scrolls. */
export const GTextarea = forwardRef<HTMLTextAreaElement, GTextareaProps>(function GTextarea(
  { invalid, className, maxLines = 8, onChange, value, rows = 2, ...rest },
  outer,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof outer === 'function') outer(el);
      else if (outer) outer.current = el;
    },
    [outer],
  );
  const grow = useCallback(() => {
    const el = inner.current;
    if (!el || typeof getComputedStyle !== 'function') return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    el.style.height = 'auto';
    el.style.height = `${textareaHeight(el.scrollHeight, line, pad, maxLines)}px`;
  }, [maxLines]);
  useIsoLayoutEffect(grow, [value, grow]);
  return (
    <textarea
      ref={setRef}
      data-g="GTextarea"
      aria-invalid={invalid || undefined}
      className={cx('g-input', 'g-textarea', className)}
      rows={rows}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        grow();
      }}
      {...rest}
    />
  );
});

export type GSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: 'md' | 'compact';
  invalid?: boolean;
  options?: readonly { value: string; label: string; disabled?: boolean }[];
};

/** Native select on the input recipe, chevron drawn by a currentColor mask. */
export const GSelect = forwardRef<HTMLSelectElement, GSelectProps>(function GSelect({ size = 'md', invalid, className, options, children, ...rest }, ref) {
  return (
    <span data-g="GSelect" data-size={size} className={cx('g-select', className)}>
      <select ref={ref} aria-invalid={invalid || undefined} className="g-input" data-size={size} {...rest}>
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    </span>
  );
});

export type GDateTimeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** `datetime-local` (default) or `date`. */
  kind?: 'datetime' | 'date';
  invalid?: boolean;
};

/** Native date-time input on the input recipe with a calendar icon (mask). */
export const GDateTime = forwardRef<HTMLInputElement, GDateTimeProps>(function GDateTime({ kind = 'datetime', invalid, className, ...rest }, ref) {
  return (
    <span data-g="GDateTime" className={cx('g-datetime', className)}>
      <input ref={ref} type={kind === 'date' ? 'date' : 'datetime-local'} aria-invalid={invalid || undefined} className="g-input" {...rest} />
    </span>
  );
});

export type GFieldProps = {
  label: ReactNode;
  children: ReactNode;
  /** Muted help under the control. */
  hint?: ReactNode;
  /** Error message under the control (the control should also get `invalid`). */
  error?: ReactNode;
  /** id of the control; when omitted the label wraps the control. */
  htmlFor?: string;
  className?: string;
};

/** Label 11.5 muted above a control, hint or error under it. */
export function GField({ label, children, hint, error, htmlFor, className }: GFieldProps) {
  const msg = error != null ? (
    <p className="g-field-error" role="alert">
      {error}
    </p>
  ) : hint != null ? (
    <p className="g-field-hint">{hint}</p>
  ) : null;
  if (htmlFor) {
    return (
      <div data-g="GField" className={cx('g-field', className)}>
        <label htmlFor={htmlFor} className="g-field-label">
          {label}
        </label>
        {children}
        {msg}
      </div>
    );
  }
  return (
    <div data-g="GField" className={cx('g-field', className)}>
      <label>
        <span className="g-field-label">{label}</span>
        {children}
      </label>
      {msg}
    </div>
  );
}

export type GSearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value' | 'type'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** `lg` pill (default, the palette and page search) or `md`. */
  size?: 'md' | 'lg';
};

/** Search field with a 16px search icon. Escape clears a non-empty value first. */
export const GSearch = forwardRef<HTMLInputElement, GSearchProps>(function GSearch({ value, onValueChange, size = 'lg', className, onKeyDown, ...rest }, ref) {
  return (
    <span data-g="GSearch" data-size={size} className={cx('g-search', className)}>
      <Search size={16} strokeWidth={1.6} className="g-search-icon" aria-hidden />
      <input
        ref={ref}
        type="search"
        className="g-input"
        data-size={size}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === 'Escape' && value !== '' && !e.defaultPrevented) {
            e.preventDefault(); // the escape stack sees defaultPrevented and leaves the dialog open
            onValueChange('');
          }
        }}
        {...rest}
      />
    </span>
  );
});

export type GAskProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** `ask` sends to a model (orbit while focused or busy); `filter` filters live (search icon, no orbit, no send). */
  mode?: 'ask' | 'filter';
  onSubmit?: (value: string) => void;
  busy?: boolean;
  error?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
  /** Accessible name of the field. */
  label: string;
  /** Send stays off under this many characters (default 3). */
  minChars?: number;
  className?: string;
};

/**
 * The frosted orbit composer. In `ask` mode the conic light turns only while
 * the field is focused or busy and never under reduced motion.
 */
export function GAsk({ value, onValueChange, mode = 'ask', onSubmit, busy = false, error, disabled, disabledReason, placeholder, label, minChars = 3, className }: GAskProps) {
  const id = useId();
  const errId = `${id}-err`;
  const ask = mode === 'ask';
  const canSend = ask && !disabled && !busy && value.trim().length >= minChars;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // filter mode: Enter hands the line to onSubmit when one is given (the funnel's slash jumper, lane R)
    if (ask ? canSend : !disabled) onSubmit?.(value.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value !== '') {
      e.preventDefault();
      onValueChange('');
    }
  };
  return (
    <form
      data-g="GAsk"
      data-mode={mode}
      data-busy={busy || undefined}
      data-error={error ? 'true' : undefined}
      className={cx('g-ask', className)}
      onSubmit={submit}
      role={ask ? undefined : 'search'}
    >
      <span className="g-ask-box">
        {ask && <span className="g-ask-orbit" aria-hidden />}
        <span className="g-ask-glass" aria-hidden />
        <span className="g-ask-row">
          {!ask && <Search size={16} strokeWidth={1.6} className="g-ask-icon" aria-hidden />}
          <input
            className="g-ask-input"
            // the field sits three levels under the form: its own marker keeps it a kit control for the GP4 guard (2 levels)
            data-g="GAskInput"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            type={ask ? 'text' : 'search'}
          />
          {ask && (
            <GButton
              type="submit"
              variant="icon"
              busy={busy}
              aria-label={busy ? 'Working' : 'Send'}
              disabled={!canSend}
              title={!canSend && !busy ? (disabled ? disabledReason : `Type at least ${minChars} characters`) : undefined}
            >
              <ArrowUp size={16} strokeWidth={1.75} aria-hidden />
            </GButton>
          )}
        </span>
      </span>
      {error && (
        <p id={errId} className="g-field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export type GSwatchProps = {
  /** Accent name, shown under the swatch when selected. */
  name: string;
  /**
   * The fill, as a token reference (`var(--…)`): the accent's hero-a
   * gradient. Each accent's tokens live on `:root[data-accent]`, so the
   * picker (lib/appearance ACCENTS) supplies the swatch value per accent.
   */
  fill: `var(--${string})`;
  selected: boolean;
  onSelect: () => void;
  /** Roving tabindex from the parent radiogroup. */
  tabIndex?: number;
  /** Tooltip for the whole swatch (name and blurb, S05 F05.91). */
  title?: string;
  className?: string;
};

/** 32px round accent radio; 2px --g-ring when selected; name under the selected one. */
export function GSwatch({ name, fill, selected, onSelect, tabIndex, title, className }: GSwatchProps) {
  return (
    <span data-g="GSwatch" className={cx('g-swatch', className)} data-selected={selected || undefined} title={title}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={name}
        tabIndex={tabIndex ?? (selected ? 0 : -1)}
        className="g-swatch-btn"
        style={{ background: fill }}
        onClick={onSelect}
      />
      <span className="g-swatch-name" aria-hidden={!selected}>
        {selected ? name : ''}
      </span>
    </span>
  );
}
