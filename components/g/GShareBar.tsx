import { colorVar, slotColor, type VizColor } from './viz-shared';

export type GShareSegment = { id: string; label: string; value: number; title?: string; color?: VizColor };

export type GShareBarProps = {
  segments: readonly GShareSegment[];
  /** summary: "Revenue share · 90d" */
  label: string;
  onHero?: boolean;
  className?: string;
};

/** On-hero ink steps (GP3): the n-th segment takes the n-th step. */
const HERO_STEPS = [1, 0.7, 0.45, 0.25];

/**
 * GShareBar (GP3): one 6px pill split into proportional segments with 2px
 * gaps. On a card, segments take series colours in order; on a hero, ink
 * steps of `--g-on-hero`. Each segment has its own title. One segment fills
 * the bar; nothing positive draws the empty track.
 */
export function GShareBar({ segments, label, onHero = false, className = '' }: GShareBarProps) {
  const vis = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = vis.reduce((a, s) => a + s.value, 0);
  const summary = total > 0 ? `${label}: ${vis.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}` : `${label} · no data`;
  return (
    <div data-g="GShareBar" role="img" aria-label={summary} className={`g-share ${className}`} data-on-hero={onHero || undefined} title={total > 0 ? undefined : summary}>
      {vis.map((s, i) => {
        const pct = (s.value / total) * 100;
        const bg = onHero ? `color-mix(in srgb, var(--g-on-hero) ${Math.round(HERO_STEPS[Math.min(i, HERO_STEPS.length - 1)] * 100)}%, transparent)` : colorVar(s.color ?? slotColor(i));
        return <i key={s.id} title={s.title ?? `${s.label}: ${Math.round(pct)}%`} style={{ flexGrow: s.value, flexBasis: 0, background: bg }} />;
      })}
    </div>
  );
}
