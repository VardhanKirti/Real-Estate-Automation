'use client';

/**
 * /lead-magnets under the GladOS style (founderos-ui pages/lead-magnets.md §6).
 * No hero: the page is a table. Pages shipped (12 weeks) and Where leads land
 * on top, then the filterable table. Captures say "Not tracked" with the
 * reason and a Trakyo Set up link when unkeyed, never 0 (LM-3).
 */
import { useState } from 'react';
import { Copy, ExternalLink, MoreHorizontal, Plus } from 'lucide-react';
import {
  GBarChart, GButton, GCard, GChip, GDateTime, GDialog, GDonut, GEmpty, GErrorLine, GField, GInput, GList, GMenu, GPage, GRow, GSampleBadge,
  GSectionHeader, GSegmented, GSelect, GSheet, GTable, GTag, GTextarea, useToast, type GColumn, type GTagTone,
} from '@/components/g';
import { LM_STATUSES, LM_STATUS_LABEL, type LeadMagnetRow, type LeadMagnetsPage } from '@/lib/lead-magnets';
import type { LeadMagnetStatus } from '@/lib/schemas';
import { EMPTY_FORM, PLACEHOLDERS, copyText, formFrom, useLeadMagnets, validateForm, type MagnetForm, type SaveResult } from './use-lead-magnets';

export const LM_TONE: Record<LeadMagnetStatus, GTagTone> = { live: 'ok', draft: 'neutral', paused: 'warn', archived: 'outline' };
const STATUS_OPTIONS = LM_STATUSES.map((s) => ({ value: s, label: LM_STATUS_LABEL[s] }));

