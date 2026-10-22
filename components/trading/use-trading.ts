'use client';

/**
 * The /trading behaviour every tree shares (pages/trading.md §4): the account
 * toggle and log filter (mirrored to ?acct= and ?log= without a server round
 * trip), Refresh, the limits form with per-field validation, the autopilot
 * switch behind its confirm, and Copy push URL. Trees render; this decides.
 * GladOS never places an order: the only writes are PATCH /api/trading/limits.
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { checkLimit, type ActivityFilter, type TradingModel } from '@/lib/trading-model';
import { LIMIT_LABELS } from '@/lib/trading-view';
import type { TradeActivity } from '@/lib/schemas';


function setParam(key: string, value: string | null) {
  try {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* the URL is a convenience; the state still changes */
  }
}

export function useTrading(model: TradingModel, pushPath: string) {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, startRefresh] = useTransition();

  const [acct, setAcctState] = useState<string | null>(model.initialAcct);
  const [log, setLogState] = useState<ActivityFilter>(model.initialLog);
  const setAcct = useCallback((id: string) => {
    setAcctState(id);
    setParam('acct', id);
  }, []);
  const setLog = useCallback((f: ActivityFilter) => {
    setLogState(f);
    setParam('log', f === 'all' ? null : f);
  }, []);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  // ── trade sheet and positions sheet ──
  const [openTrade, setOpenTrade] = useState<TradeActivity | null>(null);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // ── limits form ──
  const initial = useMemo(
    () => Object.fromEntries(model.limits.fields.map((f) => [f.key, f.stored === null ? '' : String(f.stored)])) as Record<string, string>,
    [model.limits.fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setValues(initial);
    setTouched({});
  }, [initial]);

  const checks = useMemo(
    () => Object.fromEntries(model.limits.fields.map((f) => [f.key, checkLimit(f, values[f.key] ?? '')])),
    [model.limits.fields, values],
  );
  const dirty = model.limits.fields.some((f) => (values[f.key] ?? '') !== initial[f.key]);
  const invalid = model.limits.fields.some((f) => checks[f.key].error);
  const fieldError = (key: string) => (touched[key] || saveError ? checks[key]?.error ?? null : null);
  const setValue = (key: string, v: string) => {
    setValues((s) => ({ ...s, [key]: v }));
    setSaveError(null);
  };
  const blur = (key: string) => setTouched((s) => ({ ...s, [key]: true }));

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/trading/limits', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; clamped?: string[] };
    if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
    return json;
  }, []);

  const saveReason = model.readOnly
    ? model.readOnlyReason!
    : invalid
      ? 'Fix the highlighted fields first'
      : !dirty
        ? 'Nothing changed'
        : undefined;

  const save = useCallback(async () => {
    if (model.readOnly) return;
    if (invalid) {
      setSaveError('Fix the highlighted fields first');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = Object.fromEntries(model.limits.fields.map((f) => [f.key, checks[f.key].value]));
      const res = await patch(body);
      const held = (res.clamped ?? []).map((k) => LIMIT_LABELS[k as keyof typeof LIMIT_LABELS]?.label ?? k);
      toast({ text: held.length ? `Limits saved. Held inside range: ${held.join(', ')}.` : 'Limits saved.', tone: 'ok' });
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [model.readOnly, model.limits.fields, invalid, checks, patch, toast, router]);

  // ── autopilot ──
  const autopilot = model.limits.saved?.autopilot ?? false;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const autopilotReason = model.readOnly ? model.readOnlyReason! : !model.limits.saved ? 'Save limits first: autopilot runs inside them' : undefined;

  const setAutopilot = useCallback(
    async (next: boolean, confirmed = false) => {
      if (autopilotReason) return;
      if (next && !confirmed) {
        setConfirmOpen(true);
        return;
      }
      setSwitching(true);
      try {
        await patch(next ? { autopilot: true, confirm: true } : { autopilot: false });
        setConfirmOpen(false);
        toast({ text: next ? 'Autopilot on. The Markets agent may place orders inside these limits.' : 'Autopilot off. Runs are dry runs again.', tone: 'ok' });
        router.refresh();
      } catch (e) {
        toast({ text: e instanceof Error ? e.message : 'Could not change autopilot', tone: 'err' });
      } finally {
        setSwitching(false);
      }
    },
    [autopilotReason, patch, toast, router],
  );

  // ── push URL (origin is the browser's; never the token) ──
  const [pushUrl, setPushUrl] = useState(pushPath);
  useEffect(() => {
    try {
      setPushUrl(new URL(pushPath, window.location.origin).toString());
    } catch {
      /* keep the path */
    }
  }, [pushPath]);
  const copyPushUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pushUrl);
      toast({ text: 'Push URL copied', tone: 'ok' });
    } catch {
      toast({ text: 'Could not reach the clipboard. Select the URL and copy it.', tone: 'err' });
    }
  }, [pushUrl, toast]);

  return {
    acct,
    setAcct,
    log,
    setLog,
    refresh,
    refreshing,
    openTrade,
    setOpenTrade,
    positionsOpen,
    setPositionsOpen,
    notesOpen,
    setNotesOpen,
    limits: { values, setValue, blur, fieldError, dirty, invalid, save, saving, saveError, saveReason },
    autopilot: { on: autopilot, setAutopilot, confirmOpen, setConfirmOpen, switching, reason: autopilotReason },
    pushUrl,
    copyPushUrl,
  };
}

export type TradingUi = ReturnType<typeof useTrading>;
