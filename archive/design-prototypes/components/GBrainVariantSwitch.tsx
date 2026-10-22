'use client';

/**
 * Design switcher for the G-Brain knowledge-core variants — the toolbar
 * toggle from UI Example 6, generalized to swap whole designs. Rendered on
 * every /design/gbrain* page so you can flip between them in place.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const VARIANTS = [
  { href: '/design/gbrain', name: 'Constellation', icon: 'dots' as const },
  { href: '/design/gbrain-2', name: '3D core', icon: 'orbit' as const },
  { href: '/design/gbrain-3', name: 'Radial', icon: 'radial' as const },
];

function Icon({ kind }: { kind: 'dots' | 'orbit' | 'radial' }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
  if (kind === 'dots')
    return (
      <svg width="15" height="15" viewBox="0 0 15 15" {...s}>
        <circle cx="4" cy="5" r="1.6" />
        <circle cx="11" cy="4" r="1.3" />
        <circle cx="7.5" cy="10.5" r="1.6" />
        <path d="M5.4 6 6.8 9M9.9 5 8.6 9.2" strokeWidth="1" opacity="0.7" />
      </svg>
    );
  if (kind === 'orbit')
    return (
      <svg width="15" height="15" viewBox="0 0 15 15" {...s}>
        <circle cx="7.5" cy="7.5" r="2.6" />
        <ellipse cx="7.5" cy="7.5" rx="6" ry="2.4" transform="rotate(-24 7.5 7.5)" strokeWidth="1" opacity="0.75" />
      </svg>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" {...s}>
      <circle cx="7.5" cy="7.5" r="1.7" />
      <path d="M7.5 5.5V2.2M7.5 9.5v3.3M5.5 7.5H2.2M9.5 7.5h3.3M6 6 3.8 3.8M9 9l2.2 2.2M9 6l2.2-2.2M6 9l-2.2 2.2" strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

export function GBrainVariantSwitch() {
  const pathname = usePathname();
  return (
    <div
      className="absolute left-1/2 top-5 z-30 flex -translate-x-1/2 items-center gap-1 rounded-[11px] border p-1"
      style={{ background: 'color-mix(in srgb, var(--elevated) 82%, transparent)', borderColor: 'rgb(var(--mist-rgb) / 0.09)', backdropFilter: 'blur(10px)' }}
    >
      {VARIANTS.map((v) => {
        const active = pathname === v.href;
        return (
          <Link
            key={v.href}
            href={v.href}
            className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] transition-colors"
            style={
              active
                ? { background: 'rgb(var(--mist-rgb) / 0.09)', color: 'var(--text)' }
                : { color: 'var(--text-3)' }
            }
          >
            <Icon kind={v.icon} />
            {v.name}
          </Link>
        );
      })}
    </div>
  );
}