export function LeadMagnetsG({ page }: { page: LeadMagnetsPage }) {
  const lm = useLeadMagnets();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LeadMagnetRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<LeadMagnetRow | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const filming = page.mode === 'filming';
  const writeBlocked = filming ? 'Filming mode: read only' : null;
  const rowBlocked = (r: LeadMagnetRow) => writeBlocked ?? (r.sample ? 'Sample data: register a real page to edit' : null);
  const { volume, destinations, captures } = page.view;

  const copy = async (r: LeadMagnetRow) => {
    toast((await copyText(r.liveUrl)) ? { text: 'Link copied', tone: 'ok' } : { text: 'The browser blocked the clipboard', tone: 'err' });
  };
  const changeStatus = async (r: LeadMagnetRow, s: LeadMagnetStatus) => {
    setRowError(null);
    const res = await lm.setStatus(r.id, s);
    if (!res.ok) setRowError(res.errors._form ?? 'Could not change the status.');
  };
  const doDelete = async () => {
    if (!deleting) return;
    const res = await lm.remove(deleting.id);
    setDeleting(null);
    if (!res.ok) setRowError(res.errors._form ?? 'Could not delete the record.');
  };

  const capturesCell = (
    <span className="lm-g-captures" title={page.capturesReason}>
      {page.capturesNote}
    </span>
  );

  const menu = (r: LeadMagnetRow) => {
    const blocked = rowBlocked(r);
    return (
      <GMenu
        label={`Actions for ${r.name}`}
        items={[
          { id: 'open', label: 'Open link', onSelect: () => window.open(r.liveUrl, '_blank', 'noopener,noreferrer'), icon: <ExternalLink size={13} aria-hidden /> },
          { id: 'copy', label: 'Copy link', onSelect: () => void copy(r), icon: <Copy size={13} aria-hidden /> },
          { id: 'edit', label: 'Edit', onSelect: () => setEditing(r), disabled: Boolean(blocked), disabledReason: blocked ?? undefined },
          { id: 'delete', label: 'Delete', danger: true, onSelect: () => setDeleting(r), disabled: Boolean(blocked), disabledReason: blocked ?? undefined },
        ]}
        trigger={(p) => (
          <GButton {...p} variant="icon" size="sm" aria-label={`Actions for ${r.name}`} title="Actions">
            <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden />
          </GButton>
        )}
      />
    );
  };

  const columns: GColumn<LeadMagnetRow>[] = [
    { key: 'name', label: 'Name', sortValue: (r) => r.name.toLowerCase(), render: (r) => <span className="lm-g-name">{r.name}</span> },
    { key: 'offer', label: 'What they get', render: (r) => <span className="lm-g-offer" data-col="offer" title={r.offer}>{r.offer || '—'}</span> },
    {
      key: 'link',
      label: 'Link',
      render: (r) => (
        <span className="lm-g-link">
          <span className="lm-g-host" title={r.liveUrl}>{r.linkLabel}</span>
          <GButton variant="icon" size="compact" href={r.liveUrl} external aria-label={`Open ${r.name} in a new tab`} title="Open link">
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </GButton>
          <GButton variant="icon" size="compact" aria-label={`Copy link to ${r.name}`} title="Copy link" onClick={() => void copy(r)}>
            <Copy size={13} strokeWidth={1.75} aria-hidden />
          </GButton>
        </span>
      ),
    },
    { key: 'lands', label: 'Lands', sortValue: (r) => r.destination, render: (r) => <GTag tone="outline" size="xs">{r.destinationLabel}</GTag> },
    { key: 'campaign', label: 'Campaign', render: (r) => <span className="lm-g-campaign" data-col="campaign">{r.campaign || '—'}</span> },
    { key: 'captures', label: 'Captures', render: () => capturesCell },
    {
      key: 'status',
      label: 'Status',
      sortValue: (r) => LM_STATUSES.indexOf(r.status),
      render: (r) =>
        rowBlocked(r) ? (
          <GTag tone={LM_TONE[r.status]} dot size="xs">{r.statusLabel}</GTag>
        ) : (
          <GSelect size="compact" aria-label={`Status of ${r.name}`} value={r.status} options={STATUS_OPTIONS} className="lm-g-status" onChange={(e) => void changeStatus(r, e.target.value as LeadMagnetStatus)} />
        ),
    },
    { key: 'live', label: 'Went live', align: 'right', sortValue: (r) => r.wentLiveAt ?? '', render: (r) => <span className="lm-g-cap">{r.wentLiveLabel ?? '—'}</span> },
    { key: 'menu', label: <span className="sr-only">Actions</span>, align: 'right', render: (r) => menu(r) },
  ];

  const emailN = destinations ? Math.round(destinations.email * volume.live) : 0;
  const bookingN = volume.live - emailN;

  return (
    <GPage className="lm-g">
      <GSectionHeader
        size="page"
        title={page.title}
        caption={page.subtitle}
        action={
          <div className="lm-g-head-actions">
            {page.sample && <GSampleBadge fixture={filming ? 'Filming mode fixture, four invented pages' : 'Preview on a blank install, four invented pages'} />}
            <GButton variant="ink" onClick={() => setEditing('new')} disabled={Boolean(writeBlocked)} disabledReason={writeBlocked ?? undefined}>
              <Plus size={14} strokeWidth={1.75} aria-hidden /> Register a page
            </GButton>
          </div>
        }
      />

      <div className="lm-g-top">
        <GCard p={24} className="lm-g-shipped" aria-labelledby="lm-g-shipped">
          <GSectionHeader id="lm-g-shipped" size={22} title="Pages shipped" action={<span className="lm-g-cap">12 weeks</span>} />
          <GBarChart
            variant="series"
            bars={page.weeks.labels.map((l, i) => ({ id: String(i), label: page.weeks.axisLabels[i], value: page.weeks.counts[i], tip: { title: l, lines: [`${page.weeks.counts[i]} went live`] } }))}
            height={180}
            highlight={null}
            state={page.weeks.counts.some((n) => n > 0) ? 'ready' : 'empty'}
            emptyText="Pages with a went-live date fill this in, week by week."
            label="Lead magnet pages that went live per week, last 12 weeks"
          />
        </GCard>
        <GCard p={24} className="lm-g-lands" aria-labelledby="lm-g-lands">
          <GSectionHeader id="lm-g-lands" size={22} title="Where leads land" action={<span className="lm-g-cap">Live pages</span>} />
          {destinations ? (
            <GDonut
              size={150}
              stroke={14}
              slices={[
                { id: 'email', label: 'Email list', value: emailN, color: 'accent' },
                { id: 'booking', label: 'Booking', value: bookingN, color: 'series-3' },
              ]}
              centreLabel={volume.live === 1 ? 'live page' : 'live pages'}
              label={`Where leads land: ${emailN} email, ${bookingN} booking`}
            />
          ) : (
            <GEmpty inline title="Nothing live yet." body="Set a page to Live to see where its leads go." />
          )}
        </GCard>
      </div>

      <GCard p={24} className="lm-g-table-card" aria-labelledby="lm-g-all">
        <div className="lm-g-table-head">
          <GSectionHeader id="lm-g-all" size={22} title="All pages" />
          <div className="lm-g-chips" role="group" aria-label="Filter by status">
            <GChip size="compact" pressed={!page.filter} onPressedChange={() => lm.setFilter(null)} count={page.total}>All</GChip>
            {LM_STATUSES.map((s) => (
              <GChip key={s} size="compact" pressed={page.filter === s} onPressedChange={(on) => lm.setFilter(on ? s : null)} count={volume[s]}>
                {LM_STATUS_LABEL[s]}
              </GChip>
            ))}
          </div>
        </div>
        {rowError && <GErrorLine align="left">{rowError}</GErrorLine>}
        {page.total > 0 && (
          <div className="lm-g-track" title={page.capturesReason}>
            <GTag tone="outline" size="xs">Captures not tracked</GTag>
            <span>{captures.setupHref ? 'Connect Trakyo to count leads per page.' : page.capturesReason}</span>
            {captures.setupHref && <GButton size="sm" href={captures.setupHref} title="set TRAKYO_API_KEY">Set up</GButton>}
          </div>
        )}
        {page.total === 0 ? (
          <GEmpty title="No lead magnets yet." body="Register the first page you send people to." action={writeBlocked ? undefined : { label: 'Register a page', onClick: () => setEditing('new') }} />
        ) : page.rows.length === 0 ? (
          <GEmpty title={`No ${page.filter} pages.`} action={{ label: 'Clear filter', onClick: () => lm.setFilter(null) }} />
        ) : (
          <>
            <div className="lm-g-table">
              <GTable columns={columns} rows={page.rows} rowKey={(r) => r.id} caption="Lead magnets" sticky={false} rowDim={(r) => r.status === 'archived'} />
            </div>
            <div className="lm-g-list">
              <GList divided label="Lead magnets">
                {page.rows.map((r) => (
                  <GRow
                    key={r.id}
                    title={<span className="lm-g-row-title"><span className="lm-g-name">{r.name}</span><GTag tone={LM_TONE[r.status]} dot size="xs">{r.statusLabel}</GTag></span>}
                    meta={`${r.linkLabel} · ${r.destinationLabel}`}
                    trailing={<span className="lm-g-cap" title={page.capturesReason}>{page.capturesNote}</span>}
                    onClick={rowBlocked(r) ? () => void copy(r) : () => setEditing(r)}
                    hint={rowBlocked(r) ? 'Copy link' : 'Edit'}
                  />
                ))}
              </GList>
            </div>
          </>
        )}
      </GCard>

      {editing && (
        <MagnetSheet
          initial={editing === 'new' ? null : editing}
          busy={lm.busy === 'create' || (editing !== 'new' && lm.busy === `edit:${editing.id}`)}
          onClose={() => setEditing(null)}
          onSave={(f) => (editing === 'new' ? lm.create(f) : lm.update(editing.id, f))}
        />
      )}
      <GDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        tone="danger"
        title={deleting ? `Delete ${deleting.name}?` : 'Delete?'}
        confirmLabel="Delete"
        onConfirm={() => void doDelete()}
        busy={deleting ? lm.busy === `delete:${deleting.id}` : false}
      >
        <p className="lm-g-dialog-copy">This removes the record, not the page.</p>
      </GDialog>
    </GPage>
  );
}

