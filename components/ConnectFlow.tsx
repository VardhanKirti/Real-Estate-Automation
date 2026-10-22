'use client';

/**
 * The live footer of a connection tile: Connect opens an inline paste-a-key
 * form (one field per env key), Save posts to /api/connections/connect (which
 * writes .env.local only), and the page refreshes into the connector's real
 * status — connected is never faked, a stored key on a connector-less tile
 * reads "key saved". Guidance-only tools (WhatsApp needs Full Disk Access,
 * IMAP inboxes, CalDAV) show their setup hint instead of a form.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConnectFlow({
  slug,
  connected,
  keySaved,
  keys,
  guidance,
}: {
  slug: string;
  connected: boolean;
  keySaved: boolean;
  keys: string[];
  /** Live connector detail for guidance-only tools (keys.length === 0). */
  guidance?: string;
}) {
  const flow = useConnectFlow(slug);
  return <ConnectFlowClassic {...flow} connected={connected} keySaved={keySaved} keys={keys} guidance={guidance} />;
}

/** Paste-a-key form state, save and disconnect, shared by both trees (GladOS: components/integrations/ConnectFlowG.tsx). */
export function useConnectFlow(slug: string) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connections/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, values }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(body.error ?? 'save failed');
      setOpen(false);
      setValues({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/connections/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return { open, setOpen, values, setValues, busy, error, setError, save, disconnect };
}

function ConnectFlowClassic({
  open, setOpen, values, setValues, busy, error, setError, save, disconnect, connected, keySaved, keys, guidance,
}: ReturnType<typeof useConnectFlow> & { connected: boolean; keySaved: boolean; keys: string[]; guidance?: string }) {
  const statusChip = connected ? (
    <span className="flex items-center gap-2.5 text-[12px] text-os-muted">
      <span className="dot ok" />
      Connected
    </span>
  ) : keySaved ? (
    <span className="flex items-center gap-2.5 text-[12px] text-os-muted">
      <span className="dot warn" />
      Key saved
    </span>
  ) : (
    <span className="flex items-center gap-2.5 text-[12px] text-os-dim">
      <span className="dot off" />
      Not connected
    </span>
  );

  if (open) {
    return (
      <div className="mt-4">
        {keys.map((k) => (
          <input
            key={k}
            type="password"
            autoComplete="off"
            placeholder={k}
            value={values[k] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
            className="mb-1.5 w-full rounded-sm-t border border-os-border bg-os-surface2 px-2 py-2.5 font-mono text-[12px] text-os-text placeholder:text-os-dim focus:border-os-border-strong focus:outline-none"
          />
        ))}
        {error && (
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-os-muted">
            <span className="dot err" /> {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="rounded-sm-t px-2.5 py-1 text-[12px] text-os-dim transition-colors hover:text-os-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || keys.some((k) => !(values[k] ?? '').trim())}
            onClick={() => void save()}
            className="rounded-sm-t bg-os-accent px-3 py-1 text-[12px] font-medium text-os-ink transition-colors hover:bg-os-accent2 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save & connect'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center justify-between">
      {statusChip}
      {connected || keySaved ? (
        keySaved ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void disconnect()}
            className="rounded-sm-t px-2.5 py-1 text-[12px] text-os-dim transition-colors hover:text-os-text disabled:opacity-40"
          >
            Disconnect
          </button>
        ) : (
          <span
            title="Credentials managed outside the console (canonical machine files)"
            className="c-chip cursor-default"
          >
            Managed
          </span>
        )
      ) : keys.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sm-t border border-os-border-strong bg-os-surface2 px-3 py-1 text-[12px] text-os-text transition-colors hover:bg-os-surface3"
        >
          Connect
        </button>
      ) : (
        <span
          title={guidance ?? 'Connects through local setup, not a pasted key'}
          className="c-chip cursor-help"
        >
          Setup
        </span>
      )}
    </div>
  );
}
