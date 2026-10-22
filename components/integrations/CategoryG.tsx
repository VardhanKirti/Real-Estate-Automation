'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { GButton, GCard } from '@/components/g';
import { useHashOpen } from './useHashOpen';

/** A category accordion on the GladOS Connections board, closed on load (S05 F05.72). */
export function CategoryG({ label, count, slugs, children }: { label: string; count: number; slugs?: readonly string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useHashOpen(slugs, useCallback(() => setOpen(true), []));
  const id = `cat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <GCard p={16} className="kg-cat">
      <GButton variant="sm" className="kg-cat-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className="kg-chev" data-open={open || undefined} />
        <span className="kg-cat-label">{label}</span>
        <span className="kg-cap">{count}</span>
      </GButton>
      {open && (
        <div id={id} className="kg-cat-body">
          {children}
        </div>
      )}
    </GCard>
  );
}

