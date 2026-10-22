'use client';

import { useSyncExternalStore } from 'react';
import { currentAppearance, onAppearanceChange, type UiStyle } from './appearance';

/**
 * The live UI style for shell components (SPEC S00 §5.5, FR-16).
 *
 * The root layout reads the cookie and passes `initial`, so the server render
 * and hydration agree (no Classic flash under GladOS). After hydration the
 * value follows `html[data-ui]` through the one appearance observer (X3), so
 * a style switch in Settings restyles the shell before `router.refresh()` lands.
 */
export function useUiStyle(initial: UiStyle): UiStyle {
  return useSyncExternalStore(
    (onChange) => onAppearanceChange(() => onChange()),
    () => currentAppearance().ui,
    () => initial,
  );
}
