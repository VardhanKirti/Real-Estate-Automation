'use client';

/**
 * The Comms additions under the Classic style (pages/feature-additions.md F3,
 * F4, F5): a Digest view, a Recordings lane, the Slack client lanes and the
 * week calendar, opened from the view strip above the inbox columns. `os-*`
 * tokens and Classic classes only, so Bennett Legacy renders the same tree
 * under its skin (Monolith and Daylight remap these tokens). Same data and
 * hooks as the GladOS presentation (CommsFoG.tsx).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/terminal';
import { SetupLink } from '@/components/SetupLink';
import type { DigestEntry } from '@/lib/comms-digest';
import { relativeTime } from '@/lib/inbox';
import {
  DIGEST_COPY,
  RECORDINGS_EMPTY,
  digestLanes,
  formatDuration,
  needsReply,
  type ClientBoardData,
  type DigestPanelData,
  type RecordingsData,
  type WeekData,
} from '@/lib/comms-extras';
import { dayLabel, hhmm, slackIso, useDigestReads, useRecordings } from './hooks';

const TIER_LABEL: Record<string, string> = { call: 'Call booked', client: 'Client', people: 'Person', branddeal: 'Brand deal', group: 'Group', noise: 'Automated' };
const CARD = 'rounded-lg-t border border-os-border bg-os-surface';

function SampleChip({ fixture }: { fixture: string }) {
  return (
    <span data-sample-badge={fixture} title={`Sample data (${fixture})`} className="c-chip whitespace-nowrap">
      Sample
    </span>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="cf-panel flex min-h-0 flex-col gap-4 p-5" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-medium text-os-text">{title}</h2>
          {sub && <p className="mt-1 text-[13px] text-os-muted">{sub}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </header>
      {children}
    </section>
  );
}

/* ── F3 Digest ─────────────────────────────────────────────────────────── */

