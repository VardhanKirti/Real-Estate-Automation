'use client';

import { useEffect } from 'react';

/**
 * Opens a closed category when the URL hash names one of its tools, then scrolls that card
 * into view. Every SetupLink deep-links to /integrations#<slug>; without this a tool inside
 * a collapsed category (Apify sits in Marketing) was never shown, so "Set up" landed nowhere.
 */
export function useHashOpen(slugs: readonly string[] | undefined, open: () => void) {
  useEffect(() => {
    if (!slugs?.length) return;
    const check = () => {
      const slug = decodeURIComponent(window.location.hash.replace(/^#/, ''));
      if (!slug || !slugs.includes(slug)) return;
      open();
      // the card mounts on the next render; scroll once it exists
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(slug)?.scrollIntoView({ block: 'center' })));
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
    // slugs is a fresh array per server render; its contents are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs?.join(','), open]);
}
