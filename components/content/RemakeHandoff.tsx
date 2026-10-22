'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { requestCompose, type ComposeRequest } from '@/lib/content-compose';

/**
 * Cross-page hand-off into the Composer: AdPilot's "Remake" stashes a
 * ComposeRequest in sessionStorage and navigates to /content?remake=1;
 * this reads it once, fires the compose bus, and cleans up. Renders nothing.
 */
// Module-level so the payload survives StrictMode's dev-mode double effect
// (first run consumes sessionStorage, its cleanup cancels the timers, and
// the second run would otherwise find nothing to fire).
let pending: ComposeRequest | null = null;

export function RemakeHandoff() {
  const params = useSearchParams();
  const flagged = params.get('remake') === '1';

  useEffect(() => {
    if (!flagged) return;
    try {
      const raw = sessionStorage.getItem('glados:remake');
      if (raw) pending = JSON.parse(raw) as ComposeRequest;
      sessionStorage.removeItem('glados:remake');
    } catch {
      /* storage unavailable — pending keeps whatever an earlier run read */
    }
    const payload = pending;
    if (!payload) return;
    // The Composer hydrates on its own schedule — fire a few times over the
    // first second so the bus listener is guaranteed to catch one; repeat
    // deliveries just re-apply the same prefill.
    const ids = [120, 450, 1000].map((ms) => window.setTimeout(() => requestCompose(payload), ms));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [flagged]);

  return null;
}
