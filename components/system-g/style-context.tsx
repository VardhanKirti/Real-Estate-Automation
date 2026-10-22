'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Which style a shared component is rendering in (glados-ui SPEC X5).
 *
 * Big shared engines (the /brain knowledge graph and its cards) are one
 * component tree used by both styles. Rather than threading a `g` prop through
 * every card, the GladOS tree wraps them in <GStyleProvider>, and each control
 * picks its class with `useGc()`: the kit's control classes (FR-GP4.1:
 * `.g-btn`, `.g-btn-sm`, `.g-btn-icon`, `.g-chip`, `.g-input`) under GladOS,
 * the untouched Classic classes otherwise. Classic output is byte-identical.
 */
const GStyle = createContext(false);

export function GStyleProvider({ children, on = true }: { children: ReactNode; on?: boolean }) {
  return <GStyle.Provider value={on}>{children}</GStyle.Provider>;
}

export function useGStyle(): boolean {
  return useContext(GStyle);
}

/** `gc(kit, classic)`: the class for the current style. */
export function useGc(): (kit: string, classic: string) => string {
  const g = useContext(GStyle);
  return (kit, classic) => (g ? kit : classic);
}
