'use client';

import { useRef, type KeyboardEvent } from 'react';
import { rovingIndex } from '@/components/g/logic';
import { LEGACY_FACES, LEGACY_THEMES, type Appearance, type LegacySkin, type LegacyTheme, type ModePref, type UiStyle } from '@/lib/appearance';

/** The full stored choice the picker edits: the cookie's axes plus the other style's choice. */
export type StoredChoice = Appearance & { skin: LegacySkin };
type Stored = StoredChoice;

const MODE_OPTIONS: { value: ModePref; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

/**
 * Settings → Appearance under Bennett Legacy (pages/setup.md §2): Style,
 * Skin (Monolith | Daylight) and Mode, as mono toggle pills from the Legacy
 * kit, so the Legacy DOM carries no GladOS kit class (l-audit).
 */
export function AppearanceLegacy({
  stored,
  appliedTheme,
  appliedMode,
  options,
  onStyle,
  onSave,
}: {
  stored: Stored;
  appliedTheme: string;
  appliedMode: 'dark' | 'light';
  options: { value: UiStyle; label: string; title: string }[];
  onStyle: (ui: UiStyle) => void;
  onSave: (next: Stored) => void;
}) {
  const face: LegacyTheme = appliedTheme === 'daylight' ? 'daylight' : 'monolith';
  return (
    <div data-appearance="legacy" data-l="AppearancePicker" className="appset appset-legacy l-card">
      <div className="appset-row">
        <span className="appset-label" id="appset-style-label">Style</span>
        <LRadios label="Style" options={options.map((o) => ({ value: o.value, label: o.label, title: o.title }))} value={stored.ui} onChange={onStyle} />
      </div>
      <div className="appset-row">
        <span className="appset-label" id="appset-colour-label">Skin</span>
        <LRadios
          label="appset-colour-label"
          labelledBy
          options={LEGACY_THEMES.map((t) => ({ value: t, label: LEGACY_FACES[t].name, title: `${LEGACY_FACES[t].name}: ${LEGACY_FACES[t].blurb}`, swatch: t }))}
          value={face}
          onChange={(t) => onSave({ ...stored, mode: LEGACY_FACES[t].mode })}
        />
      </div>
      <div className="appset-row">
        <span className="appset-label">Mode</span>
        <LRadios label="Mode" options={MODE_OPTIONS} value={stored.mode} onChange={(mode) => onSave({ ...stored, mode })} />
        {stored.mode === 'system' && <p className="appset-note">following your OS: {appliedMode === 'light' ? 'Daylight' : 'Monolith'}</p>}
      </div>
      <p className="appset-caption">Saved on this browser. Every page wears this skin; pages with their own Legacy layout use it.</p>
    </div>
  );
}

/** A keyboard radiogroup of Legacy toggle pills: one tab stop, arrows and Home/End move and select. */
function LRadios<T extends string>({
  label,
  labelledBy = false,
  options,
  value,
  onChange,
}: {
  label: string;
  labelledBy?: boolean;
  options: { value: T; label: string; title?: string; swatch?: LegacyTheme }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(e.key, current, options.map(() => false));
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      {...(labelledBy ? { 'aria-labelledby': label } : { 'aria-label': label })}
      className="appset-lradios"
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            data-l="ToggleChip"
            data-lens="c"
            data-on={on ? 'true' : 'false'}
            className={`l-pressable l-toggle-chip appset-lradio${on ? '' : ' is-dark'}`}
            onClick={() => onChange(o.value)}
          >
            {o.swatch && <span aria-hidden className="appset-lswatch" data-face={o.swatch} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
