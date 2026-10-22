'use client';

/**
 * /lead-magnets under the Bennett Legacy style (pages/lead-magnets.md §8): the
 * FounderOS Content Engine slab (shots/founderos-v1/content-lead-magnets-1440.png)
 * without its "← Content" link (there is no /content). Pages Shipped step line
 * beside Magnet Volume, then Captures, Where Leads Land and the one insight,
 * then the Notion-style table. Same page model (lib/lead-magnets.ts) and
 * actions (use-lead-magnets.ts) as the other trees; Legacy kit and --l-* only.
 * Captures are never a number we do not have (LM-3).
 */
import { useMemo, useState } from 'react';
import { Copy, ExternalLink, Plus, Rocket } from 'lucide-react';
import {
  Badge,
  BigStat,
  Chip,
  DotMatrix,
  InsightCard,
  LDialog,
  LEmpty,
  LSampleChip,
  LUnconfigured,
  MeterStack,
  Pressable,
  SlabCard,
  SlabTitle,
  StepLine,
  ToggleChip,
  type BadgeTone,
  type Meter,
} from '@/components/legacy';
import { useToast } from '@/components/ui/Toast';
import { LM_STATUSES, LM_STATUS_LABEL, type LeadMagnetRow, type LeadMagnetsPage } from '@/lib/lead-magnets';
import type { LeadMagnetStatus } from '@/lib/schemas';
import { EMPTY_FORM, PLACEHOLDERS, copyText, formFrom, useLeadMagnets, validateForm, type MagnetForm, type SaveResult } from './use-lead-magnets';

const TONE: Record<LeadMagnetStatus, BadgeTone> = { live: 'ok', draft: 'default', paused: 'warn', archived: 'default' };
const frac = (n: number, of: number) => (of > 0 ? n / of : 0);

