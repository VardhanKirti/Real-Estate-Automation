import { BRAND } from '@/lib/brand';
import { filmingMode } from '@/lib/paths';
import { isDry } from '@/lib/lab/dry';

/**
 * The private instance (08.5.5): GladOS brand, not Filming, not dry, a data dir that is not the
 * demo instance's. Only here does the LaunchAgent install and checklist step 10 count.
 * S0 wrote it from the spec text; lane S owns it.
 */
export function isPrivateInstance(env: Record<string, string | undefined> = process.env): boolean {
  return BRAND.id === 'glados'
    && !filmingMode()
    && !isDry()
    && Boolean(env.GLADOS_DATA_DIR)
    && !/(^|\/)demo-data(\/|$)/.test(env.GLADOS_DATA_DIR!);
}
