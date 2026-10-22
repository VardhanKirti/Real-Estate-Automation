'use client';

/**
 * /lead-magnets under the Classic style (founderos-ui pages/lead-magnets.md
 * §7): PageHeader + Register, Pages shipped bars + Where leads land share,
 * then a bordered Notion-style table with an inline status select, row
 * actions and a modal form. `os-*` tokens only.
 */
import { useState } from 'react';
import { Copy, ExternalLink, Plus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SetupLink } from '@/components/SetupLink';
import { useToast } from '@/components/ui/Toast';
import { CBars, CCard, CMeter, CModal, CPill, CSampleBadge, type PillTone } from '@/components/fo-classic/kit';
import { LM_STATUSES, LM_STATUS_LABEL, type LeadMagnetRow, type LeadMagnetsPage } from '@/lib/lead-magnets';
import type { LeadMagnetStatus } from '@/lib/schemas';
import { EMPTY_FORM, PLACEHOLDERS, copyText, formFrom, useLeadMagnets, validateForm, type MagnetForm, type SaveResult } from './use-lead-magnets';

const TONE: Record<LeadMagnetStatus, PillTone> = { live: 'ok', draft: 'default', paused: 'warn', archived: 'default' };

export function LeadMagnetsClassic({ page }: { page: LeadMagnetsPage }) {
  const lm = useLeadMagnets();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LeadMagnetRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LeadMagnetRow | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const filming = page.mode === 'filming';
  const writeBlocked = filming ? 'Filming mode: read only' : null;
  const rowBlocked = (r: LeadMagnetRow) => writeBlocked ?? (r.sample ? 'Sample data: register a real page to edit' : null);
  const { volume, destinations, captures } = page.view;
  const emailN = destinations ? Math.round(destinations.email * volume.live) : 0;

  const copy = async (r: LeadMagnetRow) => {
    toast((await copyText(r.liveUrl)) ? { text: 'Link copied', tone: 'ok' } : { text: 'The browser blocked the clipboard', tone: 'err' });
  };

  return (
    <div className="lm-c">
      <PageHeader
        title={page.title}
        eyebrow={page.subtitle}
        right={
          <>
            {page.sample && <CSampleBadge title={filming ? 'Filming mode fixture, four invented pages' : 'Preview on a blank install, four invented pages'} />}
            <button type="button" className="c-btn c-btn-primary" onClick={() => setEditing('new')} disabled={Boolean(writeBlocked)} title={writeBlocked ?? undefined}>
              <Plus size={14} strokeWidth={1.75} aria-hidden /> Register a page
            </button>
          </>
        }
      />

      <div className="fo-c-grid">
        <CCard title="Pages shipped" id="lm-c-shipped" right={<span>Last 12 weeks</span>} className="fo-c-span-8">
          <CBars
            bars={page.weeks.counts.map((n, i) => ({ id: String(i), label: page.weeks.axisLabels[i], value: n, title: `${page.weeks.labels[i]}: ${n} went live` }))}
            height={110}
            label="Lead magnet pages that went live per week, last 12 weeks"
            empty={page.weeks.counts.some((n) => n > 0) ? undefined : 'Pages with a went-live date fill this in, week by week.'}
          />
        </CCard>
        <CCard title="Where leads land" id="lm-c-lands" right={<span>Live pages</span>} className="fo-c-span-4">
          {destinations ? (
            <div className="flex flex-col gap-3.5">
              <CMeter label="Email list" value={emailN} of={volume.live} tone="accent" />
              <CMeter label="Booking" value={volume.live - emailN} of={volume.live} tone="muted" />
              <p className="text-[12px] text-os-dim">{volume.live} live · {volume.paused} paused · {volume.draft} draft</p>
            </div>
          ) : (
            <p className="text-[13px] text-os-muted">Nothing live yet. Set a page to Live to see where its leads go.</p>
          )}
        </CCard>

        <CCard
          title="All pages"
          id="lm-c-all"
          className="fo-c-span-12"
          right={
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
              <button type="button" className="fo-c-filter" aria-pressed={!page.filter} onClick={() => lm.setFilter(null)}>All <span className="font-mono">{page.total}</span></button>
              {LM_STATUSES.map((s) => (
                <button key={s} type="button" className="fo-c-filter" aria-pressed={page.filter === s} onClick={() => lm.setFilter(page.filter === s ? null : s)}>
                  {LM_STATUS_LABEL[s]} <span className="font-mono">{volume[s]}</span>
                </button>
              ))}
            </div>
          }
        >
          {rowError && <p className="mb-3 text-[12.5px] text-os-err">{rowError}</p>}
          {captures.setupHref && page.total > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-os-muted">
              <CPill tone="warn">Captures not tracked</CPill> Connect Trakyo to count leads per page. <SetupLink href={captures.setupHref} hint="set TRAKYO_API_KEY" />
            </div>
          )}
          {page.total === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[13.5px] text-os-text">No lead magnets yet.</p>
              <p className="mt-1 text-[12.5px] text-os-muted">Register the first page you send people to.</p>
              {!writeBlocked && <button type="button" className="c-btn c-btn-primary mt-4" onClick={() => setEditing('new')}>Register a page</button>}
            </div>
          ) : page.rows.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[13.5px] text-os-text">No {page.filter} pages.</p>
              <button type="button" className="c-btn mt-3" onClick={() => lm.setFilter(null)}>Clear filter</button>
            </div>
          ) : (
            <table className="fo-c-table" data-wide="">
              <thead>
                <tr>
                  <th>Name</th><th>What they get</th><th>Link</th><th>Lands</th><th className="fo-c-hide-md">Campaign</th><th>Captures</th><th>Status</th><th className="text-right">Went live</th><th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((r) => {
                  const blocked = rowBlocked(r);
                  return (
                    <tr key={r.id} data-dim={r.status === 'archived' || undefined}>
                      <td data-label="Name" className="font-medium text-os-text">{r.name}</td>
                      <td data-label="What they get" className="fo-c-brief" title={r.offer}>{r.offer || '—'}</td>
                      <td data-label="Link">
                        <span className="inline-flex items-center gap-1.5">
                          <a href={r.liveUrl} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-os-accent hover:underline" title={r.liveUrl}>{r.linkLabel}</a>
                          <button type="button" className="fo-c-icon-btn" aria-label={`Copy link to ${r.name}`} title="Copy link" onClick={() => void copy(r)}><Copy size={13} strokeWidth={1.75} aria-hidden /></button>
                        </span>
                      </td>
                      <td data-label="Lands"><CPill>{r.destinationLabel}</CPill></td>
                      <td data-label="Campaign" className="fo-c-hide-md text-os-muted">{r.campaign || '—'}</td>
                      <td data-label="Captures" className="text-os-muted" title={page.capturesReason}>{page.capturesNote}</td>
                      <td data-label="Status">
                        {blocked ? (
                          <CPill tone={TONE[r.status]}>{r.statusLabel}</CPill>
                        ) : (
                          <select className="fo-c-status" data-tone={TONE[r.status]} aria-label={`Status of ${r.name}`} value={r.status}
                            onChange={async (e) => { setRowError(null); const res = await lm.setStatus(r.id, e.target.value as LeadMagnetStatus); if (!res.ok) setRowError(res.errors._form ?? 'Could not change the status.'); }}>
                            {LM_STATUSES.map((s) => <option key={s} value={s}>{LM_STATUS_LABEL[s]}</option>)}
                          </select>
                        )}
                      </td>
                      <td data-label="Went live" className="text-right font-mono text-os-muted">{r.wentLiveLabel ?? '—'}</td>
                      <td className="fo-c-menu-cell whitespace-nowrap">
                        <a className="fo-c-icon-btn" href={r.liveUrl} target="_blank" rel="noreferrer" aria-label={`Open ${r.name}`} title="Open link"><ExternalLink size={13} strokeWidth={1.75} aria-hidden /></a>
                        <button type="button" className="fo-c-text-btn" onClick={() => setEditing(r)} disabled={Boolean(blocked)} title={blocked ?? undefined}>Edit</button>
                        <button type="button" className="fo-c-text-btn" data-danger="" onClick={() => setDeleting(r)} disabled={Boolean(blocked)} title={blocked ?? undefined}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CCard>
      </div>

      {editing && (
        <MagnetModal
          initial={editing === 'new' ? null : editing}
          busy={lm.busy === 'create' || (editing !== 'new' && lm.busy === `edit:${editing.id}`)}
          onClose={() => setEditing(null)}
          onSave={(f) => (editing === 'new' ? lm.create(f) : lm.update(editing.id, f))}
        />
      )}
      <CModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete?'}
        width={420}
        footer={
          <>
            <button type="button" className="c-btn" data-dialog-close="" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className="c-btn fo-c-danger" disabled={deleting ? lm.busy === `delete:${deleting.id}` : false}
              onClick={async () => { if (!deleting) return; const res = await lm.remove(deleting.id); setDeleting(null); if (!res.ok) setRowError(res.errors._form ?? 'Could not delete the record.'); }}>
              Delete
            </button>
          </>
        }
      >
        <p className="text-[13px] text-os-text">This removes the record, not the page.</p>
      </CModal>
    </div>
  );
}

function MagnetModal({ initial, busy, onClose, onSave }: { initial: LeadMagnetRow | null; busy: boolean; onClose: () => void; onSave: (f: MagnetForm) => Promise<SaveResult> }) {
  const [f, setF] = useState<MagnetForm>(initial ? formFrom(initial) : EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof MagnetForm, string>> & { _form?: string }>({});
  const set = <K extends keyof MagnetForm>(k: K, v: MagnetForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    const local = validateForm(f);
    if (Object.keys(local).length) return setErrors(local);
    const res = await onSave(f);
    if (res.ok) onClose();
    else setErrors(res.errors);
  };
  const err = (k: keyof MagnetForm) => errors[k] && <p className="mt-1 text-[12px] text-os-err">{errors[k]}</p>;
  return (
    <CModal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'Register a page'}
      width={560}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="c-btn c-btn-primary" onClick={() => void submit()} disabled={busy}>{initial ? 'Save' : 'Register'}</button>
        </>
      }
    >
      <p className="mb-4 text-[12.5px] text-os-muted">A record of the page, where it lives and where its leads go. Nothing is published from here.</p>
      <label className="fo-c-label" htmlFor="lm-c-name">Name</label>
      <input id="lm-c-name" className="fo-c-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={PLACEHOLDERS.name} maxLength={120} aria-invalid={Boolean(errors.name)} />
      {err('name')}
      <label className="fo-c-label mt-3" htmlFor="lm-c-offer">What they get</label>
      <input id="lm-c-offer" className="fo-c-input" value={f.offer} onChange={(e) => set('offer', e.target.value)} placeholder={PLACEHOLDERS.offer} maxLength={500} />
      <label className="fo-c-label mt-3" htmlFor="lm-c-url">Live URL</label>
      <input id="lm-c-url" type="url" inputMode="url" className="fo-c-input font-mono" value={f.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} placeholder={PLACEHOLDERS.liveUrl} aria-invalid={Boolean(errors.liveUrl)} />
      {err('liveUrl')}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="fo-c-label" htmlFor="lm-c-dest">Where leads land</label>
          <select id="lm-c-dest" className="fo-c-input" value={f.destination} onChange={(e) => set('destination', e.target.value as MagnetForm['destination'])}>
            <option value="email">Email list</option>
            <option value="booking">Booking</option>
          </select>
        </div>
        <div>
          <label className="fo-c-label" htmlFor="lm-c-campaign">Campaign it was built for</label>
          <input id="lm-c-campaign" className="fo-c-input" value={f.campaign} onChange={(e) => set('campaign', e.target.value)} placeholder={PLACEHOLDERS.campaign} maxLength={200} />
        </div>
        <div>
          <label className="fo-c-label" htmlFor="lm-c-status">Status</label>
          <select id="lm-c-status" className="fo-c-input" value={f.status} onChange={(e) => set('status', e.target.value as LeadMagnetStatus)}>
            {LM_STATUSES.map((s) => <option key={s} value={s}>{LM_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="fo-c-label" htmlFor="lm-c-live">Went live</label>
          <input id="lm-c-live" type="date" className="fo-c-input font-mono" value={f.wentLiveAt} onChange={(e) => set('wentLiveAt', e.target.value)} />
        </div>
      </div>
      <label className="fo-c-label mt-3" htmlFor="lm-c-notes">Notes</label>
      <textarea id="lm-c-notes" className="fo-c-input min-h-[72px] py-2" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} />
      {errors._form && <p className="mt-3 text-[12.5px] text-os-err">{errors._form}</p>}
    </CModal>
  );
}
