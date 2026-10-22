'use client';
/**
 * NarrativeCard (02 section 7): one sentence in large type on a mesh gradient. Two per page at most
 * (Brief, Window). The mesh is the ::before layer (drift, 03.6.1), the text beds the ::after layer.
 */
import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { useInViewPause } from './motion/useInViewPause';
import { stepWindowT } from './tokens';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type NarrativeKind = 'brief' | 'window';
export type NarrativeState = 'ready' | 'thin' | 'none' | 'not-configured' | 'loading' | 'sample';
export type NarrativeCardProps = {
  kind: NarrativeKind;
  label: string;
  sentence: string | null;
  /** n as 01's nText printed it ('n 24'). */
  nText?: string;
  meta?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  href?: string;
  /** Accessible name of the whole-card link. */
  hrefLabel?: string;
  sharedId?: string;
  windowT?: number;
  state: NarrativeState;
  setupHref?: string;
  /** Pause the drift (a sheet is open). */
  paused?: boolean;
  /** A graph in place of the sentence (Today's hero cards). The sentence then shrinks to the one-line caption. */
  visual?: ReactNode;
  /** With `visual`: the caption's lead word ("Brief", "Window"); the caption text is `sentence`, linked by `href`. */
  captionTag?: string;
};

/** Component default copy (02 section 7.2). Section 01 may pass its own sentence. */
export const NARRATIVE_COPY = {
  briefThin: 'Not enough data yet.',
  briefThinMeta: 'The Brief needs n 8 or more.',
  windowNone: 'No open windows.',
  notConfigured: 'Not configured',
} as const;

/** Over this many characters the sentence may take a sixth line, so a long launch name still reads whole instead of ending in an ellipsis. */
const NARRATIVE_LONG = 64;

export function NarrativeCard(p: NarrativeCardProps) {
  const km = useKitMark();
  const ref = useRef<HTMLElement>(null);
  useInViewPause(ref, !!p.paused);
  const t = p.kind === 'window' ? (p.state === 'none' || p.state === 'not-configured' ? 1 : stepWindowT(p.windowT)) : undefined;

  let sentence: string | null = p.sentence;
  let meta = p.meta;
  if (p.state === 'thin' && p.kind === 'brief') {
    sentence = p.sentence ?? NARRATIVE_COPY.briefThin;
    meta = p.meta ?? NARRATIVE_COPY.briefThinMeta;
  } else if (p.state === 'none') {
    sentence = p.sentence ?? NARRATIVE_COPY.windowNone;
  } else if (p.state === 'not-configured') {
    sentence = NARRATIVE_COPY.notConfigured;
  } else if (p.state === 'loading') {
    sentence = null;
  }
  const showAction = !!p.action && (p.state === 'ready' || p.state === 'sample');
  const showN = !!p.nText && (p.state === 'ready' || p.state === 'sample');
  const linked = !!p.href && p.state !== 'not-configured' && p.state !== 'loading';

  if (p.visual) {
    const text = sentence ?? '';
    return (
      <article
        ref={ref}
        className="lab2-narr"
        data-kind={p.kind}
        data-state={p.state}
        data-visual=""
        data-has-action={showAction ? '' : undefined}
        data-lab="NarrativeCard"
        {...km('LabNarrative')}
        style={t !== undefined ? ({ ['--lab-window-t' as string]: String(t) } as React.CSSProperties) : undefined}
      >
        <div className="lab2-narr-body lab2-narr-vbody" data-lab-shared={p.sharedId}>
          <span className="lab2-narr-label" data-lab-ink="">{p.label}</span>
          <div className="lab2-narr-visual">{p.visual}</div>
          {(text || showAction || p.state === 'not-configured') && (
            <div className="lab2-narr-caprow">
              {text ? (
                <span className="lab2-narr-cap" data-lab-ink="" title={meta ? `${text} ${meta}` : text}>
                  {p.captionTag && <span className="lab2-narr-captag">{p.captionTag}</span>}
                  {linked ? (
                    <Link data-g="LabLink" href={p.href as string} scroll={false} className="lab2-narr-caplink" aria-label={p.hrefLabel ? `${p.hrefLabel}: ${text}` : undefined}>{text}</Link>
                  ) : (
                    <span className="lab2-narr-captext">{text}</span>
                  )}
                </span>
              ) : <span />}
              {p.state === 'not-configured' && <SetupLink href={p.setupHref ?? '?setup=keys'} label="Set up" className="lab2-setup" />}
              {showAction && p.action && (p.action.href ? (
                <Link data-g="LabLink" href={p.action.href} scroll={false} className="lab2-narr-action" data-lab-ink="">{p.action.label}</Link>
              ) : (
                <button data-g="LabButton" type="button" className="lab2-narr-action" onClick={p.action.onClick} data-lab-ink="">{p.action.label}</button>
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  const body = (
    <>
      <span className="lab2-narr-label" data-lab-ink="">{p.label}</span>
      <span className="lab2-narr-spacer" />
      {p.state === 'loading' ? (
        <span className="lab2-narr-skel" aria-hidden="true">
          <span className="lab2-skel" style={{ width: '70%' }} />
          <span className="lab2-skel" style={{ width: '85%' }} />
          <span className="lab2-skel" style={{ width: '55%' }} />
        </span>
      ) : (
        <span className="lab2-narr-sentence" data-lab-ink="" data-long={sentence && sentence.length > NARRATIVE_LONG ? '' : undefined}>{sentence}</span>
      )}
      {(showN || meta) && (
        <span className="lab2-narr-meta" data-lab-ink="">
          {showN && <span>{p.nText}</span>}
          {meta && <span>{meta}</span>}
        </span>
      )}
    </>
  );

  return (
    <article
      ref={ref}
      className="lab2-narr"
      data-kind={p.kind}
      data-state={p.state}
      data-has-action={showAction ? '' : undefined}
      data-lab="NarrativeCard"
      {...km('LabNarrative')}
      style={t !== undefined ? ({ ['--lab-window-t' as string]: String(t) } as React.CSSProperties) : undefined}
    >
      {linked ? (
        <Link href={p.href as string} scroll={false} className="lab2-narr-body lab2-narr-link" aria-label={p.hrefLabel} data-lab-shared={p.sharedId}>
          {body}
        </Link>
      ) : (
        <div className="lab2-narr-body" data-lab-shared={p.sharedId}>{body}</div>
      )}
      {p.state === 'not-configured' && (
        <span className="lab2-narr-foot">
          <SetupLink href={p.setupHref ?? '?setup=keys'} label="Set up" className="lab2-setup" />
        </span>
      )}
      {showAction && p.action && (
        <span className="lab2-narr-foot">
          {p.action.href ? (
            <Link href={p.action.href} scroll={false} className="lab2-narr-action" data-lab-ink="">{p.action.label}</Link>
          ) : (
            <button type="button" className="lab2-narr-action" onClick={p.action.onClick} data-lab-ink="">{p.action.label}</button>
          )}
        </span>
      )}
    </article>
  );
}
