/**
 * Ventures — the venture lens over the OS.
 *
 * One database, one brain, one agent roster: ventures never partition the
 * data. They are saved filters — each one names the agents that serve it per
 * life area, the brain tag that marks its pages, and the current executive
 * focus. Switching venture swaps which crew lights up.
 *
 * A fresh install ships no ventures: they live in ventures.json in the data
 * directory (lib/ventures-store.ts reads it), one entry per business you run.
 */
import type { LifeArea } from '@/lib/life-map';
import { LIFE_AREAS } from '@/lib/life-map';

export type Venture = {
  id: string;
  label: string;
  kind: string;
  color: string;
  detail: string;
  /** Tag that marks this venture's pages inside the single shared Optimal Engine. */
  brainTag: string;
  /** Current executive priorities — edit freely. */
  focus: string[];
  /** life-area id → the agents working that area FOR this venture. */
  areaAgents: Record<string, string[]>;
};

/** The venture with this id in a list, or null. */
export function findVenture(list: Venture[], id: string): Venture | null {
  return list.find((v) => v.id === id) ?? null;
}

/** Every agent serving a venture, across all its life areas. */
export function agentsOfVenture(v: Venture | null): Set<string> {
  return new Set(v ? Object.values(v.areaAgents).flat() : []);
}

export function lifeAreaById(areaId: string): LifeArea | null {
  return LIFE_AREAS.find((a) => a.id === areaId) ?? null;
}
