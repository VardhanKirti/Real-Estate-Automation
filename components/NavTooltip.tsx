'use client';

/**
 * The sidebar's styled tooltip (SPEC S09 FR-14). One instance, owned by the
 * Sidebar: in the rail it names every icon (with its group on the first item
 * of each titled group, S12 §4.4); in a labelled sidebar it appears only for
 * a truncated label. The digit chip teaches the working 1–9 shortcut.
 *
 * aria-hidden: the link already carries its accessible name (the sr-only
 * label), so the tooltip is never read twice.
 */
export type NavTip = { group: string | null; label: string; digit: number | null; top: number };

export function NavTooltip({ tip }: { tip: NavTip | null }) {
  if (!tip) return null;
  return (
    <div role="tooltip" aria-hidden="true" className="os-nav-tip" style={{ top: tip.top }}>
      {tip.group && (
        <>
          <span className="os-nav-tip-group">{tip.group}</span>
          <span className="os-nav-tip-sep">·</span>
        </>
      )}
      <span className="os-nav-tip-label">{tip.label}</span>
      {tip.digit !== null && <kbd className="os-nav-tip-key">{tip.digit}</kbd>}
    </div>
  );
}
