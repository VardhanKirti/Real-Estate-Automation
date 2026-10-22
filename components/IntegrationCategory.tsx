'use client';

import { useCallback, useState } from 'react';
import { useHashOpen } from '@/components/integrations/useHashOpen';

/**
 * A collapsible category row in the "Browse by category" section. Thin client
 * wrapper: the card grid is rendered on the server and passed as children; this
 * only toggles its visibility and animates the chevron.
 */
export function IntegrationCategory({
  label,
  count,
  defaultOpen = false,
  slugs,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  /** tool slugs inside: a matching #hash opens the category (SetupLink deep links) */
  slugs?: readonly string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useHashOpen(slugs, useCallback(() => setOpen(true), []));
  return (
    <div className="rounded-lg-t border border-os-border bg-os-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          className={`shrink-0 text-os-dim transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex-1 text-[14px] font-medium text-os-text">{label}</span>
        <span className="c-chip">{count}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}
