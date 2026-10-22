'use client';

/**
 * The Comms additions under the GladOS style (pages/feature-additions.md F3,
 * F4, F5): the morning digest banner (GCardRaised, opens a GSheet), the
 * Recordings tab (GTable, a row opens a GDrawer), the Clients tab (one GCard
 * per client channel in a horizontal scroller) and the Week tab (seven
 * columns). Kit primitives only; layout classes are the `wg-cf-*` block in
 * app/globals.css. Data comes from app/inbox/page.tsx (lib/comms-extras.ts).
 */
import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import {
  GButton,
  GCard,
  GCardRaised,
  GDrawer,
  GEmpty,
  GErrorLine,
  GKeyValue,
  GSampleBadge,
  GSectionHeader,
  GSheet,
  GTable,
  GTag,
} from '@/components/g';
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
import type { CallRecording } from '@/lib/schemas';
import { dayLabel, hhmm, slackIso, useDigestReads, useRecordings } from './hooks';

const TIER_LABEL: Record<string, string> = { call: 'Call booked', client: 'Client', people: 'Person', branddeal: 'Brand deal', group: 'Group', noise: 'Automated' };

/* ── F3 Morning digest ─────────────────────────────────────────────────── */

export function DigestBannerG({ data }: { data: DigestPanelData }) {
  const [open, setOpen] = useState(false);
  const reads = useDigestReads(data);
  const body = data.digest?.body ?? null;
  const lanes = digestLanes(body, data.today, reads.cleared);
  const waiting = lanes.reduce((n, l) => n + l.needsReply, 0);
  const total = lanes.reduce((n, l) => n + l.entries.length, 0);
  const unread = Boolean(data.digest) && !reads.read;

  const caption =
    data.state === 'ready'
      ? `${waiting} need a reply · ${total} in the report`
      : data.state === 'pending'
        ? DIGEST_COPY.pending
        : DIGEST_COPY.off;

  return (
    <>
      <GCardRaised className="wg-cf-digest" p={16}>
        <div className="wg-cf-digest-head">
          <span className="wg-cf-digest-title">
            {unread && <span className="wg-cf-dot" aria-label="Unread" />}
            Morning digest
          </span>
          {data.sample && <GSampleBadge fixture="lib/fo-sample.ts sampleDigestBody" />}
        </div>
        <p className="wg-cap">{caption}</p>
        {data.state === 'ready' && (
          <div className="wg-tags">
            {lanes.map((l) => (
              <GTag key={l.id} size="xs" tone={l.needsReply > 0 ? 'accent' : 'neutral'}>
                {l.label} {l.id === 'calendar' ? l.events.length : l.entries.length}
              </GTag>
            ))}
          </div>
        )}
        <div className="wg-cf-digest-actions">
          {data.digest ? (
            <GButton
              variant="sm"
              onClick={() => {
                setOpen(true);
                void reads.markRead();
              }}
            >
              {data.state === 'ready' ? 'Open digest' : `Open the ${dayLabel(data.digest.createdAt)} digest`}
            </GButton>
          ) : null}
          {data.state === 'off' && (
            <GButton variant="sm" href="/setup" title={DIGEST_COPY.offHint}>
              Set up
            </GButton>
          )}
        </div>
        {data.state === 'off' && <p className="wg-cap">{DIGEST_COPY.offHint}</p>}
      </GCardRaised>

      <GSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Morning digest"
        caption={data.digest ? `Built ${dayLabel(data.digest.createdAt)}, ${hhmm(data.digest.createdAt)} · ${waiting} need a reply` : undefined}
        width={640}
        className="wg-cf-sheet"
      >
        {lanes.map((lane) => (
          <section key={lane.id} className="wg-cf-lane" aria-label={lane.label}>
            <GSectionHeader size={22} title={lane.label} caption={lane.id === 'calendar' ? `${lane.events.length} today` : `${lane.entries.length} in the report · ${lane.needsReply} need a reply`} />
            {lane.id === 'calendar' ? (
              lane.events.length === 0 ? (
                <p className="wg-cap">Nothing on the calendar today.</p>
              ) : (
                <ul className="wg-cf-entries">
                  {lane.events.map((ev) => (
                    <li key={ev.id} className="wg-cf-entry">
                      <span className="wg-cf-entry-when">{ev.allDay ? 'All day' : hhmm(ev.start)}</span>
                      <span className="wg-cf-entry-main">
                        <span className="wg-cf-entry-who">{ev.title}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : lane.entries.length === 0 ? (
              <p className="wg-cap">Nothing came in here.</p>
            ) : (
              <ul className="wg-cf-entries">
                {lane.entries.map((e) => (
                  <DigestEntryG key={`${e.source}|${e.sender}|${e.ts}`} entry={e} onClear={() => void reads.clear(e)} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </GSheet>
    </>
  );
}

function DigestEntryG({ entry, onClear }: { entry: DigestEntry; onClear: () => void }) {
  return (
    <li className="wg-cf-entry">
      <span className="wg-cf-entry-when">{hhmm(entry.ts)}</span>
      <span className="wg-cf-entry-main">
        <span className="wg-cf-entry-who">
          {entry.sender}
          <GTag size="xs" tone={needsReply(entry) ? 'accent' : 'neutral'}>
            {TIER_LABEL[entry.tier] ?? entry.tier}
          </GTag>
          {entry.carried && <GTag size="xs">Held over</GTag>}
        </span>
        <span className="wg-cf-entry-text">{entry.preview || entry.title}</span>
      </span>
      <GButton variant="sm" onClick={onClear} aria-label={`Clear ${entry.sender}`}>
        Clear
      </GButton>
    </li>
  );
}

/* ── F4 Recordings ─────────────────────────────────────────────────────── */

export function RecordingsG({ initial, active }: { initial: RecordingsData; active: boolean }) {
  const { data, refresh, busy } = useRecordings(initial, active);
  const [openId, setOpenId] = useState<string | null>(null);
  const current = data.rows.find((r) => r.id === openId) ?? null;
  const { plaud, fathom } = data.sources;
  const noneConfigured = !plaud.configured && !fathom.configured && !data.sample;

  return (
    <GCard className="wg-cf-card" p={20}>
      <GSectionHeader
        size={22}
        title="Recordings"
        caption="Call recordings from Plaud and Fathom"
        action={data.sample ? <GSampleBadge fixture="lib/fo-sample.ts sampleRecordings" /> : undefined}
      />
      {!data.sample && (
        <div className="wg-cf-sources">
          <SourceState name="Plaud" s={plaud} />
          <SourceState name="Fathom" s={fathom} />
        </div>
      )}
      {fathom.error && (
        <GErrorLine align="left" onRetry={() => void refresh()}>
          Fathom did not answer: {fathom.error}
        </GErrorLine>
      )}
      {noneConfigured && data.rows.length === 0 ? (
        <GEmpty kind="unconfigured" title="No recording source is connected" body="Connect Plaud or Fathom and recordings land here." setupHref={fathom.setupHref} />
      ) : (
        <div className="wg-cf-tablewrap" data-matrix-scroll>
        <GTable<CallRecording>
          caption="Call recordings"
          rows={data.rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          rowLabel={(r) => `Open ${r.title}`}
          selectedKey={openId}
          empty={<GEmpty inline title={RECORDINGS_EMPTY} body={busy ? 'Checking Fathom now.' : 'A Plaud push or the next Fathom pull adds them.'} />}
          sort={{ key: 'date', dir: 'desc' }}
          columns={[
            { key: 'title', label: 'Title', render: (r) => <span className="wg-cf-rec-title">{r.title}</span>, sortValue: (r) => r.title },
            { key: 'date', label: 'Date', render: (r) => dayLabel(r.startedAt), sortValue: (r) => r.startedAt },
            { key: 'len', label: 'Length', align: 'right', numeric: true, render: (r) => formatDuration(r.durationS), sortValue: (r) => r.durationS ?? -1 },
            { key: 'people', label: 'People', render: (r) => (r.participants.length ? r.participants.join(', ') : 'Not recorded') },
            { key: 'source', label: 'Source', render: (r) => <GTag size="xs">{r.source === 'plaud' ? 'Plaud' : 'Fathom'}</GTag> },
          ]}
        />
        </div>
      )}
      <GDrawer open={!!current} onClose={() => setOpenId(null)} title={current?.title ?? 'Recording'} width={520}>
        {current && (
          <div className="wg-cf-drawer">
            <GKeyValue
              items={[
                { label: 'Date', value: `${dayLabel(current.startedAt)}, ${hhmm(current.startedAt)}` },
                { label: 'Length', value: formatDuration(current.durationS) },
                { label: 'People', value: current.participants.length ? current.participants.join(', ') : 'Not recorded' },
                { label: 'Source', value: current.source === 'plaud' ? 'Plaud' : 'Fathom' },
              ]}
            />
            <GSectionHeader size={22} title="Summary" />
            <p className="wg-cf-summary">{current.summary || 'No summary came with this recording.'}</p>
            {current.transcriptUrl ? (
              <GButton href={current.transcriptUrl} external>
                <FileText size={14} strokeWidth={1.75} aria-hidden /> Open transcript
              </GButton>
            ) : (
              <p className="wg-cap">No transcript link for this recording.</p>
            )}
          </div>
        )}
      </GDrawer>
    </GCard>
  );
}

function SourceState({ name, s }: { name: string; s: RecordingsData['sources']['plaud'] }) {
  return (
    <span className="wg-cf-source">
      {name}
      {s.configured ? (
        <GTag size="xs" tone="ok" dot>
          Connected
        </GTag>
      ) : (
        <>
          <GTag size="xs">Not configured</GTag>
          <GButton variant="sm" href={s.setupHref}>
            Set up
          </GButton>
        </>
      )}
    </span>
  );
}

/* ── F5 Slack client board ─────────────────────────────────────────────── */

export function ClientsBoardG({ data, nowISO }: { data: ClientBoardData; nowISO: string }) {
  const now = new Date(nowISO);
  if (data.state === 'unconfigured') {
    return (
      <GCard className="wg-cf-card" p={20}>
        <GSectionHeader size={22} title="Clients" caption="One lane per client Slack channel" />
        <GEmpty kind="unconfigured" title="Slack is not connected" body="Connect Slack and each confirmed client's channel gets a lane here." setupHref={data.setupHref} setupHint="set SLACK_BOT_TOKEN" />
      </GCard>
    );
  }
  return (
    <section className="wg-cf-board" aria-label="Client Slack channels">
      <GSectionHeader
        size={22}
        title="Clients"
        caption={
          data.clientsWithoutChannel > 0
            ? `One lane per client Slack channel · ${data.clientsWithoutChannel} confirmed ${data.clientsWithoutChannel === 1 ? 'client has' : 'clients have'} no channel yet`
            : 'One lane per client Slack channel'
        }
        action={data.sample ? <GSampleBadge fixture="lib/fo-sample.ts sampleClientLanes" /> : undefined}
      />
      {data.error && <GErrorLine align="left">Slack did not answer: {data.error}</GErrorLine>}
      {data.lanes.length === 0 ? (
        <GCard p={20}>
          <GEmpty title="No client channels yet" body="Confirm a client on Clients and give it a Slack channel; its lane appears here." action={{ label: 'Open Clients', href: '/clients' }} />
        </GCard>
      ) : (
        <div className="wg-cf-lanes" data-matrix-scroll>
          {data.lanes.map((lane) => (
            <GCard key={lane.clientId} className="wg-cf-lanecard" p={16}>
              <div className="wg-cf-lane-head">
                <span className="wg-cf-lane-name">{lane.name}</span>
                <GButton variant="sm" href={lane.openUrl} external aria-label={`Open #${lane.channel} in Slack`}>
                  <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> Slack
                </GButton>
              </div>
              <p className="wg-cap">#{lane.channel}</p>
              {lane.messages.length === 0 ? (
                <p className="wg-cap">No recent messages here. If this stays empty, invite the Slack bot to #{lane.channel}.</p>
              ) : (
                <ul className="wg-cf-msgs">
                  {lane.messages.map((m) => (
                    <li key={m.ts}>
                      <span className="wg-cf-msg-head">
                        <span className="wg-cf-entry-who">{m.user}</span>
                        <span className="wg-cap">{relativeTime(slackIso(m.ts), now)}</span>
                      </span>
                      <span className="wg-cf-entry-text">{m.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </GCard>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── F5 Week calendar ──────────────────────────────────────────────────── */

export function WeekG({ data }: { data: WeekData }) {
  if (!data.configured) {
    return (
      <GCard className="wg-cf-card" p={20}>
        <GSectionHeader size={22} title="Week" caption="The next seven days" />
        <GEmpty kind="unconfigured" title="No calendar is connected" body="Connect a calendar and the week fills in." setupHref={data.setupHref} />
      </GCard>
    );
  }
  const hours = Array.from({ length: data.hiHour - data.loHour }, (_, i) => data.loHour + i);
  const empty = data.days.every((d) => d.timed.length === 0 && d.allDay.length === 0);
  return (
    <GCard className="wg-cf-card" p={20}>
      <GSectionHeader
        size={22}
        title="Week"
        caption="The next seven days"
        action={data.sample ? <GSampleBadge fixture="lib/fo-sample.ts sampleWeekEvents" /> : undefined}
      />
      {empty && <p className="wg-cap">Nothing on the calendar in the next seven days.</p>}
      <div className="wg-cf-week-scroll" data-matrix-scroll>
        <div className="wg-cf-week" role="grid" aria-label="Week calendar">
          <div className="wg-cf-week-hours" aria-hidden>
            <span className="wg-cf-week-dayhead" />
            <span className="wg-cf-week-allday" />
            <div className="wg-cf-week-grid" style={{ ['--hours' as string]: hours.length }}>
              {hours.map((h) => (
                <span key={h} className="wg-cf-week-hour">
                  {h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}
                </span>
              ))}
            </div>
          </div>
          {data.days.map((d) => (
            <div key={d.key} className="wg-cf-week-day" role="row" data-today={d.isToday || undefined}>
              <span className="wg-cf-week-dayhead" role="columnheader">
                {d.isToday ? `Today, ${d.label}` : d.label}
              </span>
              <span className="wg-cf-week-allday">
                {d.allDay.map((e) => (
                  <span key={e.id} className="wg-cf-week-chip" title={e.title}>
                    {e.title}
                  </span>
                ))}
              </span>
              <div className="wg-cf-week-grid" style={{ ['--hours' as string]: hours.length }}>
                {d.timed.map((e) => (
                  <span
                    key={e.id}
                    role="gridcell"
                    className="wg-cf-week-ev"
                    title={`${e.title} · ${hhmm(e.start)}${e.end ? ` to ${hhmm(e.end)}` : ''}`}
                    style={{ top: `${e.topPct}%`, height: `${e.heightPct}%`, left: `${(e.lane / e.lanes) * 100}%`, width: `${100 / e.lanes}%` }}
                  >
                    <span className="wg-cf-week-ev-title">{e.title}</span>
                    <span className="wg-cf-week-ev-time">{hhmm(e.start)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GCard>
  );
}
