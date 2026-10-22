'use client';

/**
 * F3 "unread dot on the Comms tab while unread": the sidebar asks the stored
 * digest's read state once (GET /api/comms/digest reads SQLite only) and
 * clears the dot the moment the digest is opened anywhere (DIGEST_READ_EVENT).
 */
import { useEffect, useState } from 'react';
import { DIGEST_READ_EVENT } from './hooks';

export function useDigestUnread(): boolean {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/comms/digest')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { digest: unknown; read: boolean } | null) => {
        if (live && b) setUnread(Boolean(b.digest) && !b.read);
      })
      .catch(() => {});
    const off = () => setUnread(false);
    window.addEventListener(DIGEST_READ_EVENT, off);
    return () => {
      live = false;
      window.removeEventListener(DIGEST_READ_EVENT, off);
    };
  }, []);
  return unread;
}
