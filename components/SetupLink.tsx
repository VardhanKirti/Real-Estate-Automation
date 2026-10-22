import Link from 'next/link';

/**
 * The ONE setup affordance for anything unconfigured (* "every single thing that needs to be set up has a setup button"). Small
 * mint button that routes to the fix — an /integrations tile anchor
 * (setupHrefFor), /setup, or an agent's key page. The raw diagnostic hint
 * ("set INBOX_1_HOST…") moves out of the dashboard into the hover title;
 * the full guidance lives in the destination's connect flow.
 */
export function SetupLink({
  href = '/integrations',
  hint,
  label = 'Set up',
  className = '',
}: {
  href?: string;
  hint?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={`inline-flex w-fit items-center gap-1 rounded-[8px] border px-2.5 py-[3px] text-[11.5px] font-medium text-os-accent transition-colors hover:bg-[var(--accent-soft)] ${className}`}
      style={{ borderColor: 'var(--accent-line)' }}
    >
      {label} <span aria-hidden>›</span>
    </Link>
  );
}
