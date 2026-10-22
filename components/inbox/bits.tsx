'use client';

import { CalendarDays, Hash, Mail, MessageSquare, type LucideIcon } from 'lucide-react';
import { initials, SOURCES, TRIAGE, type InboxSource, type Triage } from '@/lib/inbox';
import { BRAND_MARK } from './brand';

export const SOURCE_ICON: Record<InboxSource, LucideIcon> = {
  email: Mail,
  slack: Hash,
  whatsapp: MessageSquare,
  calendar: CalendarDays,
};

export const sourceLabel = (s: InboxSource): string => SOURCES.find((x) => x.id === s)?.label ?? s;
export const triageLabel = (t: Triage): string => TRIAGE.find((x) => x.id === t)?.label ?? t;

/**
 * The channel as its own app mark, raised off the page. Three states, and the
 * ring is the only thing that changes: resting, a colourless highlight when
 * the thread has unread messages, and lit green when it is the open thread.
 */
export function SourceBadge({
  source,
  unread = false,
  selected = false,
}: {
  source: InboxSource;
  unread?: boolean;
  selected?: boolean;
}) {
  const Mark = BRAND_MARK[source];
  const state = selected ? 'selected' : unread ? 'unread' : 'rest';
  return (
    <span
      className="ib-badge"
      data-source={source}
      data-state={state}
      title={`${sourceLabel(source)}${unread ? ' · unread' : ''}`}
    >
      <Mark className="ib-badge-mark" />
    </span>
  );
}

/** The source spelled out — icon in the source colour, the word in plain text,
    so a top-down scan of the list tells email from Slack without decoding icons. */
export function SourcePill({ source, size = 'md' }: { source: InboxSource; size?: 'sm' | 'md' }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className={`ib-src ib-src-${size}`} data-source={source}>
      <Icon strokeWidth={1.8} />
      {sourceLabel(source)}
    </span>
  );
}

export function TriagePill({ triage }: { triage: Triage }) {
  return (
    <span className="ib-tri" data-triage={triage}>
      {triageLabel(triage)}
    </span>
  );
}

export function Avatar({
  name,
  source,
  size = 34,
  src,
}: {
  name: string;
  source: InboxSource;
  size?: number;
  /** A real cached photo. Absent — the common case — means initials. */
  src?: string;
}) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className="ib-av" data-source={source} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ib-av-img" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : source === 'calendar' ? (
        <Icon strokeWidth={1.8} style={{ width: size * 0.46, height: size * 0.46 }} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`ib-mono ${className}`}>{children}</span>;
}
