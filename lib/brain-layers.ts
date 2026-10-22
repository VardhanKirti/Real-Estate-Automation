import type { BrainOverview, DoctorCheck, GBrainStats } from '@/lib/connectors/gbrain';
import { formatCompact } from '@/lib/format-number';

/**
 * The /brain "Storage layers" rows, built only from what the provider
 * reported (GladOS UI H33, S05 F05.16). Nothing here is a remembered number:
 * - the CLI version shows only when `engine doctor` reports one;
 * - Supabase page and chunk counts show only when `gbrain stats` answered;
 * - a layer with no check reads "Unknown", never "Live".
 */
export type StorageLayer = { name: string; sub: string; val: string; state: string };

/** Dot state for a value nobody measured: grey, not green and not amber. */
export const UNKNOWN_STATE = 'off';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function findCheck(checks: DoctorCheck[], re: RegExp): DoctorCheck | undefined {
  return checks.find((c) => re.test(c.name));
}

/** Supabase status: its doctor check when there is one, else whether `gbrain stats` reached the database. */
export function supabaseState(
  doctor: BrainOverview['doctor'],
  stats: GBrainStats | null,
): { val: 'Live' | 'Paused' | 'Unknown'; state: string } {
  const check = findCheck(doctor.checks, /supabase|database/i);
  if (check) return check.status === 'ok' ? { val: 'Live', state: 'connected' } : { val: 'Paused', state: 'available' };
  if (stats) return { val: 'Live', state: 'connected' };
  return { val: 'Unknown', state: UNKNOWN_STATE };
}

export function storageLayers({
  overview,
  stats,
  storeShort,
}: {
  overview: BrainOverview;
  stats: GBrainStats | null;
  storeShort: string;
}): StorageLayer[] {
  const { store, doctor } = overview;
  const version = doctor.version?.trim();
  const zero = findCheck(doctor.checks, /zero|embed/i);
  const supa = supabaseState(doctor, stats);
  const counts = stats
    ? `${formatCompact(stats.pages)} pages / ${formatCompact(stats.chunks)} chunks`
    : supa.val === 'Paused'
      ? 'counts unavailable while paused'
      : 'counts unavailable';

  return [
    {
      name: 'engine CLI',
      sub: `${version ? `${/^v/i.test(version) ? version : `v${version}`} · ` : ''}engine CLI · doctor --fast`,
      val: doctor.connected ? 'Live' : 'Unreachable',
      state: doctor.connected ? 'connected' : 'error',
    },
    {
      name: 'brain-store/',
      sub: `${storeShort} · markdown knowledge`,
      val: `${store.totalFiles} pages`,
      state: store.totalFiles > 0 ? 'connected' : 'available',
    },
    {
      name: 'ZeroEntropy',
      sub: 'hybrid-search embeddings · key in ~/.config/knowledge',
      val: zero ? (zero.status === 'ok' ? 'Live' : capitalise(zero.status)) : 'Unknown',
      state: zero ? (zero.status === 'ok' ? 'connected' : 'available') : UNKNOWN_STATE,
    },
    {
      name: 'Supabase Second Brain',
      sub: `${counts} · free tier idle-pause`,
      val: supa.val,
      state: supa.state,
    },
  ];
}
