import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/**
 * Static markup for a tree that calls next/navigation's useRouter: the app
 * router context is stubbed (no navigation happens in a static render).
 */
const ROUTER = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
} as unknown as React.ContextType<typeof AppRouterContext>;

export function renderWithRouter(el: ReactElement): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, el));
}
