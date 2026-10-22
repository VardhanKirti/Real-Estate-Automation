/**
 * Key rows for Setup > Keys (08.2.2). A raw value never leaves the server: a row carries only
 * `present` and `maskSecret(value)`. State comes from env presence and the cached health results;
 * building a row makes no network call.
 */
import { CRED_FILES, readEnvLocal, resolveCred } from '@/lib/creds';
import { maskSecret } from '@/lib/keys';
import type { LabStore } from '@/lib/lab/store';
import type { LabHealthResult } from '@/lib/lab/setup/health';
import { LAB_KEYS, type LabKeyRow, type LabKeySpec, type LabKeyState } from '@/lib/lab/setup/keys';

const cred = (name: string) => resolveCred(name, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
/** Fields an operator does not have to fill for a row to count as configured. */
const OPTIONAL = new Set(['LAB_YT_REDIRECT_URI', 'LAB_IG_REDIRECT_URI']);

export function keyRow(spec: LabKeySpec, ctx: { health: LabHealthResult[]; dry: boolean; store: LabStore; now?: Date }): LabKeyRow {
  const fields = spec.fields.map((f) => {
    const v = cred(f.env) ?? '';
    return { env: f.env, label: f.label, present: v.length > 0, masked: f.secret ? maskSecret(v) : v ? maskSecret(v) : '', writtenBy: f.writtenBy };
  });
  const has = (env: string) => fields.find((f) => f.env === env)?.present ?? false;
  const health = spec.health.map((id) => ctx.health.find((h) => h.id === id)).filter((h): h is LabHealthResult => Boolean(h));
  const base = { id: spec.id, title: spec.title, required: spec.required, fields, unlocks: spec.unlocks };
  const row = (state: LabKeyState, detail: string | null, action: LabKeyRow['action'], checkedAt: string | null = null): LabKeyRow => ({ ...base, state, detail, checkedAt, action });
  const checkedAt = health.map((h) => h.checkedAt).sort().pop() ?? null;
  const failing = health.find((h) => h.state === 'fail');
  const warn = health.find((h) => h.state === 'warn');

  if (ctx.dry) return row('dry', 'Dry: not checked', { kind: 'none', label: '' });

  switch (spec.id) {
    case 'xwatch': {
      const n = ctx.store.sources.all('watch').filter((s) => s.status === 'active').length;
      if (!n) return row('not_configured', 'Add accounts to the X watch list.', { kind: 'manage_sources', label: 'Set up' });
      if (failing) return row('error', failing.detail, { kind: 'manage_sources', label: 'Check again' }, checkedAt);
      return row('connected', `${n} account${n === 1 ? '' : 's'} on the watch list.`, { kind: 'manage_sources', label: 'Manage' }, checkedAt);
    }
    case 'claude_cli':
      return failing ? row('error', failing.detail, { kind: 'none', label: 'Check again' }, checkedAt) : row('connected', health[0]?.detail ?? null, { kind: 'none', label: '' }, checkedAt);
    case 'youtube': {
      if (!has('LAB_YT_CLIENT_ID') || !has('LAB_YT_CLIENT_SECRET')) return row('not_configured', null, { kind: 'paste', label: 'Set up' });
      if (!has('LAB_YT_REFRESH_TOKEN')) return row('needs_connect', 'In Google Cloud, set the OAuth consent screen to In production, or this connection stops after 7 days.', { kind: 'connect', label: 'Connect YouTube' });
      break;
    }
    case 'instagram': {
      const token = has('LAB_IG_ACCESS_TOKEN');
      if (!token && (!has('LAB_IG_APP_ID') || !has('LAB_IG_APP_SECRET'))) return row('not_configured', null, { kind: 'paste', label: 'Set up' });
      if (!token) return row('needs_connect', null, { kind: 'connect', label: 'Connect Instagram' });
      if (warn && /^Expires in/.test(warn.detail)) {
        const days = Number(/(\d+)/.exec(warn.detail)?.[1] ?? 0);
        return row('expiring', `Expires in ${days} days`, { kind: 'reconnect', label: 'Reconnect' }, checkedAt);
      }
      break;
    }
    default: {
      const operator = spec.fields.filter((f) => f.writtenBy === 'operator' && !OPTIONAL.has(f.env));
      if (operator.some((f) => !has(f.env))) return row('not_configured', null, { kind: 'paste', label: 'Set up' });
    }
  }
  if (failing) return row('error', failing.detail, { kind: spec.id === 'youtube' || spec.id === 'instagram' ? 'reconnect' : 'paste', label: 'Check again' }, checkedAt);
  if (health.length && health.every((h) => h.state === 'ok')) {
    return row('connected', health.map((h) => h.detail).find(Boolean) ?? null, { kind: spec.id === 'youtube' || spec.id === 'instagram' ? 'disconnect' : 'paste', label: spec.id === 'youtube' || spec.id === 'instagram' ? 'Disconnect' : 'Replace key' }, checkedAt);
  }
  // present but not checked yet (or a warning): the client runs Check again
  return row('checking', warn?.detail ?? 'Not checked yet.', { kind: 'paste', label: 'Check again' }, checkedAt);
}

/** Every LAB_KEYS row, in registry order. */
export function keyRows(store: LabStore, ctx: { health: LabHealthResult[]; dry: boolean; now?: Date }): LabKeyRow[] {
  return LAB_KEYS.map((spec) => keyRow(spec, { ...ctx, store }));
}

/** Env values for status lines (never sent to a client). */
export const envSnapshot = () => ({ ...process.env, ...readEnvLocal() });
