'use client';
/**
 * A post as a card (01 9.2 PostCardView, also Ask's EvidenceCard and the grounding posts): hook first,
 * then who and where, then the honest headline number with its interval and n. The whole card is one
 * link to `?post=` (a sheet), so nothing inside it is interactive.
 */
import { Glass } from '@/components/lab/v2/shared';

import type { PostCardView } from '@/lib/lab/view/breakouts';
import type { SpecimenCard } from '@/lib/lab/view/shared';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const PLATFORM: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X' };

/** Four decimals, so server and client SVG attributes match exactly (hydration). */
const r2 = (v: number) => Math.round(v * 10000) / 10000;

/** Interval bar on a log scale from 0.3x to scaleMax (presentation of 04's lo, point, hi). */
function Interval({ lo, hi, point, max }: { lo: number | null; hi: number | null; point: number | null; max: number }) {
  if (point === null) return null;
  const min = 0.3;
  const top = Math.max(max, 3);
  const x = (v: number) => r2((Math.log(Math.min(top, Math.max(min, v))) - Math.log(min)) / (Math.log(top) - Math.log(min)));
  const one = x(1);
  return (
    <svg className="lab2g-interval" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" data-lab-mark="">
      <line x1="0" x2="100" y1="5" y2="5" className="lab2g-interval-track" vectorEffect="non-scaling-stroke" />
      <line x1={one * 100} x2={one * 100} y1="1" y2="9" className="lab2g-interval-one" vectorEffect="non-scaling-stroke" />
      {lo !== null && hi !== null && <line x1={x(lo) * 100} x2={x(hi) * 100} y1="5" y2="5" className="lab2g-interval-range" vectorEffect="non-scaling-stroke" />}
      <circle cx={x(point) * 100} cy="5" r="2.2" className="lab2g-interval-dot" />
    </svg>
  );
}

export function PostCard({ card, chip, sharedPrefix = 'card' }: { card: PostCardView | (SpecimenCard & Partial<PostCardView>); chip?: string; sharedPrefix?: string }) {
  const read = card.read;
  const headline = read ? read.text : card.ladder.text ?? '';
  const n = read ? read.n : card.ladder.n;
  const at = read?.atLabel ?? null;
  const bars = card.confidenceBars ?? { lo: card.ladder.lo, hi: card.ladder.hi, point: card.ladder.ratio, scaleMax: 10 };
  const label = `${card.hookText}, ${card.creator.displayName}, ${headline}${at ? ` ${at}` : ''}, n ${n}`;
  return (
    <Glass
      as="a"
      href={`?post=${card.postId}`}
      tone="strong"
      radius="tile"
      priority={3}
      className="lab2g-postcard"
      data-lab-shared={`${sharedPrefix}-${card.postId}`}
      data-sheet-title={LAB_UI.kindPost}
      aria-label={label}
    >
      <span className="lab2g-postcard-hook" data-lab-ink="">{card.hookText}</span>
      <span className="lab2g-postcard-who" data-lab-ink="">
        {card.creator.displayName} · {PLATFORM[card.platform] ?? card.platform}
        {card.formatLabel ? ` · ${card.formatLabel}` : ''}
      </span>
      <span className="lab2g-postcard-num">
        <span className="lab2g-postcard-ratio" data-lab-ink="">{headline}</span>
        <span className="lab2g-postcard-meta" data-lab-ink="">{[at, `n ${n}`, card.metrics.depthText].filter(Boolean).join(' · ')}</span>
      </span>
      <Interval lo={bars.lo} hi={bars.hi} point={bars.point} max={bars.scaleMax} />
      {/* Always rendered: a grid reserves its row even when empty (lab-g.css), elsewhere an empty row collapses. */}
      <span className="lab2g-postcard-chips">
        {card.dualHigh && <span className="lab2-chip"><span data-lab-ink="">{LAB_UI.dualHighChip}</span></span>}
        {card.exogenous && <span className="lab2-chip"><span data-lab-ink="">{LAB_UI.outsidePush}</span></span>}
        {chip && <span className="lab2-chip"><span data-lab-ink="">{chip}</span></span>}
      </span>
    </Glass>
  );
}
