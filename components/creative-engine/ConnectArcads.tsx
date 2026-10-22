'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import { VIDEO_MODELS, type VideoModel } from '@/lib/creative-engine/schemas';
import { api, ApiError, type HealthSnapshot, type SetupState } from '@/components/creative-engine/api';
import { Drawer } from '@/components/creative-engine/Widget';
import { ErrorLine, Progress, ago } from '@/components/creative-engine/primitives';
import { fmtCredits } from '@/lib/creative-engine/format';
import { capError, parseCap } from '@/lib/creative-engine/connect';
import { useToast } from '@/components/ui/Toast';
import { Btn, Input, PickPill, Select } from '@/components/creative-engine/skin';

const SAMPLE_OFF = 'Sample data: actions are off';
const FILMING_NO_PRODUCT = 'Filming mode: creating Arcads products is off';

/**
 * Connect Arcads, inside the software (PLAN.md phase 5). Four steps, each
 * answered by a real call and shown with its exact result:
 *   1 key    → written to .env.local by /api/connections/connect, never echoed
 *   2 verify → the free probes and GET /v1/credits: plan, balance, period
 *   3 product→ the product every generation files under (required field)
 *   4 first run → one cheapest request on a model, recorded by the poll
 * Plus the engine settings the cap and the UGC path live in.
 *
 * SPEC G8: every disabled control says why; anything that spends or writes to
 * the Arcads account (Create product, Run the probe) asks first and names the
 * cost; the cap refuses an empty or zero value; resetting the session count
 * can be undone for five seconds; a load error has Retry. In Filming, product
 * creation is off (Q-ENG-14) and the probe runs dry (Q-ENG-7).
 */
