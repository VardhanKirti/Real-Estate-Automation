'use client';

import type { ReactNode } from 'react';
import { EngineDrawer } from '@/components/creative-engine/skin-dash';

/**
 * Right drawer (S04 B37 on SPEC X1): a modal dialog named by its title, Esc
 * closes, focus returns to the opener. `back` adds a header button that
 * returns to where the drawer was opened from. `backLabel` (S05a FR-15) is the
 * short form when that return is just closing the drawer (the Motion console
 * reopens itself when it closes). Paper .ae-drawer under Classic, GDrawer
 * under the GladOS style (glados-ui GP1).
 */
export function Drawer({ title, onClose, children, back: backProp, backLabel }: { title: string; onClose: () => void; children: ReactNode; back?: { label: string; onClick: () => void }; backLabel?: string }) {
  const back = backProp ?? (backLabel ? { label: backLabel, onClick: onClose } : undefined);
  return <EngineDrawer title={title} onClose={onClose} back={back}>{children}</EngineDrawer>;
}
