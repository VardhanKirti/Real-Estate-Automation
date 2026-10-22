'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GCard, GSegmented, GSwatch } from '@/components/g';
import { rovingIndex } from '@/components/g/logic';
import { ThemePicker } from '@/components/ThemePicker';
import { BRAND } from '@/lib/brand';
import {
  ACCENTS,
  ACCENT_IDS,
  APPEARANCE_COOKIE,
  STORAGE_KEYS,
  STYLE_LABELS,
  UI_STYLES,
  parseAppearanceCookie,
  switchStyle,
  withStoredChoices,
  writeAppearance,
  type Accent,
  type Appearance,
  type ModePref,
  type UiStyle,
} from '@/lib/appearance';
import { useAppearance } from '@/lib/use-appearance';
import { AppearanceLegacy, type StoredChoice } from '@/components/legacy/AppearanceLegacy';
import { rolloutLine, type RolloutProgress } from '@/lib/g-rollout';

/**
 * Settings → Appearance (SPEC S00 FR-13, C14; S05 F05.91). Three controls in
 * this order, each applied the moment it is chosen and stored per browser
 * (cookie `glados-appearance` + localStorage, lib/appearance.ts):
 *
 *   Style   {BRAND.name} | Classic | Bennett Legacy (FounderOS ui merge §2.5,
 *           pages/setup.md). The GladOS label is the product name, never the
 *           internal id (§3.6). A style change also refreshes the server so
 *           routes render their matching tree (FR-15). The other style's
 *           choice is kept (AC-5): the accent in glados-accent, the Legacy skin
 *           in glados-legacy-skin.
 *   Colour  under GladOS, four accent swatches; under Classic, the five
 *           Classic theme cards (ThemePicker, unchanged); under Legacy, the
 *           Monolith and Daylight faces of the mono skin (T2).
 *   Mode    under GladOS and Legacy, Dark | Light | System. Hidden under
 *           Classic, where the theme decides (FR-4).
 *
 * Colour and mode never reload or refresh: they only move <html> attributes,
 * and every colour cache follows through the one observer (X3).
 */

const MODE_OPTIONS: { value: ModePref; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

type Stored = StoredChoice;

/** The stored choice as this browser holds it: the cookie (kept current by the head script) plus the other style's choice from storage. */
function readStored(): Stored | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${APPEARANCE_COOKIE}=([^;]*)`));
    if (!m) return null;
    let accent: string | null = null;
    let skin: string | null = null;
    try {
      accent = localStorage.getItem(STORAGE_KEYS.accent);
      skin = localStorage.getItem(STORAGE_KEYS.skin);
    } catch {}
    return withStoredChoices(parseAppearanceCookie(decodeURIComponent(m[1])), { accent, skin });
  } catch {
    return null;
  }
}

export type AppearancePickerProps = {
  /** The stored choice the server read from the cookie, so the first render matches. */
  initial: Appearance;
  /** Converted pages out of all pages (lib/g-rollout.ts), for the honest rollout line. */
  rollout: RolloutProgress;
};

export function AppearancePicker({ initial, rollout }: AppearancePickerProps) {
  const router = useRouter();
  const applied = useAppearance();
  const [stored, setStored] = useState<Stored>(() => withStoredChoices(initial, {}));

  useEffect(() => {
    const s = readStored();
    if (s) setStored(s);
  }, []);

  const save = (next: Stored) => {
    writeAppearance(next);
    setStored(next);
  };

  const setStyle = (ui: UiStyle) => {
    if (ui === stored.ui) return;
    save(switchStyle(stored, ui));
    router.refresh();
  };

  const styleOptions: { value: UiStyle; label: string; title: string }[] = [
    { value: 'glados', label: STYLE_LABELS.glados, title: `The ${BRAND.name} widgets, with your colour and mode` },
    { value: 'classic', label: STYLE_LABELS.classic, title: 'The original widgets and the five Classic themes' },
    { value: 'legacy', label: STYLE_LABELS.legacy, title: "Bennett's design: JetBrains Mono, one slab per page, colour for status only" },
  ];

  if (stored.ui === 'legacy') {
    return <AppearanceLegacy stored={stored} appliedTheme={applied.theme} appliedMode={applied.mode} options={styleOptions} onStyle={setStyle} onSave={save} />;
  }

  if (stored.ui === 'classic') {
    return (
      <div data-appearance="classic" className="appset appset-classic">
        <div className="appset-row">
          <span className="appset-label">Style</span>
          <GSegmented className="appset-seg" size="md" label="Style" options={styleOptions} value={stored.ui} onChange={setStyle} />
        </div>
        <div className="appset-row">
          <span className="appset-label">Colour</span>
          <ThemePicker />
        </div>
        <p className="appset-caption">Saved on this browser.</p>
      </div>
    );
  }

  const line = rolloutLine(rollout);
  return (
    <div data-appearance="glados" className="appset appset-g">
      <GCard p={20} aria-label="Appearance">
        <div className="appset-row">
          <span className="appset-label">Style</span>
          <GSegmented size="md" label="Style" options={styleOptions} value={stored.ui} onChange={setStyle} />
          {line && <p className="appset-note">{line}</p>}
        </div>
        <div className="appset-row">
          <span className="appset-label" id="appset-colour-label">
            Colour
          </span>
          <AccentSwatches value={stored.accent} onChange={(accent) => save({ ...stored, accent })} />
        </div>
        <div className="appset-row">
          <span className="appset-label">Mode</span>
          <GSegmented
            size="md"
            label="Mode"
            options={MODE_OPTIONS}
            value={stored.mode}
            onChange={(mode) => save({ ...stored, mode })}
          />
          {stored.mode === 'system' && (
            <p className="appset-note">following your OS: {applied.mode === 'light' ? 'Light' : 'Dark'}</p>
          )}
        </div>
      </GCard>
      <p className="appset-caption">Saved on this browser.</p>
    </div>
  );
}

/** Four accent radios; arrows and Home/End move and select (AC00.21). */
function AccentSwatches({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const current = Math.max(0, ACCENT_IDS.indexOf(value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(e.key, current, ACCENT_IDS.map(() => false));
    if (next === null) return;
    e.preventDefault();
    onChange(ACCENT_IDS[next]);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-labelledby="appset-colour-label" className="appset-swatches" onKeyDown={onKeyDown}>
      {ACCENT_IDS.map((id) => (
        // The title is the swatch's tooltip (S05 F05.91); the name also shows under the selected one.
        <GSwatch key={id} name={ACCENTS[id].name} fill={`var(--g-swatch-${id})`} selected={id === value} onSelect={() => onChange(id)} title={`${ACCENTS[id].name}: ${ACCENTS[id].blurb}`} />
      ))}
    </div>
  );
}
