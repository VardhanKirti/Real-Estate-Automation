'use client';

import { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import type { Campaign } from '@/lib/creative-engine/schemas';
import { renderMarkdown } from '@/lib/creative-engine/markdown';
import { GBigNumber, GCardRaised, GRuler } from '@/components/g';
import { Btn, Chip, useG } from '@/components/creative-engine/skin';
import { Drivers, Empty } from '@/components/creative-engine/skin-dash';
import { BriefStatusControl } from '@/components/creative-engine/EngineTimeline';
import type { BriefStatus } from '@/lib/creative-engine/timeline';

/** Briefings on paper: proof panel on the left, the rendered document on the right. */
export function Briefings({ campaign, initialBriefId, readOnly = false, onStatus, onScripter }: { campaign: Campaign | null; initialBriefId?: string; readOnly?: boolean; onStatus?: (briefId: string, status: BriefStatus) => void; onScripter?: () => void }) {
  const briefs = campaign?.briefs ?? [];
  // S07 F26: open on the brief that was clicked; an unknown id falls back to the newest.
  const [activeId, setActiveId] = useState<string | null>((initialBriefId && briefs.some((b) => b.id === initialBriefId) ? initialBriefId : null) ?? briefs.at(-1)?.id ?? null);
  const brief = briefs.find((b) => b.id === activeId) ?? briefs.at(-1) ?? null;
  const [copied, setCopied] = useState(false);
  const g = useG();
  const html = useMemo(() => (brief ? renderMarkdown(brief.markdown) : ''), [brief]);
  if (!brief) return <Empty line1="No briefs yet." line2="Approve a script in the Ad scripter and choose Make a brief. Each brief carries its proof table." action={onScripter ? { label: 'Open the Ad scripter', onClick: onScripter } : undefined} />;

  const copy = async () => {
    try { await navigator.clipboard.writeText(brief.markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  };
  const download = () => {
    const blob = new Blob([brief.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${brief.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {briefs.map((b) => (<Chip key={b.id} active={brief.id === b.id} onClick={() => setActiveId(b.id)}>{b.title.split(' — ')[0].slice(0, 34)}</Chip>))}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {onStatus && <BriefStatusControl status={brief.status} disabled={readOnly} disabledReason="Sample data: actions are off" onChange={(st) => onStatus(brief.id, st)} />}
          <Btn size="sm" onClick={copy}><Copy className="h-3.5 w-3.5" strokeWidth={1.8} /> {copied ? 'Copied' : 'Copy markdown'}</Btn>
          <Btn size="sm" onClick={download}><Download className="h-3.5 w-3.5" strokeWidth={1.8} /> Download</Btn>
        </span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          {g ? (
            // A readout card, not a hero: the page behind the sheet already holds its two (C22), and the
            // only glow in the kit is a GHeroCard's.
            <GCardRaised p={20}>
              <div className="text-[12.5px] text-[var(--g-muted)]">Median longevity of the proof set</div>
              <div className="mt-3"><GBigNumber value={brief.proof.medianDays ?? null} unit="days live" /></div>
              <div className="mt-4"><GRuler value={brief.proof.medianDays} max={90} ticks={30} label={brief.proof.medianDays === null ? 'No proof ads' : `Median ${brief.proof.medianDays} days live on a 0 to 90 day scale`} /></div>
            </GCardRaised>
          ) : (
            <div className="ae-hero ae-hero-green p-5">
              <div className="text-[12.5px] text-[var(--p-on-hero-dim)]">Median longevity of the proof set</div>
              <div className="mt-3 text-[40px] font-light leading-none">{brief.proof.medianDays ?? '—'}<span className="ml-2 text-[13px] text-[var(--p-on-hero-dim)]">days live</span></div>
              <div className="mt-4 ae-ruler">{Array.from({ length: 30 }, (_, i) => { const m = brief.proof.medianDays === null ? -1 : Math.round(Math.min(1, brief.proof.medianDays / 90) * 29); return <i key={i} className={i === m ? 'mark' : i % 5 === 0 ? 'tall' : ''} style={{ height: i === m ? 22 : i % 5 === 0 ? 14 : 8 }} />; })}</div>
            </div>
          )}
          <div className="ae-card-2 p-4"><div className="ae-cap mb-2">Driver fingerprint</div><Drivers drivers={brief.proof.drivers} top={3} /></div>
          {brief.proof.ads.map((a) => (
            <div key={a.id} className="ae-card-2 p-4">
              <div className="flex items-baseline justify-between gap-2"><span className="text-[13.5px]">{a.brand}</span><span className="ae-faint tabular-nums">{a.daysRunning} days · {a.live ? 'live' : 'paused'}{a.duplicates != null ? ` · ${a.duplicates} copies` : ''}</span></div>
              {a.hook && <div className="ae-cap mt-1">“{a.hook}”</div>}
            </div>
          ))}
          <p className="ae-faint leading-snug">{brief.proof.note}</p>
        </div>
        <article className="ae-card-2 ae-md p-7" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
