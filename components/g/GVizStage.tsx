'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { pushEscape } from '@/lib/escape-stack';
import { GButton } from './Controls';
import { VizStateBody, type VizStateProps } from './viz-shared';

export type GVizStageProps = VizStateProps & {
  /** inline height (px or CSS length); full screen fills the viewport */
  height: number | string;
  /** title plus caption */
  hudTopLeft?: ReactNode;
  /** a GStat; the Full screen button is appended after it */
  hudTopRight?: ReactNode;
  /** a GLegend rail */
  hudLeft?: ReactNode;
  /** a GAsk / dock */
  bottomCenter?: ReactNode;
  /** controlled full screen; uncontrolled when omitted */
  fullscreen?: boolean;
  onFullscreenChange?: (on: boolean) => void;
  /** false hides the Full screen button */
  allowFullscreen?: boolean;
  /** what the visualisation is (region label) */
  label: string;
  children?: ReactNode;
  className?: string;
};

/**
 * GVizStage (GP3, S05 §5.2): a card on `--g-viz-stage` hosting a radial,
 * graph or network, with four HUD slots on `--g-viz-hud`. Inline it never
 * captures the wheel (the page keeps scrolling); full screen moves it to a
 * fixed layer that owns the wheel, and Escape exits through the app's escape
 * stack. Loading and empty states sit at the stage's final height.
 */
export function GVizStage({
  height, hudTopLeft, hudTopRight, hudLeft, bottomCenter, fullscreen, onFullscreenChange, allowFullscreen = true, label, children, className = '', ...stateProps
}: GVizStageProps) {
  const [own, setOwn] = useState(false);
  const on = fullscreen ?? own;
  const btn = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const set = (v: boolean) => {
    if (fullscreen === undefined) setOwn(v);
    onFullscreenChange?.(v);
  };
  const setLatest = useRef(set);
  setLatest.current = set;
  useEffect(() => {
    if (!on) return;
    const pop = pushEscape(() => setLatest.current(false), { id: 'g-viz-stage' });
    const el = btn.current;
    return () => { pop(); el?.focus(); };
  }, [on]);
  const h = typeof height === 'number' ? `${height}px` : height;
  const body = stateProps.state && stateProps.state !== 'ready' ? VizStateBody({ ...stateProps, height: typeof height === 'number' ? height : 320 }) : null;
  return (
    <section
      data-g="GVizStage"
      aria-label={label}
      className={`g-vizstage ${className}`}
      data-fullscreen={on || undefined}
      role={on ? 'dialog' : undefined}
      aria-modal={on || undefined}
      style={{ height: on ? undefined : h }}
    >
      <div className="g-vizstage-canvas">{body ?? children}</div>
      {hudTopLeft && <div className="g-vizstage-hud" data-slot="top-left">{hudTopLeft}</div>}
      {(hudTopRight || allowFullscreen) && (
        <div className="g-vizstage-hud" data-slot="top-right">
          {hudTopRight}
          {allowFullscreen && (
            <GButton ref={btn} variant="sm" className="g-viz-act" aria-pressed={on} onClick={() => set(!on)} title={on ? 'Exit full screen (Esc)' : 'Full screen'}>
              {on ? <Minimize2 size={13} strokeWidth={1.8} aria-hidden="true" /> : <Maximize2 size={13} strokeWidth={1.8} aria-hidden="true" />}
              {on ? 'Exit' : 'Full screen'}
            </GButton>
          )}
        </div>
      )}
      {hudLeft && <div className="g-vizstage-hud" data-slot="left">{hudLeft}</div>}
      {bottomCenter && <div className="g-vizstage-hud" data-slot="bottom">{bottomCenter}</div>}
    </section>
  );
}