function MagnetSheet({ initial, busy, onClose, onSave }: { initial: LeadMagnetRow | null; busy: boolean; onClose: () => void; onSave: (f: MagnetForm) => Promise<SaveResult> }) {
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

  return (
    <GSheet
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'Register a page'}
      caption="A record of the page, where it lives and where its leads go. Nothing is published from here."
      width={540}
      footer={
        <div className="lm-g-sheet-foot">
          <GButton onClick={onClose}>Cancel</GButton>
          <GButton variant="ink" onClick={() => void submit()} busy={busy}>{initial ? 'Save' : 'Register'}</GButton>
        </div>
      }
    >
      <div className="lm-g-form">
        <GField label="Name" htmlFor="lm-g-name" error={errors.name}>
          <GInput id="lm-g-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={PLACEHOLDERS.name} maxLength={120} invalid={Boolean(errors.name)} />
        </GField>
        <GField label="What they get" htmlFor="lm-g-offer" error={errors.offer}>
          <GInput id="lm-g-offer" value={f.offer} onChange={(e) => set('offer', e.target.value)} placeholder={PLACEHOLDERS.offer} maxLength={500} />
        </GField>
        <GField label="Live URL" htmlFor="lm-g-url" error={errors.liveUrl}>
          <GInput id="lm-g-url" type="url" inputMode="url" value={f.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} placeholder={PLACEHOLDERS.liveUrl} invalid={Boolean(errors.liveUrl)} />
        </GField>
        <GField label="Where leads land">
          <GSegmented label="Where leads land" value={f.destination} onChange={(v) => set('destination', v)} options={[{ value: 'email', label: 'Email list' }, { value: 'booking', label: 'Booking' }]} />
        </GField>
        <GField label="Campaign it was built for" htmlFor="lm-g-campaign" error={errors.campaign}>
          <GInput id="lm-g-campaign" value={f.campaign} onChange={(e) => set('campaign', e.target.value)} placeholder={PLACEHOLDERS.campaign} maxLength={200} />
        </GField>
        <div className="lm-g-form-row">
          <GField label="Status" htmlFor="lm-g-status">
            <GSelect id="lm-g-status" value={f.status} onChange={(e) => set('status', e.target.value as LeadMagnetStatus)} options={STATUS_OPTIONS} />
          </GField>
          <GField label="Went live" htmlFor="lm-g-live" error={errors.wentLiveAt}>
            <GDateTime id="lm-g-live" kind="date" value={f.wentLiveAt} onChange={(e) => set('wentLiveAt', e.target.value)} />
          </GField>
        </div>
        <GField label="Notes" htmlFor="lm-g-notes">
          <GTextarea id="lm-g-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLines={8} maxLength={4000} />
        </GField>
        {errors._form && <GErrorLine align="left">{errors._form}</GErrorLine>}
      </div>
    </GSheet>
  );
}
