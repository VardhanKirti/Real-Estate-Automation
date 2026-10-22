'use client';

import type { InboxSource } from '@/lib/inbox';

/**
 * App marks for the channels, so a row is identified by the icon you already
 * know rather than by reading a word. Lucide has no WhatsApp or Slack glyph,
 * so these are drawn inline — single-colour, currentColor, no emoji, matching
 * the stroke icons used everywhere else.
 */

type MarkProps = { className?: string };

export function WhatsAppMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.17-1.36a9.93 9.93 0 0 0 4.87 1.24h.01c5.5 0 9.96-4.46 9.96-9.96 0-2.66-1.04-5.16-2.92-7.04A9.88 9.88 0 0 0 12.04 2Zm0 1.83c2.17 0 4.21.85 5.75 2.38a8.1 8.1 0 0 1 2.38 5.76c0 4.49-3.65 8.13-8.14 8.13a8.2 8.2 0 0 1-4.15-1.14l-.3-.18-3.07.8.82-3-.19-.31a8.08 8.08 0 0 1-1.24-4.31c0-4.49 3.65-8.13 8.14-8.13Zm-2.6 4.1c-.15 0-.4.06-.61.28-.21.22-.8.78-.8 1.9s.82 2.2.93 2.36c.12.15 1.6 2.44 3.88 3.42.54.23.96.37 1.29.48.54.17 1.04.15 1.43.09.44-.07 1.34-.55 1.53-1.08.19-.53.19-.98.13-1.08-.06-.1-.21-.15-.43-.27-.22-.11-1.34-.66-1.54-.74-.21-.08-.36-.11-.51.11-.15.23-.58.74-.71.89-.13.15-.26.17-.48.06-.22-.11-.95-.35-1.8-1.11-.67-.6-1.12-1.33-1.25-1.56-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.39.11-.13.15-.23.22-.38.08-.15.04-.28-.02-.39-.06-.11-.5-1.22-.69-1.67-.18-.44-.36-.38-.5-.39-.13 0-.28-.01-.43-.01Z" />
    </svg>
  );
}

export function SlackMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6.2 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1.06 0a2.1 2.1 0 0 1 4.2 0v5.26a2.1 2.1 0 0 1-4.2 0V15.2ZM8.8 6.2a2.1 2.1 0 1 1 2.1-2.1v2.1H8.8Zm0 1.06a2.1 2.1 0 0 1 0 4.2H3.54a2.1 2.1 0 0 1 0-4.2H8.8ZM17.8 8.8a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.8Zm-1.06 0a2.1 2.1 0 0 1-4.2 0V3.54a2.1 2.1 0 0 1 4.2 0V8.8ZM15.2 17.8a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1.06a2.1 2.1 0 0 1 0-4.2h5.26a2.1 2.1 0 0 1 0 4.2H15.2Z" />
    </svg>
  );
}

export function GmailMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.2 19.2h2.9v-7.05L2 9.07v8.53c0 .89.72 1.6 1.2 1.6Zm14.7 0h2.9c.89 0 1.2-.71 1.2-1.6V9.07l-4.1 3.08v7.05ZM17.9 5.2v6.95L22 9.07V6.2c0-1.48-1.69-2.33-2.87-1.44l-1.23.44Zm-11.8 6.95V5.2l5.9 4.43 5.9-4.43v6.95L12 16.58l-5.9-4.43ZM2 6.2v2.87l4.1 3.08V5.2l-1.23-.44C3.69 3.87 2 4.72 2 6.2Z" />
    </svg>
  );
}

export function CalendarMark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export const BRAND_MARK: Record<InboxSource, (p: MarkProps) => JSX.Element> = {
  whatsapp: WhatsAppMark,
  slack: SlackMark,
  email: GmailMark,
  calendar: CalendarMark,
};