export function LeadMagnetsLegacy({ page }: { page: LeadMagnetsPage }) {
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
  const bookingN = volume.live - emailN;

  // FO draws pages on record, week by week: the running total of went-live pages
  const cumulative = useMemo(() => {
    let n = 0;
    return page.weeks.counts.map((c, i) => ({ label: page.weeks.labels[i].replace('Week of ', ''), count: (n += c) }));
  }, [page.weeks]);
  const shipped12 = page.weeks.counts.reduce((a, b) => a + b, 0);
  const campaigns = new Set(page.rows.map((r) => r.campaign).filter(Boolean)).size;

  const copy = async (r: LeadMagnetRow) => {
    toast((await copyText(r.liveUrl)) ? { text: 'Link copied', tone: 'ok' } : { text: 'The browser blocked the clipboard', tone: 'err' });
  };

  const volumeMeters: Meter[] = [
    { label: `Live (${volume.live}/${page.total})`, frac: frac(volume.live, page.total), display: `${volume.live} of ${page.total}`, hue: 'var(--l-ok)' },
    { label: `Draft (${volume.draft}/${page.total})`, frac: frac(volume.draft, page.total), display: `${volume.draft} of ${page.total}` },
    { label: `Paused (${volume.paused}/${page.total})`, frac: frac(volume.paused, page.total), display: `${volume.paused} of ${page.total}`, hue: 'var(--l-warn)' },
    { label: `Archived (${volume.archived}/${page.total})`, frac: frac(volume.archived, page.total), display: `${volume.archived} of ${page.total}` },
  ];

  return (
    <div data-l="LeadMagnetsLegacy" className="l-page">
      <SlabTitle
        eyebrow="Content engine"
        title="Lead Magnets"
        meta={`${page.subtitle} · ${volume.paused} paused · ${campaigns} ${campaigns === 1 ? 'campaign' : 'campaigns'}`}
        right={
          <>
            {page.sample && (
              <span title={filming ? 'Filming mode fixture, four invented pages' : 'Preview on a blank install, four invented pages'}>
                <LSampleChip />
              </span>
            )}
            {volume.live > 0 && <Chip tone="ok">{volume.live} live</Chip>}
            <Pressable tone="pill" onClick={() => setEditing('new')} disabled={Boolean(writeBlocked)} title={writeBlocked ?? undefined}>
              <Plus size={14} strokeWidth={1.7} aria-hidden /> Register a page
            </Pressable>
          </>
        }
      />

      <div className="l-stack">
        <div className="l-row l-row-hero">
          <SlabCard title="Pages Shipped" sub="last 12 weeks" i={1}>
            <div className="l-card-body pb-2">
              <BigStat value={shipped12} size={30} chips={[{ tone: 'accent', text: `${page.total} on record` }]} caption="landing pages gone live, week by week" />
            </div>
            <StepLine series={cumulative} unit={cumulative.at(-1)?.count === 1 ? ' page' : ' pages'} empty="Pages with a went-live date fill this in, week by week." />
          </SlabCard>
          <SlabCard title="Magnet Volume" sub="by status" i={2} className="flex flex-col">
            <div className="l-card-body flex flex-1 flex-col">
              <BigStat value={volume.live} unit="live" chips={volume.paused ? [{ tone: 'err', text: `${volume.paused} paused` }] : []} caption={`of ${page.total} landing ${page.total === 1 ? 'page' : 'pages'} on record`} />
              <MeterStack meters={volumeMeters} dense empty="No pages yet." foot={`${campaigns} ${campaigns === 1 ? 'campaign' : 'campaigns'} · ${emailN + bookingN} live`} />
            </div>
          </SlabCard>
        </div>

        <div className="l-row l-row-three">
          <SlabCard title="Captures" sub="leads per page" i={3}>
            <div className="l-card-body">
              <BigStat display={page.capturesNote} size={30} caption={page.capturesReason} />
            </div>
            {captures.setupHref && <LUnconfigured what="Trakyo" href={captures.setupHref} hint="set TRAKYO_API_KEY" />}
          </SlabCard>
          <SlabCard title="Where Leads Land" sub="live pages" i={4}>
            <div className="l-card-body l-cl-rhythm">
              {destinations ? (
                <>
                  <BigStat display={emailN >= bookingN ? 'Email list' : 'Booking'} size={30} caption={`top destination · ${volume.live} live`} />
                  <DotMatrix
                    cols={[
                      { label: 'Email', count: emailN },
                      { label: 'Booking', count: bookingN },
                    ]}
                  />
                </>
              ) : (
                <p className="l-body-text">Nothing live yet. Set a page to Live to see where its leads go.</p>
              )}
            </div>
          </SlabCard>
          <InsightCard
            badge="Live share"
            icon={<Rocket size={13} strokeWidth={1.7} aria-hidden />}
            value={page.total ? volume.live : null}
            display={page.total ? undefined : '-'}
            headline={page.total ? `of ${page.total} ${page.total === 1 ? 'page is' : 'pages are'} live right now.` : 'No pages on record yet.'}
            body={page.total ? `${volume.draft} draft · ${volume.paused} paused · ${volume.archived} archived.` : 'Register the first page you send people to.'}
            frac={frac(volume.live, page.total)}
            i={5}
          />
        </div>

        <SlabCard
          title="All pages"
          sub={page.filter ? `${page.rows.length} ${LM_STATUS_LABEL[page.filter].toLowerCase()}` : `${page.total} on record`}
          i={6}
          action={
            <div className="l-chip-row" role="group" aria-label="Filter by status">
              <ToggleChip on={!page.filter} onClick={() => lm.setFilter(null)}>
                All {page.total}
              </ToggleChip>
              {LM_STATUSES.map((s) => (
                <ToggleChip key={s} on={page.filter === s} onClick={() => lm.setFilter(page.filter === s ? null : s)}>
                  {LM_STATUS_LABEL[s]} {volume[s]}
                </ToggleChip>
              ))}
            </div>
          }
        >
          {rowError && <p className="l-err-text l-pad-x pt-3">{rowError}</p>}
          {page.total === 0 ? (
            <LEmpty>
              <span className="block w-full">No lead magnets yet.</span>
              <span className="block w-full">Register the first page you send people to.</span>
              {!writeBlocked && (
                <Pressable tone="primary" onClick={() => setEditing('new')}>
                  Register a page
                </Pressable>
              )}
            </LEmpty>
          ) : page.rows.length === 0 ? (
            <LEmpty>
              <span className="block w-full">No {page.filter} pages.</span>
              <Pressable onClick={() => lm.setFilter(null)}>Clear filter</Pressable>
            </LEmpty>
          ) : (
            <div data-l="Table" className="l-lm-table mt-3" role="table" aria-label="Lead magnet pages">
              <div className="l-lm-tr l-lm-th" role="row">
                {['Name', 'What they get', 'Link', 'Lands', 'Campaign', 'Captures', 'Status', 'Went live', ''].map((h, i) => (
                  <span key={i} role="columnheader">
                    {h}
                  </span>
                ))}
              </div>
              {page.rows.map((r) => {
                const blocked = rowBlocked(r);
                return (
                  <div key={r.id} className="l-lm-tr" role="row" data-dim={r.status === 'archived' || undefined}>
                    <span role="cell" className="l-sym" data-label="Name">
                      {r.name}
                    </span>
                    <span role="cell" className="l-lm-offer" data-label="What they get" title={r.offer}>
                      {r.offer || 'none'}
                    </span>
                    <span role="cell" className="l-lm-link" data-label="Link">
                      <a href={r.liveUrl} target="_blank" rel="noreferrer" title={r.liveUrl} className="l-link">
                        {r.linkLabel}
                      </a>
                      <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" aria-label={`Copy link to ${r.name}`} title="Copy link" onClick={() => void copy(r)}>
                        <Copy size={11} strokeWidth={1.7} aria-hidden />
                      </button>
                    </span>
                    <span role="cell" data-label="Lands">
                      <Badge>{r.destinationLabel}</Badge>
                    </span>
                    <span role="cell" className="l-lm-dim" data-label="Campaign">
                      {r.campaign || 'none'}
                    </span>
                    <span role="cell" className="l-lm-dim" data-label="Captures" title={page.capturesReason}>
                      {page.capturesNote}
                    </span>
                    <span role="cell" data-label="Status">
                      {blocked ? (
                        <Badge tone={TONE[r.status]}>{r.statusLabel}</Badge>
                      ) : (
                        <select
                          className="l-select l-lm-status"
                          data-tone={TONE[r.status]}
                          aria-label={`Status of ${r.name}`}
                          value={r.status}
                          onChange={async (e) => {
                            setRowError(null);
                            const res = await lm.setStatus(r.id, e.target.value as LeadMagnetStatus);
                            if (!res.ok) setRowError(res.errors._form ?? 'Could not change the status.');
                          }}
                        >
                          {LM_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {LM_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                    <span role="cell" className="l-lm-dim" data-label="Went live">
                      {r.wentLiveLabel ?? 'not yet'}
                    </span>
                    <span role="cell" className="l-lm-actions">
                      <a data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-xs" href={r.liveUrl} target="_blank" rel="noreferrer" aria-label={`Open ${r.name}`} title="Open link">
                        <ExternalLink size={11} strokeWidth={1.7} aria-hidden />
                      </a>
                      <Pressable onClick={() => setEditing(r)} disabled={Boolean(blocked)} title={blocked ?? undefined}>
                        Edit
                      </Pressable>
                      <Pressable onClick={() => setDeleting(r)} disabled={Boolean(blocked)} title={blocked ?? undefined}>
                        Delete
                      </Pressable>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </SlabCard>
      </div>

      {editing && (
        <MagnetDialog
          initial={editing === 'new' ? null : editing}
          busy={lm.busy === 'create' || (editing !== 'new' && lm.busy === `edit:${editing.id}`)}
          onClose={() => setEditing(null)}
          onSave={(f) => (editing === 'new' ? lm.create(f) : lm.update(editing.id, f))}
        />
      )}
      <LDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete?'}
        width={420}
        footer={
          <>
            <Pressable onClick={() => setDeleting(null)}>Cancel</Pressable>
            <Pressable
              tone="primary"
              disabled={deleting ? lm.busy === `delete:${deleting.id}` : false}
              onClick={async () => {
                if (!deleting) return;
                const res = await lm.remove(deleting.id);
                setDeleting(null);
                if (!res.ok) setRowError(res.errors._form ?? 'Could not delete the record.');
              }}
            >
              Delete
            </Pressable>
          </>
        }
      >
        <p className="l-prose">This removes the record, not the page.</p>
      </LDialog>
    </div>
  );
}

function MagnetDialog({ initial, busy, onClose, onSave }: { initial: LeadMagnetRow | null; busy: boolean; onClose: () => void; onSave: (f: MagnetForm) => Promise<SaveResult> }) {
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
  const err = (k: keyof MagnetForm) => errors[k] && <p className="l-err-text mt-1">{errors[k]}</p>;
  return (
    <LDialog
      title={initial ? `Edit ${initial.name}` : 'Register a page'}
      sub="A record of the page, where it lives and where its leads go. Nothing is published from here."
      onClose={onClose}
      width={580}
      footer={
        <>
          <Pressable onClick={onClose}>Cancel</Pressable>
          <Pressable tone="primary" onClick={() => void submit()} disabled={busy}>
            {initial ? 'Save' : 'Register'}
          </Pressable>
        </>
      }
    >
      <label className="l-form-label" htmlFor="l-lm-name">
        Name
      </label>
      <input id="l-lm-name" className="l-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={PLACEHOLDERS.name} maxLength={120} aria-invalid={Boolean(errors.name)} />
      {err('name')}
      <label className="l-form-label" htmlFor="l-lm-offer">
        What they get
      </label>
      <input id="l-lm-offer" className="l-input" value={f.offer} onChange={(e) => set('offer', e.target.value)} placeholder={PLACEHOLDERS.offer} maxLength={500} />
      <label className="l-form-label" htmlFor="l-lm-url">
        Live URL
      </label>
      <input id="l-lm-url" type="url" inputMode="url" className="l-input" value={f.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} placeholder={PLACEHOLDERS.liveUrl} aria-invalid={Boolean(errors.liveUrl)} />
      {err('liveUrl')}
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <div>
          <label className="l-form-label" htmlFor="l-lm-dest">
            Where leads land
          </label>
          <select id="l-lm-dest" className="l-select" value={f.destination} onChange={(e) => set('destination', e.target.value as MagnetForm['destination'])}>
            <option value="email">Email list</option>
            <option value="booking">Booking</option>
          </select>
        </div>
        <div>
          <label className="l-form-label" htmlFor="l-lm-campaign">
            Campaign it was built for
          </label>
          <input id="l-lm-campaign" className="l-input" value={f.campaign} onChange={(e) => set('campaign', e.target.value)} placeholder={PLACEHOLDERS.campaign} maxLength={200} />
        </div>
        <div>
          <label className="l-form-label" htmlFor="l-lm-status">
            Status
          </label>
          <select id="l-lm-status" className="l-select" value={f.status} onChange={(e) => set('status', e.target.value as LeadMagnetStatus)}>
            {LM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LM_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="l-form-label" htmlFor="l-lm-live">
            Went live
          </label>
          <input id="l-lm-live" type="date" className="l-input" value={f.wentLiveAt} onChange={(e) => set('wentLiveAt', e.target.value)} />
        </div>
      </div>
      <label className="l-form-label" htmlFor="l-lm-notes">
        Notes
      </label>
      <textarea id="l-lm-notes" className="l-textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} />
      {errors._form && <p className="l-err-text mt-3">{errors._form}</p>}
    </LDialog>
  );
}
