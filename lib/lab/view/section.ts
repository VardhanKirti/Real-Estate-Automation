/**
 * Section-state helpers for the page builders (01 5.4). Each section of a page is built inside
 * `section()`, so one failing builder step renders that section's `error` state and the rest of
 * the page still builds (AC-01-7).
 */
import type { SectionState } from '@/lib/lab/view/shared';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';

export const READY: SectionState = { kind: 'ready', message: null, action: null };

export function state(kind: SectionState['kind'], message: string | null = null, action: SectionState['action'] = null): SectionState {
  return { kind, message, action };
}

export function errorState(err: unknown): SectionState {
  const msg = err instanceof Error ? err.message : String(err);
  return state('error', fill(LAB_COPY.frame.sectionError, { message: msg.slice(0, 200) }));
}

/** Test hook (AC-01-7): a section id listed here throws inside its builder. Never set outside tests. */
export const SECTION_FAULTS = new Set<string>();

/**
 * Run one section builder. On a throw: logs `[lab view]`, and returns `fallback(errorState)`.
 */
export function section<T>(page: string, id: string, build: () => T, fallback: (s: SectionState) => T): T {
  try {
    if (SECTION_FAULTS.has(`${page}.${id}`)) throw new Error(`injected fault in ${page}.${id}`);
    return build();
  } catch (err) {
    if (!SECTION_FAULTS.has(`${page}.${id}`)) console.error('[lab view]', page, id, err);
    return fallback(errorState(err));
  }
}

/** Keep `sample=1` on every link the Lab builds (01 2.1). */
export function withSample(href: string, sample: boolean): string {
  if (!sample) return href;
  if (/[?&]sample=1\b/.test(href)) return href;
  const [base, hash] = href.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}sample=1${hash !== undefined ? `#${hash}` : ''}`;
}
