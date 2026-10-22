'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';
import { OsMark } from './Marks';

/**
 * The FounderOS shell pieces the GladOS sidebar wears under Bennett Legacy
 * (FO chrome/Sidebar.svelte, SCAFFOLD §3.2). Only rendered when
 * data-ui='legacy', so GladOS and Classic keep their own DOM. The brand comes
 * from BRAND, never a hard-coded product name (SPEC AC-15).
 */

/** Logo lockup: the mark, the product name, the operator subtitle. The rail shows the mark only (CSS). */
export function LegacySideHead() {
  return (
    <Link href="/" className="l-side-lockup" data-l="SideLockup" title={BRAND.name}>
      <OsMark size={34} className="l-side-mark" />
      <span className="l-side-word">
        <span className="l-side-name">{BRAND.name}</span>
        <span className="l-side-sub">Operator mode</span>
      </span>
    </Link>
  );
}

type Live = { up: number; total: number };

/**
 * Footer status strip: "n/N systems live" from the shared connector board
 * (GET /api/connections/summary), then this host and the store. Until the
 * count arrives it shows a dash, never a made-up number; an error keeps the dash.
 */
export function LegacySideFoot() {
  const [live, setLive] = useState<Live | null>(null);
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    setHost(window.location.host);
    const ctrl = new AbortController();
    fetch('/api/connections/summary', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Live | null) => {
        if (d && Number.isFinite(d.up) && Number.isFinite(d.total)) setLive({ up: d.up, total: d.total });
      })
      .catch(() => {
        /* unknown stays a dash */
      });
    return () => ctrl.abort();
  }, []);
  const ok = !!live && live.up > 0;
  const label = live ? `${live.up} of ${live.total} systems live` : 'Systems live: checking';
  return (
    <div className="l-side-foot" data-l="SideFoot">
      <Link href="/integrations" className="l-side-live" title={label} aria-label={label}>
        <span className={`l-dot ${ok ? 'ok pulse' : 'off'}`} aria-hidden />
        <span className="l-side-foot-text">{live ? `${live.up}/${live.total}` : '-/-'} systems live</span>
      </Link>
      <div className="l-side-host l-side-foot-text">{host ?? '…'} · sqlite</div>
    </div>
  );
}

/** The brand mark in the topbar's right corner (FO Topbar). */
export function LegacyTopbarMark() {
  return <OsMark size={26} className="l-top-mark" />;
}
