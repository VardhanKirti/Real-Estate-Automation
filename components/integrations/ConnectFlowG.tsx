'use client';

import { useState } from 'react';
import { GButton, GDialog, GField, GInput, GSheet, GTag } from '@/components/g';
import { useConnectFlow } from '@/components/ConnectFlow';

/**
 * A connection's footer under the GladOS style (SPEC S05 F05.72): the state
 * as a tag, and Connect opening the paste-a-key form in a sheet rather than
 * inline. Same endpoint and rules as the Classic ConnectFlow: connected is
 * never faked, a stored key on a connector-less tile reads "Key saved".
 * Disconnect removes stored keys, so it asks first (§3.1.8).
 */
export function ConnectFlowG({
  slug,
  name,
  connected,
  keySaved,
  keys,
  guidance,
}: {
  slug: string;
  /** Tool name for the sheet title. */
  name: string;
  connected: boolean;
  keySaved: boolean;
  keys: string[];
  guidance?: string;
}) {
  const { open, setOpen, values, setValues, busy, error, setError, save, disconnect } = useConnectFlow(slug);
  const [confirm, setConfirm] = useState(false);
  const missing = keys.some((k) => !(values[k] ?? '').trim());

  return (
    <div className="kg-connect">
      {connected ? (
        <GTag tone="ok" dot>
          Connected
        </GTag>
      ) : keySaved ? (
        <GTag tone="warn" dot title="A key is stored; the connector has not reported connected">
          Key saved
        </GTag>
      ) : (
        <GTag tone="outline">Not connected</GTag>
      )}
      {connected || keySaved ? (
        keySaved ? (
          <GButton variant="sm" busy={busy} onClick={() => setConfirm(true)}>
            Disconnect
          </GButton>
        ) : (
          <span className="kg-cap" title="Credentials managed outside the console (canonical machine files)">
            Managed
          </span>
        )
      ) : keys.length > 0 ? (
        <GButton variant="sm" onClick={() => setOpen(true)}>
          Connect
        </GButton>
      ) : (
        <span className="kg-cap" title={guidance ?? 'Connects through local setup, not a pasted key'}>
          Local setup
        </span>
      )}

      <GSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title={`Connect ${name}`}
        caption="Keys are written to .env.local on this host only, never to git."
        width={480}
        footer={
          <>
            <GButton
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </GButton>
            <GButton variant="ink" busy={busy} disabled={missing} disabledReason="Fill in every key first" onClick={() => void save()}>
              Save and connect
            </GButton>
          </>
        }
      >
        <div className="kg-form kg-form-wide">
          {keys.map((k) => (
            <GField key={k} label={<code data-mono-ok="">{k}</code>} htmlFor={`connect-${slug}-${k}`}>
              <GInput
                id={`connect-${slug}-${k}`}
                type="password"
                autoComplete="off"
                value={values[k] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
            </GField>
          ))}
          {error && <p className="kg-err-line">{error}</p>}
        </div>
      </GSheet>

      <GDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Disconnect ${name}?`}
        confirmLabel="Disconnect"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          setConfirm(false);
          void disconnect();
        }}
      >
        <p className="kg-body">The stored keys for {name} are removed from .env.local on this host.</p>
      </GDialog>
    </div>
  );
}
