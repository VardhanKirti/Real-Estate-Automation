'use client';

/**
 * API keys panel for the Connections board. Reads masked slot statuses,
 * writes new values to .env.local via POST /api/keys (live immediately).
 * Raw secrets are never displayed back.
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Check } from 'lucide-react';
import type { KeyStatus } from '@/lib/keys';

export function ApiKeys() {
  const { groups, editing, setEditing, value, setValue, savedVar, error, setError, save } = useApiKeys();
  return <ApiKeysClassic {...{ groups, editing, setEditing, value, setValue, savedVar, error, setError, save }} />;
}

/** Key slots (GET /api/keys) and set/rotate (POST /api/keys), shared by both trees (GladOS: components/integrations/ApiKeysG.tsx). */
export function useApiKeys() {
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [savedVar, setSavedVar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch('/api/keys')
      .then((r) => r.json())
      .then((b) => setKeys(b.keys ?? []))
      .catch(() => setError('could not load key statuses'));

  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, KeyStatus[]>();
    for (const k of keys) {
      if (!map.has(k.group)) map.set(k.group, []);
      map.get(k.group)!.push(k);
    }
    return [...map.entries()];
  }, [keys]);

  const save = async (envVar: string) => {
    if (!value.trim()) return;
    setError(null);
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVar, value: value.trim() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === 'string' ? body.error : 'save failed');
      return;
    }
    setValue('');
    setEditing(null);
    setSavedVar(envVar);
    setTimeout(() => setSavedVar(null), 2500);
    load();
  };
  return { keys, groups, editing, setEditing, value, setValue, savedVar, error, setError, save, loaded: keys.length > 0 };
}

function ApiKeysClassic({
  groups, editing, setEditing, value, setValue, savedVar, error, setError, save,
}: Pick<ReturnType<typeof useApiKeys>, 'groups' | 'editing' | 'setEditing' | 'value' | 'setValue' | 'savedVar' | 'error' | 'setError' | 'save'>) {
  return (
    <section className="mt-10">
      <div className="mb-1 flex items-center gap-3">
        <KeyRound className="h-4 w-4 text-os-muted" strokeWidth={1.6} />
        <h2 className="text-[13px] font-medium text-os-muted">API keys</h2>
      </div>
      <p className="mb-4 text-xs text-os-dim">
        Stored in <code className="font-mono">.env.local</code> (gitignored), applied live. Values shown masked — the OS never
        echoes a secret back.
      </p>
      {error && (
        <p className="mb-4 flex items-center gap-2.5 text-[12.5px] text-os-muted">
          <span className="dot err" /> {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([group, slots]) => (
          <div key={group} className="hoverable rounded-lg-t border border-os-border bg-os-surface p-6">
            <h3 className="mb-2 text-xs font-medium">{group}</h3>
            <ul className="space-y-2.5">
              {slots.map((slot) => (
                <li key={slot.envVar} className="text-[12.5px]">
                  <div className="flex items-center gap-3">
                    <span className={`dot ${slot.present ? 'ok' : 'off'}`} />
                    <span className="w-40 truncate font-mono text-os-muted" title={slot.envVar}>
                      {slot.envVar}
                    </span>
                    <span className="font-mono text-os-dim">{slot.present ? slot.masked : 'not set'}</span>
                    {savedVar === slot.envVar && <Check className="h-3 w-3 text-os-text" />}
                    <button
                      onClick={() => {
                        setEditing(editing === slot.envVar ? null : slot.envVar);
                        setValue('');
                        setError(null);
                      }}
                      className="ml-auto text-[11.5px] text-os-dim hover:text-os-text"
                    >
                      {editing === slot.envVar ? 'cancel' : slot.present ? 'rotate' : 'set'}
                    </button>
                  </div>
                  {editing === slot.envVar && (
                    <div className="mt-1.5 flex gap-2.5 pl-3.5">
                      <input
                        type="password"
                        autoFocus
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && save(slot.envVar)}
                        placeholder={slot.hint ?? 'paste value'}
                        className="flex-1 rounded-sm-t border border-os-border-strong bg-os-surface2 px-2 py-1 font-mono text-[12.5px] text-os-text placeholder:text-os-dim focus:border-os-dim focus:outline-none"
                      />
                      <button
                        onClick={() => save(slot.envVar)}
                        className="rounded-sm-t bg-os-accent px-2.5 py-1 text-[12px] font-medium text-os-ink transition-colors hover:bg-os-accent2"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
