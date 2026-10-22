'use client';

/**
 * F6 Trakyo link studio, Classic tree (and Bennett Legacy, which renders the
 * Classic tree under its skin): a bordered card with saved links and their
 * clicks, and an inline New link form. Creating publishes a public short link,
 * so it needs GLADOS_WRITES=1 and a confirm step ("Create link in Trakyo?")
 * before the POST. Reads stream from GET /api/trakyo/links.
 */

import { useCallback, useEffect, useState } from 'react';
import { SetupLink } from '@/components/SetupLink';
import {
  CONFIRM_TITLE, EMPTY_LINK_FORM, WRITES_OFF_REASON, hostPath, linkFormError, linkRequestBody, totalClicks, type LinkForm, type LinkRow, type LinksWorkspace,
} from './links-model';

const num = (n: number) => n.toLocaleString('en-US');

const FIELDS: { k: Exclude<keyof LinkForm, 'domain'>; label: string; placeholder: string; hint?: string }[] = [
  { k: 'url', label: 'Destination URL', placeholder: 'https://example.com/offer' },
  { k: 'source', label: 'Source', placeholder: 'Instagram', hint: 'Where the link is posted' },
  { k: 'campaign', label: 'Campaign', placeholder: 'October reel: 3 offers', hint: 'The post or campaign' },
  { k: 'contentId', label: 'Content id', placeholder: 'ci_…', hint: 'Optional, instead of source and campaign' },
];

export function FunnelLinks({ configured, setupHref }: { configured: boolean; setupHref: string }) {
  const [ws, setWs] = useState<LinksWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LinkForm>(EMPTY_LINK_FORM);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: keyof LinkForm; message: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/trakyo/links', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Trakyo links answered ${res.status}`);
      setWs((await res.json()) as LinksWorkspace);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read Trakyo links.');
    }
  }, []);

  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  const review = () => {
    const problem = linkFormError(form);
    if (problem) return setError(problem);
    setConfirming(true);
  };

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/trakyo/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(linkRequestBody(form)) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string; link?: LinkRow };
      setConfirming(false);
      if (!res.ok) {
        setError({ field: data.field as keyof LinkForm | undefined, message: data.error ?? `Trakyo answered ${res.status}.` });
        return;
      }
      setCreated(data.link?.shortLink ?? null);
      setOpen(false);
      setForm(EMPTY_LINK_FORM);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const writesOff = ws !== null && !ws.writes;
  const windowLabel = !configured ? 'Tracked short links and their clicks' : ws ? `${num(ws.links.length)}${ws.hasMore ? '+' : ''} links · ${num(totalClicks(ws.links))} clicks` : 'Reading Trakyo';

  return (
    <div className="fc-card fc-c6 fc-feature" data-feature="funnel-links">
      <div className="fc-card-head">
        <div className="fc-card-title">
          Links<span className="fc-card-window">{windowLabel}</span>
        </div>
        {ws?.sample && (
          <span data-sample-badge="" className="fc-sample" title="Sample data: Filming">
            Sample
          </span>
        )}
        {configured && ws && ws.state !== 'error' && !open && (
          <button type="button" className="c-btn" onClick={() => setOpen(true)} disabled={writesOff} title={writesOff ? WRITES_OFF_REASON : 'Create a tracked short link in Trakyo'}>
            New link
          </button>
        )}
      </div>

      {!configured ? (
        <div className="fc-feature-empty">
          <span className="fc-tag">Not configured</span>
          <p>Tracked links need Trakyo. Create a short link per post or campaign and see which one gets the clicks.</p>
          <SetupLink href={setupHref} hint="Set TRAKYO_API_KEY" />
        </div>
      ) : loadError || ws?.state === 'error' ? (
        <div className="fc-feature-empty" role="alert">
          <p>{loadError ?? ws?.messages[0] ?? 'Trakyo could not be read.'}</p>
          <button type="button" className="c-btn" onClick={() => void load()}>Retry</button>
        </div>
      ) : !ws ? (
        <div className="fc-feature-skeleton" aria-hidden />
      ) : (
        <>
          {open && (
            <form className="fc-link-form" onSubmit={(e) => { e.preventDefault(); review(); }} aria-label="New link">
              {FIELDS.map((f) => (
                <label key={f.k} className="fc-field">
                  <span className="fc-field-lab">{f.label}{f.hint && <em> · {f.hint}</em>}</span>
                  <input
                    className="fc-input"
                    value={form[f.k]}
                    placeholder={f.placeholder}
                    aria-invalid={error?.field === f.k || undefined}
                    onChange={(e) => { setForm((x) => ({ ...x, [f.k]: e.target.value })); setError(null); setConfirming(false); }}
                  />
                  {error?.field === f.k && <span className="fc-field-err">{error.message}</span>}
                </label>
              ))}
              {ws.domains.length > 0 && (
                <label className="fc-field">
                  <span className="fc-field-lab">Domain</span>
                  <select className="fc-input" value={form.domain} onChange={(e) => setForm((x) => ({ ...x, domain: e.target.value }))}>
                    <option value="">Trakyo default</option>
                    {ws.domains.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
                  </select>
                </label>
              )}
              {error && !error.field && <p className="fc-field-err" role="alert">{error.message}</p>}
              {confirming ? (
                <div className="fc-confirm" role="alertdialog" aria-label={CONFIRM_TITLE}>
                  <span>{CONFIRM_TITLE} It is public as soon as it is created.</span>
                  <button type="button" className="c-btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                  <button type="button" className="c-btn c-btn-primary" onClick={() => void create()} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
                </div>
              ) : (
                <div className="fc-confirm">
                  <button type="button" className="c-btn" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
                  <button type="submit" className="c-btn c-btn-primary" disabled={writesOff} title={writesOff ? WRITES_OFF_REASON : undefined}>Create link</button>
                </div>
              )}
            </form>
          )}
          {ws.messages.map((m) => <p key={m} className="fc-sources">{m}</p>)}
          {created && <p className="fc-sources" role="status">Created {hostPath(created)}</p>}
          {ws.links.length === 0 ? (
            <div className="fc-feature-empty">
              <p>No links yet. New link creates a tracked short link for a post or campaign.</p>
            </div>
          ) : (
            <div className="fc-feature-scroll">
              <table className="fc-table">
                <thead>
                  <tr>
                    <th>Short link</th>
                    <th>Destination</th>
                    <th>Content id</th>
                    <th className="r">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ws.links].sort((a, b) => b.clicks - a.clicks).map((l) => (
                    <tr key={l.key} className="row">
                      <td className="name"><a href={l.shortLink} target="_blank" rel="noreferrer">{hostPath(l.shortLink)}</a></td>
                      <td className="muted" title={l.url}>{hostPath(l.url)}</td>
                      <td className="mono dim">{l.contentItemId ?? '—'}</td>
                      <td className="r mono">{num(l.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
