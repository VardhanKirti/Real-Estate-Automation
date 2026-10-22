'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { GButton } from './Controls';
import { GEmpty } from './States';

export type GDiffProps = {
  removed: readonly string[];
  added: readonly string[];
  /** the file the diff is for, shown as a caption */
  file?: string;
  /** what Copy puts on the clipboard; default the added lines */
  copyText?: string;
  className?: string;
};

/**
 * GDiff (GP3, S05 Drift): removed then added lines, 13px mono (allowed:
 * `data-mono-ok`, C24), `--g-diff-*` fills, the file as a caption and a Copy
 * button that copies the added text. Copy says when the clipboard refuses.
 */
export function GDiff({ removed, added, file, copyText, className = '' }: GDiffProps) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const text = copyText ?? added.join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 1600);
  };
  const empty = removed.length === 0 && added.length === 0;
  return (
    <figure data-g="GDiff" className={`g-diff ${className}`}>
      <figcaption className="g-diff-head">
        {file ? <span className="g-diff-file" data-mono-ok="">{file}</span> : <span />}
        <GButton variant="sm" className="g-viz-act" onClick={copy} disabled={!text} title={text ? 'Copy the added lines' : undefined} disabledReason="Nothing to copy">
          {copied === 'ok' ? <Check size={13} strokeWidth={1.8} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.8} aria-hidden="true" />}
          {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy blocked' : 'Copy'}
        </GButton>
      </figcaption>
      {empty ? (
        <GEmpty inline title="No changes." />
      ) : (
        <pre className="g-diff-body" data-mono-ok="">
          {removed.map((l, i) => <div key={`d${i}`} className="g-diff-line" data-kind="del"><span aria-hidden="true">-</span><span className="sr-only">Removed: </span>{l}</div>)}
          {added.map((l, i) => <div key={`a${i}`} className="g-diff-line" data-kind="add"><span aria-hidden="true">+</span><span className="sr-only">Added: </span>{l}</div>)}
        </pre>
      )}
    </figure>
  );
}
