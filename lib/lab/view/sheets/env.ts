/**
 * What every sheet builder needs besides the store: layer states, the read-only reason, mode flags
 * and the env the spend and feature flags are read from. Built once per request (lib/lab/view/build.ts).
 */
import type { LayerId, LayerState } from '@/lib/lab/view/shared';

export type LabLayerEnv = {
  layers: Record<LayerId, LayerState>;
  /** LAB_COPY.readOnly in sample, else null */
  readOnly: string | null;
  sample: boolean;
  dry: boolean;
  filming: boolean;
  dryLabel: string | null;
  env: Record<string, string | undefined>;
};
