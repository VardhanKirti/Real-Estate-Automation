'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Which kit names a shared Lab primitive carries (founderos-ui pages/lab.md).
 * GladOS and Classic keep `data-g="Lab…"` (AC-02-11, the g-audit names);
 * under Bennett Legacy the same node carries `data-l="Lab…"` instead, so the
 * Legacy DOM holds no GladOS kit marker (SPEC AC-6). LabRoot provides it once
 * for the layout and every page under it.
 */
const LabLegacyContext = createContext(false);

export function LabStyleProvider({ legacy, children }: { legacy: boolean; children: ReactNode }) {
  return <LabLegacyContext.Provider value={legacy}>{children}</LabLegacyContext.Provider>;
}

/** True when the Lab renders under the Bennett Legacy style. */
export function useLabLegacy(): boolean {
  return useContext(LabLegacyContext);
}

/** `{ 'data-g': name }`, or `{ 'data-l': name }` under Legacy. */
export function useKitMark(): (name: string) => { 'data-g'?: string; 'data-l'?: string } {
  const legacy = useContext(LabLegacyContext);
  return (name) => (legacy ? { 'data-l': name } : { 'data-g': name });
}
