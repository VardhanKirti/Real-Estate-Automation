import { createApifyClient, type FetchLike } from '@/lib/lab/apify-client';
import { labFetch } from '@/lib/lab/net';

/**
 * The server's Apify client: every call goes through labFetch, so the dry guard (08.7.4) holds
 * for every request. apify-client.ts itself stays free of node imports (a v1 client component
 * reads its constants), so server code builds clients here, never with createApifyClient's
 * default fetch (tests/lab-net-guard.test.ts checks every call site).
 */
export function liveApifyClient(token: string) {
  return createApifyClient({ token, fetch: labFetch as unknown as FetchLike });
}
