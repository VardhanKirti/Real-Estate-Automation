'use client';

/**
 * Client-side actions for /clients, shared by the GladOS and Classic trees
 * (and the Legacy tree when it lands). Every call is a local SQLite write
 * except `launch`, which the route gates behind GLADOS_WRITES and an explicit
 * `confirm: true` (CL-3, AC-13); the UI asks first. After a write the server
 * view is re-read with router.refresh(), so no figure is computed twice.
 */
import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ClientWorkStatus } from '@/lib/schemas';

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

const errorOf = (d: Record<string, unknown>, fallback: string) => (typeof d.error === 'string' && d.error ? d.error : fallback);

export function useClients() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<ActionResult>): Promise<ActionResult> => {
      setBusy(key);
      try {
        const r = await fn();
        if (r.ok) router.refresh();
        return r;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'The request failed. Try again.' };
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  /** `?client=<id>` filters the requests to one client; null clears it. */
  const selectClient = useCallback(
    (clientId: string | null) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (clientId) next.set('client', clientId);
      else next.delete('client');
      const q = next.toString();
      router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const confirmAttio = (clientId: string, name: string) =>
    run(`confirm:${clientId}`, async () => {
      const r = await call('/api/clients/confirm', 'POST', { clientId, name, source: 'attio' });
      return r.ok ? { ok: true, id: clientId } : { ok: false, error: errorOf(r.data, 'Could not confirm this client.') };
    });

  const addManual = (name: string, company: string) =>
    run('add', async () => {
      const r = await call('/api/clients/confirm', 'POST', { name, company, source: 'manual' });
      const id = (r.data.client as { clientId?: string } | undefined)?.clientId;
      return r.ok ? { ok: true, id } : { ok: false, error: errorOf(r.data, 'Could not add this client.') };
    });

  const editClient = (input: { clientId: string; name: string; retainer: boolean; slackChannel: string; supersetProject: string }) =>
    run(`edit:${input.clientId}`, async () => {
      const r = await call('/api/clients/confirm', 'POST', input);
      return r.ok ? { ok: true, id: input.clientId } : { ok: false, error: errorOf(r.data, 'Could not save this client.') };
    });

  const unconfirm = (clientId: string) =>
    run(`unconfirm:${clientId}`, async () => {
      const r = await call('/api/clients/confirm', 'POST', { clientId, confirmed: false });
      return r.ok ? { ok: true } : { ok: false, error: errorOf(r.data, 'Could not unconfirm this client.') };
    });

  const saveDraft = (clientId: string, brief: string) =>
    run('draft', async () => {
      const r = await call('/api/clients/work', 'POST', { clientId, brief });
      const id = (r.data.work as { id?: string } | undefined)?.id;
      return r.ok ? { ok: true, id } : { ok: false, error: errorOf(r.data, 'Could not save the draft.') };
    });

  /** Gated: the caller shows the confirm dialog first; this sends `confirm: true`. */
  const launch = (id: string) =>
    run(`launch:${id}`, async () => {
      const r = await call(`/api/clients/work/${encodeURIComponent(id)}/launch`, 'POST', { confirm: true });
      return r.ok ? { ok: true, id } : { ok: false, error: errorOf(r.data, `Superset did not start (HTTP ${r.status}).`) };
    });

  const setStatus = (id: string, status: ClientWorkStatus) =>
    run(`status:${id}`, async () => {
      const r = await call(`/api/clients/work/${encodeURIComponent(id)}`, 'PATCH', { status });
      return r.ok ? { ok: true, id } : { ok: false, error: errorOf(r.data, 'Could not change the status.') };
    });

  return { busy, selectClient, confirmAttio, addManual, editClient, unconfirm, saveDraft, launch, setStatus };
}

export const BRIEF_PLACEHOLDER = 'Audience, deliverable, objective, offer and deadline…';
export const LAUNCH_DIALOG_TITLE = 'Start a draft in Superset?';
export const LAUNCH_DIALOG_BODY = 'An agent drafts in a new workspace. Nothing is sent to the client.';
