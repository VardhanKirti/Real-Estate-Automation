import { isDry } from '@/lib/lab/dry';

/**
 * The dry network guard (08.7.4). `labFetch` is the only fetch the Lab's connectors, Radar
 * sources and OAuth helpers may use. In dry it throws DryNetworkError for any host other than
 * localhost, 127.0.0.1 or ::1. Dry branches never reach it; the guard proves they don't.
 * S0 wrote it from the spec text; lane S owns it (and the lint test that no lib/lab or
 * app/api/lab file calls global fetch directly, AC-08-17).
 */
export class DryNetworkError extends Error {
  constructor(public host: string) {
    super(`Dry run: no network call to ${host}.`);
    this.name = 'DryNetworkError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Overridable in tests (a spy that records calls). */
let impl: FetchFn = (url, init) => fetch(url, init);
export function setLabFetchImpl(fn: FetchFn | null): void {
  impl = fn ?? ((url, init) => fetch(url, init));
}

export async function labFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  if (isDry()) {
    const host = new URL(String(url)).hostname;
    if (!LOCAL_HOSTS.has(host)) throw new DryNetworkError(host);
  }
  return impl(url, init);
}
