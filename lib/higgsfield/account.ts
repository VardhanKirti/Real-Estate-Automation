import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { dataPath } from '@/lib/paths';

/**
 * The synced Higgsfield account snapshot — credits, trained Soul characters,
 * and saved reference Elements. Written by the operator from real MCP calls
 * (balance, show_characters, show_reference_elements); read at request time
 * so a re-sync shows up without a rebuild. Server-only (node:fs) — pages
 * pass the parsed snapshot to client components as props.
 */

export const IdentityAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['soul', 'element']),
  type: z.string().optional(),
  category: z.string().optional(),
  status: z.string().min(1),
  portrait: z.string().min(1),
});
export type IdentityAsset = z.infer<typeof IdentityAssetSchema>;

export const HiggsfieldAccountSchema = z.object({
  syncedAt: z.string().min(1),
  plan: z.string().min(1),
  credits: z.number().nonnegative(),
  creditsResetAt: z.string().nullable(),
  creditsRollOver: z.boolean(),
  characters: z.array(IdentityAssetSchema),
  elements: z.array(IdentityAssetSchema),
  voices: z.array(z.object({ id: z.string(), name: z.string() })).nullable(),
});
export type HiggsfieldAccount = z.infer<typeof HiggsfieldAccountSchema>;

export function accountStorePath(): string {
  return process.env.HIGGSFIELD_ACCOUNT_PATH ?? dataPath('higgsfield', 'account.json');
}

/**
 * A missing or malformed snapshot is an unsynced account, never a crash —
 * callers render a not-configured state.
 */
export function readHiggsfieldAccount(file: string = accountStorePath()): HiggsfieldAccount | null {
  try {
    return HiggsfieldAccountSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** All identity assets (Souls first — they are the trained, strongest form). */
export function identityAssets(account: HiggsfieldAccount): IdentityAsset[] {
  return [...account.characters, ...account.elements];
}
