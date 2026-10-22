'use client';

import type { CSSProperties, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { activeHref, groupOf, NAV_ITEMS } from '@/lib/nav';
import { isLegacyWorkspace } from '@/lib/l-ready';
import { useUiStyle } from '@/lib/use-ui-style';
import type { UiStyle } from '@/lib/appearance';

/** The slab eyebrow for a route: `// <GROUP> · <PRODUCT>`, from the nav (single source) and BRAND. */
export function legacyEyebrow(pathname: string): string {
  const href = activeHref(pathname);
  const group = href ? groupOf(href) : undefined;
  const item = href ? NAV_ITEMS.find((i) => i.href === href) : undefined;
  const head = group?.title ?? item?.label ?? 'Operator';
  return `// ${head} · ${BRAND.name}`.toUpperCase();
}

/**
 * The one slab every Bennett Legacy page sits on (FO v1 .os-slab), applied in
 * app/layout.tsx so Classic trees under the Legacy skin get it too (O1). Only
 * under data-ui='legacy', and never on full-height workspaces
 * (lib/l-ready.ts L_NO_SLAB). The eyebrow rides a custom property the
 * Classic PageHeader reads through CSS (L0 block), so Classic markup is untouched.
 */
export function LegacySlab({ ui: initial, children }: { ui: UiStyle; children?: ReactNode }) {
  const ui = useUiStyle(initial);
  const pathname = usePathname() ?? '/';
  if (ui !== 'legacy' || isLegacyWorkspace(pathname)) return <>{children}</>;
  const style = { ['--l-eyebrow' as string]: JSON.stringify(legacyEyebrow(pathname)) } as CSSProperties;
  return (
    <div data-l="Slab" data-l-frame="" className="l-slab l-frame" style={style}>
      {children}
    </div>
  );
}
