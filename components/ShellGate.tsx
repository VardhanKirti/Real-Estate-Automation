'use client';

import type { CSSProperties, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isBarePath } from '@/lib/bare-routes';

/**
 * The app shell steps aside on bare routes (lib/bare-routes.ts, GladOS UI H37).
 * usePathname runs during SSR too, so a signed-out visitor's first paint of
 * /login has no sidebar, top bar, palette or Wizard dock in the DOM, and a
 * client navigation in or out of /login swaps the chrome without a reload.
 */
export function ShellOnly({ children }: { children?: ReactNode }) {
  return isBarePath(usePathname()) ? null : <>{children}</>;
}

/** The content column: shell margin and sizing normally, a plain full-height column on bare routes. */
export function ShellColumn({ className, style, children }: { className: string; style?: CSSProperties; children?: ReactNode }) {
  const bare = isBarePath(usePathname());
  return (
    <div className={bare ? 'flex min-h-screen min-w-0 flex-col' : className} style={bare ? undefined : style} data-shell={bare ? 'bare' : 'app'}>
      {children}
    </div>
  );
}
