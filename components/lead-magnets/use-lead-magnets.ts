'use client';

/**
 * Client-side actions and the register/edit form state for /lead-magnets,
 * shared by the GladOS and Classic trees (and the Legacy tree later). Every
 * write is local SQLite; the schema (https URL, name 1-120) is enforced by
 * the route and its 400 is shown inline (LM-1). Delete is confirmed in the
 * UI first and removes the record only (LM-2).
 */
import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { LeadMagnet, LeadMagnetStatus } from '@/lib/schemas';

export type MagnetForm = {
  name: string;
  offer: string;
  liveUrl: string;
  destination: 'email' | 'booking';
  campaign: string;
  status: LeadMagnetStatus;
  wentLiveAt: string;
  notes: string;
};

export const EMPTY_FORM: MagnetForm = { name: '', offer: '', liveUrl: '', destination: 'email', campaign: '', status: 'draft', wentLiveAt: '', notes: '' };

export const PLACEHOLDERS = {
  name: 'The Claude Trading Setup',
  offer: 'The setup, the prompt and the guardrails',
  campaign: 'IG reel (comment TRADE)',
  liveUrl: 'https://…',
} as const;

export function formFrom(m: LeadMagnet): MagnetForm {
  return { name: m.name, offer: m.offer, liveUrl: m.liveUrl, destination: m.destination, campaign: m.campaign, status: m.status, wentLiveAt: m.wentLiveAt ?? '', notes: m.notes };
}

/** Field errors from the client before sending (the server checks again). */
export function validateForm(f: MagnetForm): Partial<Record<keyof MagnetForm, string>> {
  const e: Partial<Record<keyof MagnetForm, string>> = {};
  if (!f.name.trim()) e.name = 'Name the page.';
  else if (f.name.trim().length > 120) e.name = 'Keep the name under 120 characters.';
  try {
    const u = new URL(f.liveUrl.trim());
    if (u.protocol !== 'https:') e.liveUrl = 'Use the https:// address of the page.';
  } catch {
    e.liveUrl = 'Paste the full https:// address of the page.';
  }
  return e;
}

type Issues = { fieldErrors?: Record<string, string[] | undefined> };

/** Map a 400's zod issues onto form fields. */
function serverErrors(data: Record<string, unknown>): Partial<Record<keyof MagnetForm, string>> & { _form?: string } {
  const out: Partial<Record<keyof MagnetForm, string>> & { _form?: string } = {};
  const fe = (data.issues as Issues | undefined)?.fieldErrors ?? {};
  for (const [k, v] of Object.entries(fe)) if (v?.[0]) out[k as keyof MagnetForm] = k === 'liveUrl' ? 'Use the https:// address of the page.' : v[0];
  if (!Object.keys(out).length) out._form = typeof data.error === 'string' ? data.error : 'That did not save. Try again.';
  return out;
}

function body(f: MagnetForm) {
  return {
    name: f.name.trim(),
    offer: f.offer.trim(),
    liveUrl: f.liveUrl.trim(),
    destination: f.destination,
    campaign: f.campaign.trim(),
    status: f.status,
    wentLiveAt: f.wentLiveAt || null,
    notes: f.notes.trim(),
  };
}

export type SaveResult = { ok: true } | { ok: false; errors: Partial<Record<keyof MagnetForm, string>> & { _form?: string } };

export function useLeadMagnets() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  const send = useCallback(
    async (key: string, url: string, method: string, payload?: unknown): Promise<SaveResult> => {
      setBusy(key);
      try {
        const res = await fetch(url, { method, headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) return { ok: false, errors: serverErrors(data) };
        router.refresh();
        return { ok: true };
      } catch {
        return { ok: false, errors: { _form: 'The request failed. Try again.' } };
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const setFilter = useCallback(
    (status: LeadMagnetStatus | null) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (status) next.set('status', status);
      else next.delete('status');
      const q = next.toString();
      router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return {
    busy,
    setFilter,
    create: (f: MagnetForm) => send('create', '/api/lead-magnets', 'POST', body(f)),
    update: (id: string, f: MagnetForm) => send(`edit:${id}`, `/api/lead-magnets/${encodeURIComponent(id)}`, 'PATCH', body(f)),
    setStatus: (id: string, status: LeadMagnetStatus) => send(`status:${id}`, `/api/lead-magnets/${encodeURIComponent(id)}`, 'PATCH', { status }),
    remove: (id: string) => send(`delete:${id}`, `/api/lead-magnets/${encodeURIComponent(id)}`, 'DELETE'),
  };
}

/** Copy to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
