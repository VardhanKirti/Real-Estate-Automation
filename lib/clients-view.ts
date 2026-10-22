/**
 * The /clients view model (pages/clients.md §2, §5), built on the server from
 * the ClientsPayload so the GladOS, Classic and (later) Bennett Legacy trees
 * all render the same figures. Pure: `now` is passed in.
 *
 * Request activity, volume and rhythm are a port of FounderOS
 * `pages/clients/volume.go`, computed from `client_work` only. No fee,
 * contract term or revenue appears anywhere here (CL-4).
 */
import type { ClientsPayload } from '@/lib/clients-data';
import type { ClientWorkStatus } from '@/lib/schemas';

const DAY = 86_400_000;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const STATUS_LABEL: Record<ClientWorkStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

export type ClientRosterRow = {
  clientId: string;
  name: string;
  company: string;
  source: 'attio' | 'manual';
  retainer: boolean;
  slackChannel: string | null;
  /** Only when the channel is a Slack channel id; a bare name has no reliable link. */
  slackHref: string | null;
  supersetProject: string | null;
  confirmedAt: string;
  openRequests: number;
  lastRequestAge: string | null;
};

export type ClientWorkRow = {
  id: string;
  clientId: string;
  clientName: string;
  brief: string;
  /** First line of the brief, at most 120 characters. */
  briefLine: string;
  status: ClientWorkStatus;
  statusLabel: string;
  createdAt: string;
  age: string;
  finishedAt: string | null;
  detail: string;
  supersetWorkspace: string | null;
  /** draft and failed rows can start in Superset. */
  launchable: boolean;
  /** Sample rows are a fixture: no action touches them. */
  sample: boolean;
};

export type ClientsView = {
  title: string;
  subtitle: string;
  roster: ClientRosterRow[];
  work: ClientWorkRow[];
  activity: { labels: string[]; axisLabels: string[]; created: number[]; finished: number[]; total14: number };
  volume: { open: number; doneThisMonth: number; failedThisMonth: number; thisMonth: number; total: number };
  rhythm: { day: (typeof WEEKDAYS)[number]; count: number }[];
  busiestDay: (typeof WEEKDAYS)[number] | null;
  candidates: ClientsPayload['candidates'];
  attioState: ClientsPayload['attio']['state'];
  supersetState: ClientsPayload['superset']['state'];
  supersetDetail: string;
  writes: boolean;
  mode: ClientsPayload['mode'];
  sample: boolean;
  /** Selected client (`?client=`), when it is on the roster. */
  selected: string | null;
};

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "3 min", "5 h", "2 d", "6 w": compact age for a table cell. */
export function ageLabel(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 21) return `${days} d`;
  return `${Math.round(days / 7)} w`;
}

