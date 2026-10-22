import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_OFF, normalizeOff } from '@/lib/modules';

/**
 * Server half of Settings → Modules (lib/modules.ts). The choice lives in
 * .glados-modules.json at the project root, next to .glados-mode and outside
 * both data directories, so it survives a filming switch. No file means the
 * fresh-install default. GLADOS_MODULES_FILE redirects it (tests).
 */
export const modulesFile = (): string => process.env.GLADOS_MODULES_FILE ?? path.join(process.cwd(), '.glados-modules.json');

export function getModulesOff(): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(modulesFile(), 'utf8');
  } catch {
    return [...DEFAULT_OFF];
  }
  try {
    const parsed = JSON.parse(raw) as { off?: unknown };
    return Array.isArray(parsed.off) ? normalizeOff(parsed.off) : [...DEFAULT_OFF];
  } catch {
    return [...DEFAULT_OFF];
  }
}

export function setModulesOff(off: readonly string[]): string[] {
  const clean = normalizeOff(off);
  fs.writeFileSync(modulesFile(), `${JSON.stringify({ off: clean }, null, 2)}\n`, 'utf8');
  return clean;
}
