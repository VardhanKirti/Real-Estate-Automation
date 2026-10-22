import Link from 'next/link';

export function PageHeader({
  eyebrow,
  title,
  caret = false,
  right,
  rightWide = false,
  back,
}: {
  /** Renders as the muted subtitle line under the title (Console spec). */
  eyebrow?: string;
  title: string;
  caret?: boolean;
  right?: React.ReactNode;
  /** Let the `right` widget stretch wide across the header whitespace as a
      short bar tucked top-right, instead of sitting compact against the edge. */
  rightWide?: boolean;
  /** Where this page sits under — a sub-page needs a way back out. */
  back?: { href: string; label: string };
}) {
  // Console header spec (docs/DESIGN-CONSOLE.md): 22px/500 sentence-case
  // title with the quiet 13px subtitle BELOW it — the uppercase eyebrow and
  // `//` prefix retired with the Monolith voice.
  return (
    <header data-page-header="" className={`mb-9 flex flex-wrap justify-between gap-5 ${rightWide ? 'items-start' : 'items-end'}`}>
      <div className="min-w-0 max-w-full shrink-0">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1.5 text-[12px] text-os-dim transition-colors hover:text-os-text"
          >
            <span aria-hidden>‹</span> {back.label}
          </Link>
        )}
        <h1 data-part="title" className={`text-[22px] font-medium leading-[1.2] tracking-[-0.01em]${caret ? ' caret-blink' : ''}`}>
          {title}
        </h1>
        {eyebrow && <p data-part="subtitle" className="mt-1 text-[13px] text-os-muted">{eyebrow}</p>}
      </div>
      {right && (
        <div className={rightWide ? 'flex min-w-0 flex-1 items-start' : 'flex shrink-0 items-center gap-3'}>
          {right}
        </div>
      )}
    </header>
  );
}