/** A Slack channel id (C…/G…) links through Slack's redirect; a plain name stays text. */
export function slackHrefFor(channel: string | null): string | null {
  if (!channel) return null;
  const c = channel.replace(/^#/, '').trim();
  return /^[CG][A-Z0-9]{8,}$/.test(c) ? `https://slack.com/app_redirect?channel=${c}` : null;
}

export function briefLine(brief: string): string {
  const first = brief.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const t = first.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

const OPEN: ClientWorkStatus[] = ['draft', 'queued', 'running'];

export function buildClientsView(p: ClientsPayload, opts: { now?: Date; selected?: string | null } = {}): ClientsView {
  const now = opts.now ?? new Date();
  const names = new Map(p.roster.map((c) => [c.clientId, c.name]));

  // 14 local days, oldest first.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() - (13 - i) * DAY));
  const dayKeys = days.map(ymdLocal);
  const created = days.map(() => 0);
  const finished = days.map(() => 0);
  const rhythm = WEEKDAYS.map((day) => ({ day, count: 0 }));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const volume = { open: 0, doneThisMonth: 0, failedThisMonth: 0, thisMonth: 0, total: p.work.length };

  for (const w of p.work) {
    const c = new Date(w.createdAt);
    const ci = dayKeys.indexOf(ymdLocal(c));
    if (ci >= 0) created[ci] += 1;
    rhythm[(c.getDay() + 6) % 7].count += 1;
    if (c.getTime() >= monthStart) volume.thisMonth += 1;
    if (OPEN.includes(w.status)) volume.open += 1;
    if (w.finishedAt) {
      const f = new Date(w.finishedAt);
      const fi = dayKeys.indexOf(ymdLocal(f));
      if (fi >= 0) finished[fi] += 1;
      if (f.getTime() >= monthStart) {
        if (w.status === 'done') volume.doneThisMonth += 1;
        if (w.status === 'failed') volume.failedThisMonth += 1;
      }
    }
  }

  const max = Math.max(0, ...rhythm.map((r) => r.count));
  const busiestDay = max > 0 ? rhythm.find((r) => r.count === max)!.day : null;

  const roster: ClientRosterRow[] = p.roster.map((c) => {
    const mine = p.work.filter((w) => w.clientId === c.clientId);
    const last = mine[0]; // work is newest first
    return {
      clientId: c.clientId,
      name: c.name,
      company: c.company,
      source: c.source,
      retainer: c.retainer,
      slackChannel: c.slackChannel,
      slackHref: slackHrefFor(c.slackChannel),
      supersetProject: c.supersetProject,
      confirmedAt: c.confirmedAt,
      openRequests: mine.filter((w) => OPEN.includes(w.status)).length,
      lastRequestAge: last ? ageLabel(last.createdAt, now) : null,
    };
  });

  const work: ClientWorkRow[] = p.work.map((w) => ({
    id: w.id,
    clientId: w.clientId,
    clientName: names.get(w.clientId) ?? 'Unconfirmed client',
    brief: w.brief,
    briefLine: briefLine(w.brief),
    status: w.status,
    statusLabel: STATUS_LABEL[w.status],
    createdAt: w.createdAt,
    age: ageLabel(w.createdAt, now),
    finishedAt: w.finishedAt,
    detail: w.detail,
    supersetWorkspace: w.supersetWorkspace,
    launchable: w.status === 'draft' || w.status === 'failed',
    sample: p.sample,
  }));

  const selected = opts.selected && names.has(opts.selected) ? opts.selected : null;

  return {
    title: 'Clients',
    subtitle: 'Client work · draft first',
    roster,
    work,
    activity: {
      labels: days.map((d) => `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`),
      axisLabels: days.map((d, i) => (i === 0 || i === 13 || i === 7 ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '')),
      created,
      finished,
      total14: created.reduce((a, b) => a + b, 0),
    },
    volume,
    rhythm,
    busiestDay,
    candidates: p.candidates,
    attioState: p.attio.state,
    supersetState: p.superset.state,
    supersetDetail: p.superset.detail,
    writes: p.writes,
    mode: p.mode,
    sample: p.sample,
    selected,
  };
}

/** Why "Start draft in Superset" is disabled, or null when it may be pressed (CL-3). */
export function launchBlockedReason(v: Pick<ClientsView, 'writes' | 'mode' | 'supersetState'>, row?: Pick<ClientWorkRow, 'launchable' | 'sample' | 'statusLabel'>): string | null {
  if (v.mode === 'filming') return 'Filming mode: read only';
  if (row?.sample) return 'Sample data: nothing to launch';
  if (!v.writes) return 'Launching is off on this instance (GLADOS_WRITES)';
  if (v.supersetState !== 'connected') return 'Superset is not configured';
  if (row && !row.launchable) return `Already ${row.statusLabel.toLowerCase()}`;
  return null;
}

/** Why local writes (confirm, save draft, status) are disabled, or null. */
export function writeBlockedReason(v: Pick<ClientsView, 'mode'>): string | null {
  return v.mode === 'filming' ? 'Filming mode: read only' : null;
}
