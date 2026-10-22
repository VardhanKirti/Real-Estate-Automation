'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Mark-done state and action, shared by both trees of /setup (the GladOS one is components/setup/SetupG.tsx). */
export function useManualCheck(id: string, marked: boolean) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch('/api/setup/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, done: !marked }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return { busy, toggle };
}

/** Check-off button for the manual setup steps (the only tickable boxes). */
export function SetupManualCheck({ id, marked }: { id: string; marked: boolean }) {
  const { busy, toggle } = useManualCheck(id, marked);

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={
        marked
          ? 'inline-flex items-center gap-2 rounded-[6px] border border-os-border-strong bg-os-surface2 px-3 py-1 text-[11.5px] text-os-muted transition-colors hover:bg-os-surface3 disabled:opacity-50'
          : 'inline-flex items-center gap-1.5 rounded-[6px] border border-os-border-strong bg-os-surface2 px-3 py-1 text-[11.5px] text-os-muted transition-colors hover:bg-os-surface3 hover:text-os-text disabled:opacity-50'
      }
    >
      {marked ? (
        <>
          <span className="dot ok" /> Done — undo
        </>
      ) : (
        'Mark done'
      )}
    </button>
  );
}
