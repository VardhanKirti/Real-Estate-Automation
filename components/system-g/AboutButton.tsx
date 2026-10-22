'use client';

import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { GButton, GSheet } from '@/components/g';

/**
 * "About this page" (SPEC S05 F05.3): explanatory copy that is not needed to
 * act moves off the working surface into a sheet opened from a small `i`
 * button in the page header's right slot. The copy is moved word for word.
 */
export function AboutButton({ title = 'About this page', children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GButton variant="icon" aria-label={title} title={title} onClick={() => setOpen(true)}>
        <Info size={15} strokeWidth={1.7} aria-hidden="true" />
      </GButton>
      <GSheet open={open} onClose={() => setOpen(false)} title={title} width={560}>
        <div className="kg-about">{children}</div>
      </GSheet>
    </>
  );
}
