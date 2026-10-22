'use client';

/**
 * F9 behaviour shared by the GladOS and Classic agents trees: deliverable
 * decisions (POST /api/agents/deliverables/decision, one per run, A-1) and
 * failover (PATCH /api/agents/[id]/failover with `confirm: true`, A-2). The
 * confirm step itself is each tree's own dialog; these only send once the
 * operator has confirmed.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import type { Deliverable, ReviewView } from '@/lib/agent-review';

export function useReview(initial: ReviewView) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(initial.pending);
  const [decided, setDecided] = useState(initial.decided);
  const [busy, setBusy] = useState<string | null>(null);

  const decide = useCallback(
    async (item: Deliverable, decision: 'approved' | 'rejected', reason = '') => {
      setBusy(item.runId);
      try {
        const res = await fetch('/api/agents/deliverables/decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ runId: item.runId, decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok && res.status !== 409) {
          toast({ text: body.error ?? 'The decision was not saved.', tone: 'err' });
          return false;
        }
        // 409 = this run already had a decision (A-1): drop it from the queue either way.
        setPending((p) => p.filter((x) => x.runId !== item.runId));
        if (res.ok) setDecided((d) => [{ ...item, decision, reason: reason.trim(), at: new Date().toISOString() }, ...d].slice(0, 20));
        toast({ text: res.ok ? `${decision === 'approved' ? 'Approved' : 'Rejected'}: ${item.agentName}` : 'This run was already decided.', tone: res.ok ? 'ok' : 'info' });
        router.refresh();
        return true;
      } catch {
        toast({ text: 'The decision was not saved. Check the connection and try again.', tone: 'err' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [router, toast],
  );

  return { pending, decided, busy, decide };
}

export function useFailover(agentId: string, agentName: string, initialModel: string) {
  const router = useRouter();
  const { toast } = useToast();
  const [model, setModel] = useState(initialModel);
  const [busy, setBusy] = useState(false);

  /** Call only after the operator confirmed (AC-13). */
  const switchTo = useCallback(
    async (next: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/failover`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: next, confirm: true }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; model?: string };
        if (!res.ok) {
          toast({ text: body.error ?? 'Failover did not go through.', tone: 'err' });
          return false;
        }
        setModel(next);
        toast({ text: `${agentName} now runs on ${next}. Logged to its run history.`, tone: 'ok' });
        router.refresh();
        return true;
      } catch {
        toast({ text: 'Failover did not go through. Check the connection and try again.', tone: 'err' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [agentId, agentName, router, toast],
  );

  return { model, busy, switchTo };
}

/** "3h ago" style age for a finished run. */
export function age(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
