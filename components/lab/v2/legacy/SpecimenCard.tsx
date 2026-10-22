'use client';
/**
 * The breakout specimen card under Bennett Legacy (pages/lab.md: "specimen cards radius 12, the post
 * frame, age-matched lift as a Chip"; numerals bold mono). The whole card opens the Post sheet. Reads
 * 01's PostCardView only.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip } from '@/components/legacy';
import type { PostCardView } from '@/lib/lab/view/breakouts';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { IntervalBar, Tag } from './parts';
import { Strand } from './viz';

export function SpecimenCard({ c, tag, i = 2 }: { c: PostCardView; tag?: ReactNode; i?: number }) {
  const judged = c.read.state === 'judged';
  const head = judged ? c.read.text : c.read.state === 'not_built' ? c.ladder.text ?? c.read.text : c.read.text;
  return (
    <article data-l="SlabCard" data-lab-card="specimen" className="l-rise l-rise-card l-card l-lab-specimen" style={{ ['--l-rise-i' as string]: i }}>
      <Link href={`?post=${c.postId}`} scroll={false} className="l-lab-specimen-link" data-lab-shared={`card-${c.postId}`} aria-label={`${c.hookText}, ${head}, n ${c.read.n}`}>
        <span className="l-lab-frame" data-l="PostFrame">
          <span className="l-lab-frame-top">
            <span className="l-micro">{c.formatLabel ?? c.platform}</span>
            {c.dualHigh && <span className="l-lab-frame-flag">{C.breakouts.dualChip}</span>}
          </span>
          <span className="l-lab-frame-hook">{c.hookText}</span>
          {c.strand && <Strand strand={c.strand} label={c.hookText} />}
        </span>
        <span className="l-lab-specimen-who">{c.creator.displayName}</span>
        <span className="l-lab-specimen-read">
          <span className="l-lab-specimen-num" data-dim={judged ? undefined : ''}>{head}</span>
          <Chip tone={judged && (c.read.ratio ?? 0) >= 1 ? 'ok' : undefined}>{judged ? `${c.read.atLabel ?? ''} · n ${c.read.n}` : `n ${c.read.n}`}</Chip>
        </span>
        <IntervalBar lo={c.confidenceBars.lo} hi={c.confidenceBars.hi} point={c.confidenceBars.point} scaleMax={c.confidenceBars.scaleMax} />
        <span className="l-chip-row l-lab-specimen-tags">
          {c.metrics.depthText && <span className="l-muted">{c.metrics.depthText}</span>}
          {c.exogenous && <Tag tone="quiet">{C.breakouts.outsideChip}</Tag>}
          {tag}
        </span>
      </Link>
    </article>
  );
}
