/**
 * The body of the /lab layout (01 1, 03.19): the `.lab` root that scopes the v2 tokens, the intro
 * script, the one Aurora, the glass budget and the live-run provider. The layout renders it once, so
 * the Aurora node and the run poller persist across the six pages (AC-03-29, 03.8). Both trees use it.
 */
import type { ReactNode } from 'react';
import { Aurora } from './Aurora';
import { GlassBudgetProvider } from './Glass';
import { LabAuroraIntro } from './LabAuroraIntro';
import { LabIntroScript } from './motion/LabIntroScript';
import { LabRunProvider } from './useLabRun';
import { LabStyleProvider } from './kitMark';

export function LabRoot({ children, legacy = false }: { children: ReactNode; legacy?: boolean }) {
  // Bennett Legacy (founderos-ui pages/lab.md): no Aurora (Monolith has no
  // glow), and the shared primitives carry data-l kit names instead of data-g.
  return (
    <LabStyleProvider legacy={legacy}>
      <div className="lab lab-v2" data-lab-root="" data-lab-style={legacy ? 'legacy' : undefined}>
        <LabIntroScript />
        {!legacy && <Aurora />}
        {!legacy && <LabAuroraIntro />}
        <GlassBudgetProvider>
          <LabRunProvider>{children}</LabRunProvider>
        </GlassBudgetProvider>
      </div>
    </LabStyleProvider>
  );
}
