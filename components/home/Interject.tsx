'use client';

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { GAsk } from '@/components/g';
import { useToast } from '@/components/ui/Toast';
import { INTERJECT_UNDO_MS } from '@/lib/interject';
import { taskHref } from '@/lib/home-today';

/**
 * Home's interject composer (founderos-ui pages/feature-additions.md F2).
 * One field: free text becomes a task, "tell/ask <agent> …" a task for that
 * agent, "note …" a note in the Optimal Engine inbox. The router is rule-based, no
 * LLM (lib/interject.ts, POST /api/interject). A created task gets a toast
 * with Undo for INTERJECT_UNDO_MS; an error shows inline under the field.
 */

export const INTERJECT_PLACEHOLDER = 'Tell an agent, add a task or note…';
export const INTERJECT_HINT = 'Free text adds a task · "tell <agent> …" hands it to an agent · "note …" saves a note';

type Created = { kind: 'task' | 'relay' | 'note'; id: string; href: string; agentId?: string; undo?: boolean };

function useInterject() {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async (id: string) => {
    try {
      const res = await fetch('/api/interject', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast(res.ok ? { text: 'Removed', tone: 'ok' } : { text: body.error ?? 'Could not undo', tone: 'err' });
    } catch {
      toast({ text: 'Could not undo: the server did not answer', tone: 'err' });
    }
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/interject', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: trimmed }) });
      const body = (await res.json().catch(() => ({}))) as Partial<Created> & { error?: string };
      if (!res.ok || !body.kind || !body.id) {
        setError(body.error ? `Not added: ${body.error}` : `Not added (error ${res.status})`);
        return;
      }
      setValue('');
      const id = body.id;
      if (body.kind === 'note') {
        toast({ text: 'Saved as a note', tone: 'ok' });
      } else {
        toast({
          text: body.kind === 'relay' ? `Added as a task for ${body.agentId}` : 'Added as a task',
          tone: 'ok',
          ms: INTERJECT_UNDO_MS,
          action: { label: 'Undo', onClick: () => void undo(id) },
          // the same deep link as Home's Needs you rows (lib/home-today.ts taskHref)
          link: { label: 'Open', href: body.href ?? taskHref(id) },
        });
      }
    } catch {
      setError('Not added: the server did not answer');
    } finally {
      setBusy(false);
    }
  };

  const change = (v: string) => {
    setValue(v);
    if (error) setError(null);
  };

  return { value, change, busy, error, submit };
}

/** GladOS: the kit's GAsk composer, full width under the heroes. */
export function InterjectG() {
  const c = useInterject();
  return (
    <div className="hg-interject" data-interject="">
      <GAsk
        label="Interject: add a task, hand work to an agent or save a note"
        placeholder={INTERJECT_PLACEHOLDER}
        value={c.value}
        onValueChange={c.change}
        onSubmit={c.submit}
        busy={c.busy}
        error={c.error}
        minChars={2}
      />
      <p className="hg-interject-hint">{INTERJECT_HINT}</p>
    </div>
  );
}

/**
 * Classic: an input bar in the console's card language. Under the Bennett
 * Legacy skin the same tree renders with a mono field and a block caret
 * (the `.h6-interject` rules in the Legacy block of app/globals.css).
 */
export function InterjectClassic() {
  const c = useInterject();
  const canSend = !c.busy && c.value.trim().length >= 2;
  return (
    <form
      className="h6-interject h6-card"
      data-interject=""
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) void c.submit(c.value);
      }}
    >
      <div className="h6-interject-row">
        <span className="h6-interject-caret" aria-hidden="true">
          ▌
        </span>
        <input
          className="h6-interject-input"
          value={c.value}
          onChange={(e) => c.change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && c.value) {
              e.preventDefault();
              c.change('');
            }
          }}
          placeholder={INTERJECT_PLACEHOLDER}
          aria-label="Interject: add a task, hand work to an agent or save a note"
          aria-invalid={c.error ? true : undefined}
          aria-describedby={c.error ? 'h6-interject-err' : 'h6-interject-hint'}
        />
        <button type="submit" className="h6-interject-send" disabled={!canSend} aria-label={c.busy ? 'Working' : 'Send'} title={canSend ? 'Send' : 'Type at least 2 characters'}>
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {c.error ? (
        <p id="h6-interject-err" className="h6-interject-err" role="alert">
          {c.error}
        </p>
      ) : (
        <p id="h6-interject-hint" className="h6-interject-hint">
          {INTERJECT_HINT}
        </p>
      )}
    </form>
  );
}
