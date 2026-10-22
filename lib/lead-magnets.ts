/**
 * Derived figures for /lead-magnets (pages/lead-magnets.md §2). Pure.
 *
 * Captures: per-URL capture counts need Trakyo's lead events matched on the
 * landing URL. Trakyo API v1 (openapi.json, read 2026-10-12) has no such
 * read: GET /v1/leads filters by source, content item and form name, and a
 * lead's landing domain is only on GET /v1/leads/{id}/events (one call per
 * lead, and the page path is not carried). So every row says "not tracked"
 * with the reason, never 0 (LM-3). When Trakyo is not keyed the reason points
 * at its Set up link.
 */
import type { LeadMagnet, LeadMagnetStatus } from '@/lib/schemas';

export type CapturesState = { tracked: false; reason: 'trakyo_not_configured' | 'not_wired'; setupHref: string | null };

export type LeadMagnetsView = {
  /** pages shipped per ISO week (Monday start), oldest first, 12 weeks */
  shippedByWeek: { weekStart: string; count: number }[];
  volume: Record<LeadMagnetStatus, number>;
  /** share of live pages by where leads land; null when nothing is live */
  destinations: { email: number; booking: number } | null;
  captures: CapturesState;
};

const DAY = 86_400_000;
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function shippedByWeek(magnets: LeadMagnet[], now: Date = new Date(), weeks = 12): LeadMagnetsView['shippedByWeek'] {
  const thisWeek = mondayOf(now);
  const starts = Array.from({ length: weeks }, (_, i) => new Date(thisWeek.getTime() - (weeks - 1 - i) * 7 * DAY));
  const out = starts.map((s) => ({ weekStart: ymd(s), count: 0 }));
  for (const m of magnets) {
    if (!m.wentLiveAt) continue;
    const [y, mo, d] = m.wentLiveAt.split('-').map(Number);
    const key = ymd(mondayOf(new Date(y, mo - 1, d)));
    const slot = out.find((w) => w.weekStart === key);
    if (slot) slot.count += 1;
  }
  return out;
}

export function leadMagnetsView(magnets: LeadMagnet[], opts: { now?: Date; trakyoConfigured: boolean; trakyoSetupHref: string }): LeadMagnetsView {
  const volume: Record<LeadMagnetStatus, number> = { draft: 0, live: 0, paused: 0, archived: 0 };
  for (const m of magnets) volume[m.status] += 1;
  const live = magnets.filter((m) => m.status === 'live');
  const email = live.filter((m) => m.destination === 'email').length;
  return {
    shippedByWeek: shippedByWeek(magnets, opts.now),
    volume,
    destinations: live.length ? { email: email / live.length, booking: (live.length - email) / live.length } : null,
    captures: opts.trakyoConfigured
      ? { tracked: false, reason: 'not_wired', setupHref: null }
      : { tracked: false, reason: 'trakyo_not_configured', setupHref: opts.trakyoSetupHref },
  };
}

/* ── page view model (GladOS, Classic and later Legacy trees share it) ── */

export const LM_STATUS_LABEL: Record<LeadMagnetStatus, string> = { draft: 'Draft', live: 'Live', paused: 'Paused', archived: 'Archived' };
export const LM_STATUSES: LeadMagnetStatus[] = ['live', 'draft', 'paused', 'archived'];
export const LM_DESTINATION_LABEL: Record<LeadMagnet['destination'], string> = { email: 'Email list', booking: 'Booking' };

export type LeadMagnetRow = LeadMagnet & {
  /** host + path for the Link column ("example.com/kit") */
  linkLabel: string;
  statusLabel: string;
  destinationLabel: string;
  /** "Oct 8" or null */
  wentLiveLabel: string | null;
  sample: boolean;
};

export type LeadMagnetsPage = {
  title: string;
  subtitle: string;
  rows: LeadMagnetRow[];
  /** every row, unfiltered count by status */
  view: LeadMagnetsView;
  total: number;
  filter: LeadMagnetStatus | null;
  /** "Not tracked" copy for the Captures column and its hover reason */
  capturesNote: string;
  capturesReason: string;
  weeks: { labels: string[]; axisLabels: string[]; counts: number[] };
  mode: 'live' | 'sample' | 'filming';
  sample: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

export function buildLeadMagnetsPage(
  all: LeadMagnet[],
  opts: { filter: LeadMagnetStatus | null; mode: 'live' | 'sample' | 'filming'; trakyoConfigured: boolean; trakyoSetupHref: string; now?: Date },
): LeadMagnetsPage {
  const view = leadMagnetsView(all, { now: opts.now, trakyoConfigured: opts.trakyoConfigured, trakyoSetupHref: opts.trakyoSetupHref });
  const sample = opts.mode !== 'live';
  const rows = all
    .filter((m) => !opts.filter || m.status === opts.filter)
    .map((m) => ({
      ...m,
      linkLabel: linkLabel(m.liveUrl),
      statusLabel: LM_STATUS_LABEL[m.status],
      destinationLabel: LM_DESTINATION_LABEL[m.destination],
      wentLiveLabel: m.wentLiveAt ? shortDate(m.wentLiveAt) : null,
      sample,
    }));
  const n = all.length;
  return {
    title: 'Lead magnets',
    subtitle: `${n} ${n === 1 ? 'page' : 'pages'} · ${view.volume.live} live`,
    rows,
    view,
    total: n,
    filter: opts.filter,
    capturesNote: 'Not tracked',
    capturesReason:
      view.captures.reason === 'trakyo_not_configured'
        ? 'Captures come from Trakyo. Connect it to count leads per page.'
        : 'Trakyo reports leads per content item, not per landing URL, so captures per page are not tracked.',
    weeks: {
      labels: view.shippedByWeek.map((w) => `Week of ${shortDate(w.weekStart)}`),
      axisLabels: view.shippedByWeek.map((w, i, a) => (i === 0 || i === a.length - 1 || i === 6 ? shortDate(w.weekStart) : '')),
      counts: view.shippedByWeek.map((w) => w.count),
    },
    mode: opts.mode,
    sample,
  };
}
