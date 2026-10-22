'use client';
/**
 * Every GladOS Lab page: the frame, the page body in <main>, and the sheet host. The route rise plays on
 * client navigation between the six pages only (03.11), never on a hard load, so server HTML is at rest.
 * Rendered inside LabRoot by the /lab layout; when a page is rendered without it (a test, or before the
 * layout lands) the shell wraps itself so tokens, the Aurora and the run poller still exist.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { LabRoot } from '@/components/lab/v2/shared/LabRoot';
import { useHasLabRunProvider } from '@/components/lab/v2/shared/useLabRun';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import { LabCapHost, type OutsideScoreScript } from './Dialogs';
import { GEmptyCard, GFrame } from './Frame';
import { GSheetHost } from './sheets/SheetHost';
import './lab-g.css';

let labPagesMounted = 0;

function Inner({ frame, sheet, children, outsideScripts }: { frame: LabFrameView; sheet: SheetPayload | null; children: ReactNode; outsideScripts?: OutsideScoreScript[] }) {
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = page.current;
    labPagesMounted += 1;
    if (!el || labPagesMounted === 1) return;
    el.setAttribute('data-lab-enter', '');
    const done = () => el.removeAttribute('data-lab-enter');
    el.addEventListener('animationend', done, { once: true });
    const t = window.setTimeout(done, 600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <LabCapHost>
      <div ref={page} className="lab2-page lab2g-page" data-lab-page={frame.page}>
        <GFrame frame={frame} outsideScripts={outsideScripts} />
        <main id="lab-main" tabIndex={-1} className="lab2g-main">
          {frame.emptyCard ? <GEmptyCard frame={frame} /> : children}
        </main>
      </div>
      <GSheetHost initial={sheet} frame={frame} />
    </LabCapHost>
  );
}

export function GPageShell(props: { frame: LabFrameView; sheet: SheetPayload | null; children: ReactNode; outsideScripts?: OutsideScoreScript[] }) {
  const inRoot = useHasLabRunProvider();
  if (inRoot) return <Inner {...props} />;
  return (
    <LabRoot>
      <Inner {...props} />
    </LabRoot>
  );
}
