/** Inline stroke icons for the Lab (02 section 2.4). No icon font, no emoji, no image files. */
import type { ReactNode } from 'react';

export type IconSize = 10 | 12 | 14 | 16 | 18 | 20;
type P = { size?: IconSize; className?: string };

function Svg({ size = 16, className, children }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 14 ? 1.25 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-lab-icon=""
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconPlusCircle = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></Svg>;
export const IconArrowUpRight = (p: P) => <Svg {...p}><path d="M7 17 17 7M9 7h8v8" /></Svg>;
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="m14.5 6-6 6 6 6" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M5 8h14M5 12h14M5 16h9" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M8 5.5v13l10-6.5z" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconTrendUp = (p: P) => <Svg {...p}><path d="m4 16 6-6 4 4 6-6" /><path d="M15 8h5v5" /></Svg>;
export const IconTrendDown = (p: P) => <Svg {...p}><path d="m4 8 6 6 4-4 6 6" /><path d="M15 16h5v-5" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16v.01" /></Svg>;
export const IconMinus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconExpand = (p: P) => <Svg {...p}><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></Svg>;
export const IconCollapse = (p: P) => <Svg {...p}><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" /></Svg>;
export const IconRecentre = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Svg>;
