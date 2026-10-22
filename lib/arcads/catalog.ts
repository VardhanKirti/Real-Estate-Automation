import { createArcadsClient, type ArcadsProduct, type ArcadsSituation, type ArcadsVoice } from '@/lib/arcads/client';
import { readCache, writeCache } from '@/lib/creative-engine/store';
import { dryLabel, isDry } from '@/lib/creative-engine/dry';

/**
 * Actor/voice/product catalog, grouped the way the standalone app learned to
 * (situations → actors, because only situations carry thumbnails), cached
 * for 10 minutes so filters never refetch the whole list.
 */

export type CatalogActor = {
  id: string;
  name: string;
  gender: string;
  age: string;
  imageUrl: string;
  situations: { id: string; tags: string[]; emotions: string[]; cameraAngle: string | null; imageUrl: string; previewUrl: string; defaultVoiceId: string | null }[];
};

export type Catalog = {
  state: 'connected' | 'not_configured' | 'error' | 'dry';
  detail: string;
  actors: CatalogActor[];
  voices: ArcadsVoice[];
  products: ArcadsProduct[];
  fetchedAt: string | null;
};

const TTL = 10 * 60_000;

export function groupActors(situations: ArcadsSituation[]): CatalogActor[] {
  const map = new Map<string, CatalogActor>();
  for (const sit of situations) {
    const actor = sit.actor;
    if (!actor?.id) continue;
    if (sit.talkingActorEnabled === false) continue;
    if (!map.has(actor.id)) map.set(actor.id, { id: actor.id, name: actor.name ?? 'Actor', gender: (actor.gender ?? '').toLowerCase(), age: (actor.age ?? '').toLowerCase(), imageUrl: actor.imageUrl || sit.imageUrl || '', situations: [] });
    map.get(actor.id)!.situations.push({ id: sit.id, tags: sit.tags ?? [], emotions: sit.emotions ?? [], cameraAngle: sit.cameraAngle ?? null, imageUrl: sit.imageUrl ?? '', previewUrl: sit.previewUrl ?? '', defaultVoiceId: sit.defaultVoiceId ?? null });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const DRY_CATALOG: Pick<Catalog, 'actors' | 'voices' | 'products'> = {
  actors: [
    { id: 'dry-actor-1', name: 'Mara', gender: 'female', age: '25-34', imageUrl: '', situations: [{ id: 'dry-sit-1', tags: ['kitchen', 'daylight'], emotions: ['warm'], cameraAngle: 'front', imageUrl: '', previewUrl: '', defaultVoiceId: 'dry-voice-1' }, { id: 'dry-sit-2', tags: ['car'], emotions: [], cameraAngle: 'close_up', imageUrl: '', previewUrl: '', defaultVoiceId: null }] },
    { id: 'dry-actor-2', name: 'Theo', gender: 'male', age: '25-34', imageUrl: '', situations: [{ id: 'dry-sit-3', tags: ['office'], emotions: ['calm'], cameraAngle: 'front', imageUrl: '', previewUrl: '', defaultVoiceId: 'dry-voice-2' }] },
  ],
  voices: [
    { id: 'dry-voice-1', name: 'Mara (natural)', gender: 'female', age: 'young adult', accent: 'american', descriptive: 'warm, conversational', audioUrl: '' },
    { id: 'dry-voice-2', name: 'Theo (calm)', gender: 'male', age: 'young adult', accent: 'american', descriptive: 'calm, direct', audioUrl: '' },
  ],
  products: [{ id: 'dry-product-1', name: 'Dry run product', description: 'CREATIVE_ENGINE_DRY fixture' }],
};

export async function readCatalog(force = false): Promise<Catalog> {
  if (isDry()) return { state: 'dry', detail: dryLabel(), ...DRY_CATALOG, fetchedAt: new Date().toISOString() };
  const client = createArcadsClient();
  if (!client) return { state: 'not_configured', detail: 'ARCADS_BASIC_AUTH not set', actors: [], voices: [], products: [], fetchedAt: null };
  if (!force) {
    const cached = readCache<Catalog>('arcads-catalog', TTL);
    if (cached) return cached;
  }
  try {
    const [situations, voices, products] = await Promise.all([client.situations(), client.voices(), client.products()]);
    const value: Catalog = { state: 'connected', detail: `${situations.length} situations · ${voices.length} voices · ${products.length} products`, actors: groupActors(situations), voices, products, fetchedAt: new Date().toISOString() };
    writeCache('arcads-catalog', value);
    return value;
  } catch (err) {
    return { state: 'error', detail: err instanceof Error ? err.message : String(err), actors: [], voices: [], products: [], fetchedAt: null };
  }
}

/**
 * The document's SituationDto has no default voice but the live object
 * does (`defaultVoiceId`); use it first. Otherwise match by the actor's
 * gender and age bracket (EmbeddedActorDto uses
 * "Female"/"Male" and "Young Adult"/"Adult"/"Senior"; VoiceDto's are free
 * text), else the first voice. Null only when the workspace has no voices.
 */
export function matchVoice(catalog: Pick<Catalog, 'actors' | 'voices'>, situationId: string): ArcadsVoice | null {
  const actor = catalog.actors.find((a) => a.situations.some((s) => s.id === situationId));
  const voices = catalog.voices;
  if (!voices.length) return null;
  const sit = actor?.situations.find((s) => s.id === situationId);
  if (sit?.defaultVoiceId) return voices.find((v) => v.id === sit.defaultVoiceId) ?? { id: sit.defaultVoiceId, name: 'situation default', gender: null, age: null, accent: '', descriptive: '', audioUrl: '' };
  if (!actor) return voices[0];
  const g = actor.gender.toLowerCase();
  const age = actor.age.toLowerCase();
  const byGender = voices.filter((v) => (v.gender ?? '').toLowerCase().startsWith(g.slice(0, 1)) && g);
  const byAge = byGender.filter((v) => age && (v.age ?? '').toLowerCase().includes(age.split(' ')[0]));
  return byAge[0] ?? byGender[0] ?? voices[0];
}