/** The Digest view. Opening it marks the report read (clears the unread dot). */
export function DigestPanelClassic({ data }: { data: DigestPanelData }) {
  const reads = useDigestReads(data);
  const { markRead } = reads;
  useEffect(() => {
    void markRead();
  }, [markRead]);
  const lanes = digestLanes(data.digest?.body ?? null, data.today, reads.cleared);
  const waiting = lanes.reduce((n, l) => n + l.needsReply, 0);
  const sub =
    data.state === 'ready' && data.digest
      ? `Built ${dayLabel(data.digest.createdAt)}, ${hhmm(data.digest.createdAt)} · ${waiting} need a reply`
      : data.state === 'pending'
        ? DIGEST_COPY.pending
        : DIGEST_COPY.off;

  return (
    <Panel
      title="Morning digest"
      sub={sub}
      right={
        <>
          {data.sample && <SampleChip fixture="lib/fo-sample.ts sampleDigestBody" />}
          {data.state === 'off' && <SetupLink href="/setup" hint={DIGEST_COPY.offHint} />}
        </>
      }
    >
      {data.state === 'off' && <p className="text-[13px] text-os-muted">{DIGEST_COPY.offHint}</p>}
      {data.state !== 'ready' && data.digest && <p className="text-[13px] text-os-muted">Showing the last digest, from {dayLabel(data.digest.createdAt)}.</p>}
      {data.digest && (
        <div className="grid gap-4 min-[1100px]:grid-cols-2">
          {lanes.map((lane) => (
            <div key={lane.id} className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-os-text">{lane.label}</span>
                <span className="font-mono text-[11.5px] text-os-muted">
                  {lane.id === 'calendar' ? `${lane.events.length} today` : `${lane.entries.length} · ${lane.needsReply} need a reply`}
                </span>
              </div>
              {lane.id === 'calendar' ? (
                lane.events.length === 0 ? (
                  <p className="text-[12.5px] text-os-muted">Nothing on the calendar today.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-os-border">
                    {lane.events.map((ev) => (
                      <li key={ev.id} className="flex items-baseline gap-3 py-2">
                        <span className="w-14 shrink-0 font-mono text-[11.5px] text-os-muted">{ev.allDay ? 'all day' : hhmm(ev.start)}</span>
                        <span className="min-w-0 truncate text-[13px] text-os-text">{ev.title}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : lane.entries.length === 0 ? (
                <p className="text-[12.5px] text-os-muted">Nothing came in here.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-os-border">
                  {lane.entries.map((e) => (
                    <DigestRow key={`${e.source}|${e.sender}|${e.ts}`} entry={e} onClear={() => void reads.clear(e)} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DigestRow({ entry, onClear }: { entry: DigestEntry; onClear: () => void }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="w-14 shrink-0 pt-px font-mono text-[11.5px] text-os-muted">{hhmm(entry.ts)}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-os-text">
          {entry.sender}
          <Badge tone={needsReply(entry) ? 'accent' : 'default'}>{TIER_LABEL[entry.tier] ?? entry.tier}</Badge>
          {entry.carried && <Badge>Held over</Badge>}
        </span>
        <span className="line-clamp-2 text-[12.5px] text-os-muted">{entry.preview || entry.title}</span>
      </span>
      <button type="button" onClick={onClear} className="cf-btn shrink-0" aria-label={`Clear ${entry.sender}`}>
        Clear
      </button>
    </li>
  );
}

/* ── F4 Recordings ─────────────────────────────────────────────────────── */

export function RecordingsClassic({ initial, active }: { initial: RecordingsData; active: boolean }) {
  const { data, busy, refresh } = useRecordings(initial, active);
  const [open, setOpen] = useState<string | null>(null);
  const { plaud, fathom } = data.sources;
  const noneConfigured = !plaud.configured && !fathom.configured && !data.sample;
  const source = (name: string, s: RecordingsData['sources']['plaud']) => (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-os-muted">
      {name}
      {s.configured ? <Badge tone="ok">Connected</Badge> : (
        <>
          <Badge>Not configured</Badge>
          <SetupLink href={s.setupHref} />
        </>
      )}
    </span>
  );
  return (
    <Panel
      title="Recordings"
      sub="Call recordings from Plaud and Fathom"
      right={data.sample ? <SampleChip fixture="lib/fo-sample.ts sampleRecordings" /> : (
        <>
          {source('Plaud', plaud)}
          {source('Fathom', fathom)}
        </>
      )}
    >
      {fathom.error && (
        <p role="alert" className="text-[12.5px] text-os-err">
          Fathom did not answer: {fathom.error}{' '}
          <button type="button" className="cf-btn" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      {noneConfigured && data.rows.length === 0 ? (
        <div className={`${CARD} p-5 text-[13px] text-os-muted`}>No recording source is connected. Connect Plaud or Fathom and recordings land here.</div>
      ) : data.rows.length === 0 ? (
        <div className={`${CARD} p-5 text-[13px] text-os-muted`}>
          {RECORDINGS_EMPTY} {busy ? 'Checking Fathom now.' : 'A Plaud push or the next Fathom pull adds them.'}
        </div>
      ) : (
        <ul className="grid gap-3 min-[900px]:grid-cols-2">
          {data.rows.map((r) => {
            const isOpen = open === r.id;
            return (
              <li key={r.id} className={`${CARD} flex flex-col gap-2 p-4`}>
                <button type="button" className="flex w-full flex-col items-start gap-1 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14px] font-medium text-os-text">{r.title}</span>
                    <Badge>{r.source === 'plaud' ? 'Plaud' : 'Fathom'}</Badge>
                  </span>
                  <span className="font-mono text-[11.5px] text-os-muted">
                    {dayLabel(r.startedAt)} {hhmm(r.startedAt)} · {formatDuration(r.durationS)}
                  </span>
                  <span className="text-[12.5px] text-os-muted">{r.participants.length ? r.participants.join(', ') : 'People not recorded'}</span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2 border-t border-os-border pt-3">
                    <p className="text-[13px] leading-relaxed text-os-text">{r.summary || 'No summary came with this recording.'}</p>
                    {r.transcriptUrl ? (
                      <a href={r.transcriptUrl} target="_blank" rel="noreferrer" className="cf-btn inline-flex w-fit items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden /> Open transcript
                      </a>
                    ) : (
                      <span className="text-[12px] text-os-muted">No transcript link for this recording.</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ── F5 Slack client lanes ─────────────────────────────────────────────── */

export function ClientLanesClassic({ data, nowISO }: { data: ClientBoardData; nowISO: string }) {
  const now = new Date(nowISO);
  if (data.state === 'unconfigured') {
    return (
      <Panel title="Clients" sub="One lane per client Slack channel" right={<><Badge>Not configured</Badge><SetupLink href={data.setupHref} hint="set SLACK_BOT_TOKEN" /></>}>
        <div className={`${CARD} p-5 text-[13px] text-os-muted`}>Connect Slack and each confirmed client&apos;s channel gets a lane here.</div>
      </Panel>
    );
  }
  return (
    <Panel
      title="Clients"
      sub={
        data.clientsWithoutChannel > 0
          ? `One lane per client Slack channel · ${data.clientsWithoutChannel} confirmed ${data.clientsWithoutChannel === 1 ? 'client has' : 'clients have'} no channel yet`
          : 'One lane per client Slack channel'
      }
      right={data.sample ? <SampleChip fixture="lib/fo-sample.ts sampleClientLanes" /> : undefined}
    >
      {data.error && <p role="alert" className="text-[12.5px] text-os-err">Slack did not answer: {data.error}</p>}
      {data.lanes.length === 0 ? (
        <div className={`${CARD} p-5 text-[13px] text-os-muted`}>
          No client channels yet. Confirm a client on{' '}
          <a href="/clients" className="text-os-accent underline-offset-2 hover:underline">
            Clients
          </a>{' '}
          and give it a Slack channel; its lane appears here.
        </div>
      ) : (
        <div className="cf-lanes flex gap-4 overflow-x-auto pb-2" data-matrix-scroll>
          {data.lanes.map((lane) => (
            <div key={lane.clientId} className={`${CARD} flex w-[300px] shrink-0 flex-col gap-3 p-4`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-os-text">{lane.name}</div>
                  <div className="font-mono text-[11.5px] text-os-muted">#{lane.channel}</div>
                </div>
                <a href={lane.openUrl} target="_blank" rel="noreferrer" className="cf-btn inline-flex shrink-0 items-center gap-1.5" aria-label={`Open #${lane.channel} in Slack`}>
                  <ExternalLink className="h-3 w-3" strokeWidth={1.8} aria-hidden /> Slack
                </a>
              </div>
              {lane.messages.length === 0 ? (
                <p className="text-[12.5px] text-os-muted">No recent messages here. If this stays empty, invite the Slack bot to #{lane.channel}.</p>
              ) : (
                <ul className="flex max-h-[360px] flex-col divide-y divide-os-border overflow-y-auto">
                  {lane.messages.map((m) => (
                    <li key={m.ts} className="flex flex-col gap-1 py-2">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium text-os-text">{m.user}</span>
                        <span className="shrink-0 font-mono text-[11px] text-os-muted">{relativeTime(slackIso(m.ts), now)}</span>
                      </span>
                      <span className="line-clamp-3 text-[12.5px] text-os-muted">{m.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── F5 Week calendar ──────────────────────────────────────────────────── */

export function WeekClassic({ data }: { data: WeekData }) {
  if (!data.configured) {
    return (
      <Panel title="Week" sub="The next seven days" right={<><Badge>Not configured</Badge><SetupLink href={data.setupHref} /></>}>
        <div className={`${CARD} p-5 text-[13px] text-os-muted`}>Connect a calendar and the week fills in.</div>
      </Panel>
    );
  }
  const hours = Array.from({ length: data.hiHour - data.loHour }, (_, i) => data.loHour + i);
  const empty = data.days.every((d) => d.timed.length === 0 && d.allDay.length === 0);
  return (
    <Panel title="Week" sub={empty ? 'Nothing on the calendar in the next seven days.' : 'The next seven days'} right={data.sample ? <SampleChip fixture="lib/fo-sample.ts sampleWeekEvents" /> : undefined}>
      <div className="overflow-x-auto" data-matrix-scroll>
        <div className="cf-week grid min-w-[760px]" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }} role="grid" aria-label="Week calendar">
          <div aria-hidden>
            <div className="h-8" />
            <div className="h-7" />
            <div className="relative" style={{ height: hours.length * 44 }}>
              {hours.map((h, i) => (
                <span key={h} className="absolute right-2 font-mono text-[10.5px] text-os-muted" style={{ top: i * 44 - 6 }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          </div>
          {data.days.map((d) => (
            <div key={d.key} role="row" className="min-w-0 border-l border-os-border">
              <div role="columnheader" className={`flex h-8 items-center px-2 text-[12.5px] ${d.isToday ? 'font-medium text-os-accent' : 'text-os-muted'}`}>
                {d.label}
              </div>
              <div className="flex h-7 items-center gap-1 overflow-hidden px-1">
                {d.allDay.map((e) => (
                  <span key={e.id} className="truncate rounded-[4px] bg-[var(--accent-soft)] px-1.5 text-[11px] text-os-text" title={e.title}>
                    {e.title}
                  </span>
                ))}
              </div>
              <div className="cf-week-col relative" style={{ height: hours.length * 44 }}>
                {d.timed.map((e) => (
                  <span
                    key={e.id}
                    role="gridcell"
                    title={`${e.title} · ${hhmm(e.start)}${e.end ? ` to ${hhmm(e.end)}` : ''}`}
                    className="absolute overflow-hidden rounded-[6px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-1.5 py-1 text-[11px] leading-tight text-os-text"
                    style={{ top: `${e.topPct}%`, height: `${e.heightPct}%`, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${100 / e.lanes}% - 4px)` }}
                  >
                    <span className="block truncate">{e.title}</span>
                    <span className="block font-mono text-[10px] text-os-muted">{hhmm(e.start)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
