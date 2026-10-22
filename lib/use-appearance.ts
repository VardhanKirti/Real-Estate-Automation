'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_APPEARANCE, currentAppearance, onAppearanceChange, resolveAppearance, type AppliedAppearance } from './appearance';

/**
 * The applied appearance on <html>, kept current through the one shared
 * observer (X3). Starts from `initial` (pass the server's `getAppearance()` to
 * avoid a first-render mismatch), else the default (the same on server and
 * client, so hydration matches), then reads <html> on mount.
 */
export function useAppearance(initial?: AppliedAppearance): AppliedAppearance {
  const [a, setA] = useState<AppliedAppearance>(() => initial ?? resolveAppearance(DEFAULT_APPEARANCE));
  useEffect(() => {
    setA(currentAppearance());
    return onAppearanceChange(setA);
  }, []);
  return a;
}
