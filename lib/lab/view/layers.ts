/**
 * Layer states (01 5.3). Each build lane flips its own flag in the same commit that makes the
 * layer real (04: measure; 05: radar; 06: ledger, retention; 07: gen, ask, comments).
 * S0 created the file with every flag false; lane V owns it.
 */
import type { LayerId, LayerState } from '@/lib/lab/view/shared';

export const LAB_LAYERS_BUILT: Record<LayerId, boolean> = {
  measure: true,
  radar: true,
  ledger: true, // lane L (06), merged; flipped by V at integration of the page models
  gen: true, // lane G (07)
  ask: true, // lane G (07)
  retention: true, // lane L (06): needs_key until YouTube or Instagram is connected
  comments: true, // lane G (07): built; 'off' until LAB_COMMENTS and a cap above $0
};

/** Test hook (AC-01-8): replaces LAB_LAYERS_BUILT for every builder while set. Never set outside tests. */
export const LAYERS_TEST_OVERRIDE: { built: Record<LayerId, boolean> | null } = { built: null };

/**
 * !built -> 'not_built'; retention built but neither OAuth connected -> 'needs_key';
 * comments built but not enabled (section 08 flag and cap) -> 'off'; else 'live'.
 */
export function layerStates(env: { youtubeOAuth: boolean; instagramOAuth: boolean; commentsEnabled: boolean }, built: Record<LayerId, boolean> = LAYERS_TEST_OVERRIDE.built ?? LAB_LAYERS_BUILT): Record<LayerId, LayerState> {
  const out = {} as Record<LayerId, LayerState>;
  for (const id of Object.keys(built) as LayerId[]) {
    if (!built[id]) out[id] = 'not_built';
    else if (id === 'retention' && !env.youtubeOAuth && !env.instagramOAuth) out[id] = 'needs_key';
    else if (id === 'comments' && !env.commentsEnabled) out[id] = 'off';
    else out[id] = 'live';
  }
  return out;
}