export function ConnectArcads({ health, readOnly = false, onClose, onChanged, back, backLabel }: { health: HealthSnapshot; readOnly?: boolean; onClose: () => void; onChanged: () => Promise<void>; back?: { label: string; onClick: () => void }; backLabel?: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<SetupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState('');
  const [probeModel, setProbeModel] = useState<VideoModel>('seedance-2.0-mini');
  const [cap, setCap] = useState<string>('');
  const [ask, setAsk] = useState<'create' | 'probe' | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await api.setup();
      setState(s);
      setCap(String(s.settings.sessionCreditCap));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the setup state.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<string | null>) => {
    if (readOnly) return;
    setBusy(label); setError(null); setNotice(null); setAsk(null);
    try {
      const n = await fn();
      if (n) setNotice(n);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(null);
    }
  };

  const saveKey = () => run('key', async () => {
    const v = key.trim();
    if (!v) throw new Error('Paste the key first.');
    await api.connectKey('arcads', { ARCADS_BASIC_AUTH: v });
    setKey('');
    const r = await api.setupAction({ action: 'verify' });
    const auth = r.health?.auth;
    return auth?.ok ? 'Key saved and accepted by Arcads.' : `Key saved, but Arcads rejected it: ${auth?.error ?? 'unknown'}`;
  });
  const verify = () => run('verify', async () => {
    const r = await api.setupAction({ action: 'verify' });
    const h = r.health ?? {};
    const bad = Object.entries(h).filter(([k, v]) => ['auth', 'catalog', 'credits'].includes(k) && !v.ok);
    return bad.length ? `${bad.map(([k, v]) => `${k}: ${v.error}`).join('; ')}` : `Sign-in, catalog and balance all answered${r.credits?.creditsRemaining != null ? `: ${fmtCredits(r.credits.creditsRemaining)} credits remaining` : ''}.`;
  });
  const pickProduct = (id: string, name: string) => run('product', async () => { await api.setupAction({ action: 'product', productId: id, productName: name }); return `Generations file under ${name}.`; });
  const createProduct = () => run('create', async () => {
    const name = newProduct.trim();
    if (!name) throw new Error('Name the product first.');
    const r = await api.setupAction({ action: 'createProduct', name, description: '' });
    setNewProduct('');
    return `Created ${r.product?.name ?? name} and selected it.`;
  });
  const saveSettings = (patch: { ugcPath?: 'v2' | 'v1'; sessionCreditCap?: number }) => run('settings', async () => { await api.setupAction({ action: 'settings', ...patch }); return 'Saved.'; });
  const firstRun = () => run('probe', async () => {
    const r = await api.probeModel(probeModel, false);
    return `Probe submitted (run ${r.runId}). The result lands in the health list when Arcads delivers; the raw reply is kept on the run.`;
  });
  /** A8: reset the counter, with Undo for five seconds (puts the previous session start back). */
  const newSession = () => {
    const before = state?.settings.sessionStartedAt ?? null;
    const spent = health.arcads.sessionSpent;
    void run('session', async () => {
      await api.setupAction({ action: 'newSession' });
      toast({
        text: `Session count reset (was ${fmtCredits(spent)} ${spent === 1 ? 'credit' : 'credits'}).`,
        tone: 'ok',
        ms: 5000,
        action: { label: 'Undo', onClick: () => void run('session', async () => { await api.setupAction({ action: 'settings', sessionStartedAt: before }); return 'Session count restored.'; }) },
      });
      return 'Session counter reset to zero.';
    });
  };

  const s = state;
  const auth = s?.health.auth;
  const credits = s?.health.credits;
  const balance = s?.balance ?? health.arcads.balance;
  const filming = health.filming;
  const step = (n: number, done: boolean, title: string) => (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full text-[12px]" style={{ background: done ? 'var(--p-green)' : 'var(--p-card)', color: done ? 'var(--p-on-hero)' : 'var(--p-ink)' }}>{done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : n}</span>
      <h3 className="text-[15px] font-light">{title}</h3>
    </div>
  );

  // Why each control is off right now (§3.1.3); null = enabled.
  const busyWhy = busy !== null ? 'Wait for the step in progress' : null;
  const keyWhy = readOnly ? SAMPLE_OFF : busyWhy ?? (!key.trim() ? 'Paste the key first' : null);
  const verifyWhy = readOnly ? SAMPLE_OFF : busyWhy ?? (s && !s.configured ? 'Save the Arcads key first' : null);
  const pickWhy = readOnly ? SAMPLE_OFF : busyWhy;
  const createWhy = readOnly ? SAMPLE_OFF : filming ? FILMING_NO_PRODUCT : busyWhy ?? (s && !s.configured ? 'Save the Arcads key first' : !newProduct.trim() ? 'Name the product first' : null);
  const probeWhy = readOnly ? SAMPLE_OFF : busyWhy ?? (s && !s.configured ? 'Save the Arcads key first' : s && !s.settings.arcadsProductId ? 'Choose a product first' : null);
  const capValue = parseCap(cap);
  const capErr = capError(cap);
  const capUnchanged = s ? capValue === s.settings.sessionCreditCap : true;
  const capWhy = readOnly ? SAMPLE_OFF : busyWhy ?? (capErr ? capErr : capUnchanged ? 'The cap is unchanged' : null);
  const pathWhy = readOnly ? SAMPLE_OFF : busyWhy;
  const sessionWhy = readOnly ? SAMPLE_OFF : busyWhy;
  const probeCost = health.dry || filming
    ? `${filming ? 'Filming' : 'Dry run'}: a fixture probe on ${probeModel}, nothing is charged.`
    : `Spends credits on ${probeModel} (one request).`;

  return (
    <Drawer title="Connect Arcads" onClose={onClose} back={back} backLabel={backLabel}>
      {!s ? (loadError ? (
        <div className="flex flex-wrap items-center gap-3 py-6" data-load-error>
          <span className="text-[13px] text-[var(--p-red)]">Couldn&apos;t read the setup state.</span>
          <Btn size="sm" onClick={() => void load()}>Retry</Btn>
          <span className="ae-faint w-full">{loadError}</span>
        </div>
      ) : <Progress text="Reading the setup state" />) : (
        <div className="space-y-4">
          {readOnly && <p className="ae-cap">Sample data: the steps are shown but switched off.</p>}
          {filming && !readOnly && <p className="ae-cap">Filming: requests run as fixtures and nothing is charged. Creating Arcads products is off.</p>}

          <section className="ae-card-3 p-4">
            {step(1, s.configured, s.configured ? 'Key on file' : 'Paste the API key')}
            <p className="ae-faint mt-2 leading-snug">app.arcads.ai → settings → API. Paste the base64 value or the full “Basic …” header. It is written to .env.local and never shown again.</p>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!keyWhy) void saveKey(); }}>
              <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.configured ? 'Replace the stored key' : 'Basic …'} aria-label="Arcads API key" className="min-w-0 flex-1" autoComplete="off" disabled={readOnly} title={readOnly ? SAMPLE_OFF : undefined} />
              <Btn type="submit" tone="ink" disabled={!!keyWhy} title={keyWhy ?? 'Save the key and run the free checks'}>{busy === 'key' ? 'Saving' : s.configured ? 'Replace' : 'Save'}</Btn>
            </form>
          </section>

          <section className="ae-card-3 p-4">
            {step(2, !!auth?.ok && !!credits?.ok, 'Verify the connection')}
            <div className="mt-3 grid gap-1.5 text-[12.5px]">
              {(['auth', 'catalog', 'credits'] as const).map((k) => {
                const v = s.health[k];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: !v ? 'var(--p-dim)' : v.ok ? 'var(--p-green)' : 'var(--p-red)' }} />
                    <span className="w-16">{k === 'auth' ? 'Sign-in' : k === 'catalog' ? 'Catalog' : 'Balance'}</span>
                    <span className="ae-faint min-w-0 truncate">{!v ? 'not checked' : v.ok ? `ok, ${ago(v.lastProbeAt)}` : v.error}</span>
                  </div>
                );
              })}
            </div>
            {balance && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                <span>{balance.creditsRemaining != null ? fmtCredits(balance.creditsRemaining) : '—'} <span className="ae-faint">credits remaining</span></span>
                <span>{balance.creditsIncluded != null ? fmtCredits(balance.creditsIncluded) : '—'} <span className="ae-faint">included this period</span></span>
                {balance.plan && <span>{balance.plan} <span className="ae-faint">plan</span></span>}
                {balance.periodEnd && <span className="ae-faint">renews {new Date(balance.periodEnd).toLocaleDateString()}</span>}
              </div>
            )}
            <Btn onClick={() => void verify()} disabled={!!verifyWhy} title={verifyWhy ?? 'Sign-in, catalog and balance; free'} className="mt-3">{busy === 'verify' ? 'Checking' : 'Run the free checks'}</Btn>
          </section>

          <section className="ae-card-3 p-4">
            {step(3, !!s.settings.arcadsProductId, s.settings.arcadsProductName ? `Product: ${s.settings.arcadsProductName}` : 'Choose the product')}
            <p className="ae-faint mt-2 leading-snug">Every generation is filed under an Arcads product. Pick one from the workspace or create one.</p>
            {s.productsError && <ErrorLine text={s.productsError} />}
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Arcads product">
              {s.products.map((p) => {
                const on = s.settings.arcadsProductId === p.id;
                return <PickPill key={p.id} on={on} onClick={() => void pickProduct(p.id, p.name)} disabled={!!pickWhy} title={pickWhy ?? (on ? 'Generations file under this product' : `File generations under ${p.name}`)}>{p.name}{on && <Check className="h-3.5 w-3.5" strokeWidth={2.2} />}</PickPill>;
              })}
              {s.products.length === 0 && !s.productsError && <span className="ae-faint">{s.configured ? 'No products in the workspace yet.' : 'Connect first.'}</span>}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!createWhy) setAsk('create'); }}>
              <Input value={newProduct} onChange={(e) => { setNewProduct(e.target.value); if (ask === 'create') setAsk(null); }} placeholder="New product name" aria-label="New product name" maxLength={80} disabled={readOnly || filming} title={readOnly ? SAMPLE_OFF : filming ? FILMING_NO_PRODUCT : undefined} className="min-w-0 flex-1" />
              <Btn type="submit" disabled={!!createWhy || ask === 'create'} title={createWhy ?? 'Asks before it writes to your Arcads account'}>{busy === 'create' ? 'Creating' : 'Create'}</Btn>
            </form>
            {ask === 'create' && (
              <div className="ae-confirm text-[12.5px]" role="group" aria-label="Confirm creating the product">
                <span className="min-w-0 flex-1">Creates “{newProduct.trim()}” in your Arcads account.</span>
                <Btn size="sm" tone="ink" onClick={() => void createProduct()} autoFocus>Create</Btn>
                <Btn size="sm" onClick={() => setAsk(null)}>Cancel</Btn>
              </div>
            )}
          </section>

          <section className="ae-card-3 p-4">
            {step(4, VIDEO_MODELS.some((m) => s.health[m]?.ok), 'First run')}
            <p className="ae-faint mt-2 leading-snug">One cheapest request on the chosen model, so the undocumented reply shape and the real charge are captured before anything else runs. This step costs credits, and it asks first.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select value={probeModel} onChange={(e) => { setProbeModel(e.target.value as VideoModel); setAsk(null); }} aria-label="Model to probe" className="min-w-0">{VIDEO_MODELS.map((m) => (<option key={m} value={m}>{m}{s.health[m] ? (s.health[m].ok ? ' · ok' : ' · failed') : ''}</option>))}</Select>
              <Btn tone="ink" onClick={() => setAsk('probe')} disabled={!!probeWhy || ask === 'probe'} title={probeWhy ?? 'Asks before it spends'} data-probe-open>{busy === 'probe' ? 'Submitting' : 'Run the probe'}</Btn>
            </div>
            {ask === 'probe' && (
              <div className="ae-confirm text-[12.5px]" role="group" aria-label="Confirm the probe" data-probe-confirm>
                <span className="min-w-0 flex-1">{probeCost}</span>
                <Btn size="sm" tone="ink" onClick={() => void firstRun()} autoFocus data-probe-run>Run</Btn>
                <Btn size="sm" onClick={() => setAsk(null)}>Cancel</Btn>
              </div>
            )}
            <ul className="mt-3 space-y-1">
              {VIDEO_MODELS.filter((m) => s.health[m]).map((m) => (<li key={m} className="flex items-center gap-2 text-[12.5px]"><span className="h-[7px] w-[7px] rounded-full" style={{ background: s.health[m].ok ? 'var(--p-green)' : 'var(--p-red)' }} /><span>{m}</span><span className="ae-faint min-w-0 truncate">{s.health[m].ok ? `delivered, ${ago(s.health[m].lastProbeAt)}` : s.health[m].error}</span></li>))}
            </ul>
          </section>

          <section className="ae-card-3 p-4">
            <h3 className="text-[15px] font-light">Engine settings</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <form className="block" onSubmit={(e) => { e.preventDefault(); if (!capWhy && capValue !== null) void saveSettings({ sessionCreditCap: capValue }); }}>
                <label className="ae-cap" htmlFor="ae-cap-input">Session credit cap</label>
                <span className="mt-1 flex gap-2">
                  <Input id="ae-cap-input" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} className="w-full" inputMode="numeric" disabled={readOnly} title={readOnly ? SAMPLE_OFF : undefined} aria-invalid={!!capErr || undefined} aria-describedby="ae-cap-help" />
                  <Btn type="submit" disabled={!!capWhy} title={capWhy ?? 'Save the cap'}>Save</Btn>
                </span>
                <span id="ae-cap-help" className={`mt-1 block ${capErr ? 'ae-field-err text-[11.5px]' : 'ae-faint'}`}>{capErr ?? `Spent this session: ${fmtCredits(health.arcads.sessionSpent)} of ${fmtCredits(health.arcads.sessionCap)}. The gate refuses past the cap without a second confirm.`}</span>
              </form>
              <div>
                <span className="ae-cap">UGC path</span>
                <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="UGC path">
                  <PickPill on={s.settings.ugcPath === 'v2'} onClick={() => void saveSettings({ ugcPath: 'v2' })} disabled={!!pathWhy} title={pathWhy ?? 'Talking actors v2: documented statuses, no folders'}>Talking actors v2</PickPill>
                  <PickPill on={s.settings.ugcPath === 'v1'} onClick={() => void saveSettings({ ugcPath: 'v1' })} disabled={!!pathWhy} title={pathWhy ?? 'Script chain v1: the older chain, for accounts without v2'}>Script chain v1</PickPill>
                </div>
                <span className="ae-faint mt-1 block">v2 has documented statuses and no folders. v1 is the older chain, kept in case the account lacks v2.</span>
              </div>
            </div>
            <Btn size="sm" onClick={newSession} disabled={!!sessionWhy} title={sessionWhy ?? 'Start counting this session from zero; Undo for five seconds'} className="mt-3">Reset session count ({fmtCredits(health.arcads.sessionSpent)} {health.arcads.sessionSpent === 1 ? 'credit' : 'credits'})</Btn>
          </section>

          <p className="sr-only" aria-live="polite">{notice ?? ''}</p>
          {notice && <p className="ae-cap flex items-center gap-1.5" aria-hidden="true"><ChevronRight className="h-3 w-3" />{notice}</p>}
          {error && <ErrorLine text={error} />}
          <div className="flex justify-end gap-2">
            {back && <Btn onClick={back.onClick}>{back.label}</Btn>}
            <Btn onClick={onClose}><X className="h-3.5 w-3.5" strokeWidth={1.8} /> Done</Btn>
          </div>
        </div>
      )}
    </Drawer>
  );
}
