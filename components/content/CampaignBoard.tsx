import { Calendar, Check, ChevronDown, Lock, Minus } from 'lucide-react';
import { CAMPAIGN_STAGES, type Campaign } from '@/lib/content-campaigns';

/** Compact horizontal brief → posted strip; the current stage reads mint. */
function StageStrip({ stage }: { stage: Campaign['stage'] }) {
  const current = CAMPAIGN_STAGES.indexOf(stage);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {CAMPAIGN_STAGES.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-3 bg-[var(--hairline)]" />}
          <span
            className={`text-[11px] ${
              i === current
                ? 'font-medium text-os-accent'
                : i < current
                  ? 'text-os-muted'
                  : 'text-os-dim'
            }`}
          >
            {s}
          </span>
        </span>
      ))}
    </div>
  );
}

function Chip({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={`glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] text-os-muted ${mono ? 'font-mono text-[11px]' : ''}`}
    >
      {children}
    </span>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const r = campaign.requirements;
  return (
    <div className="glass-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[14.5px] font-medium text-os-text">{campaign.name}</span>
            {campaign.confidential && (
              <span className="inline-flex items-center gap-1 text-[11px] text-os-warn">
                <Lock className="h-3 w-3" strokeWidth={1.8} /> confidential
              </span>
            )}
          </div>
          <div className="mt-1 text-[12.5px] text-os-muted">
            {campaign.sponsor} · {campaign.deliverable}
            {campaign.product && <span className="text-os-dim"> · {campaign.product}</span>}
          </div>
        </div>
        {campaign.dueDate && (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums text-os-muted">
            <Calendar className="h-3.5 w-3.5 text-os-dim" strokeWidth={1.7} /> {campaign.dueDate}
          </span>
        )}
      </div>

      <div className="mt-3.5">
        <StageStrip stage={campaign.stage} />
      </div>

      <p className="mt-3.5 text-[13px] leading-relaxed text-os-muted [text-wrap:pretty]">{campaign.angle}</p>
      {campaign.framing && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-os-dim [text-wrap:pretty]">{campaign.framing}</p>
      )}
      {campaign.briefQuote && (
        <p className="mt-1.5 border-l border-[var(--hairline)] pl-3 text-[12.5px] italic leading-relaxed text-os-dim [text-wrap:pretty]">
          {campaign.briefQuote}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {r.mention && <Chip mono>{r.mention}</Chip>}
        {r.hashtags.map((h) => (
          <Chip key={h} mono>
            {h}
          </Chip>
        ))}
        {r.commentCta && <Chip>Comment-keyword CTA</Chip>}
        {r.cta && !r.commentCta && <Chip>{r.cta}</Chip>}
        {r.durationSec && (
          <Chip mono>
            {r.durationSec[0]}–{r.durationSec[1]}s
          </Chip>
        )}
        {campaign.references.length > 0 && <Chip>Refs: {campaign.references.join(', ')}</Chip>}
      </div>

      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-os-dim transition-colors hover:text-os-text [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" strokeWidth={1.7} />
          Brief facts
        </summary>
        <div className="mt-3 grid gap-4 border-t border-[var(--hairline)] pt-3 sm:grid-cols-2">
          <div>
            <div className="glass-label mb-2">Do</div>
            <ul className="flex flex-col gap-1.5">
              {campaign.dos.map((d) => (
                <li key={d} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-os-muted">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-os-ok" strokeWidth={1.8} />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="glass-label mb-2">Don&apos;t</div>
            <ul className="flex flex-col gap-1.5">
              {campaign.donts.map((d) => (
                <li key={d} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-os-muted">
                  <Minus className="mt-0.5 h-3 w-3 shrink-0 text-os-err" strokeWidth={1.8} />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}

export function CampaignBoard({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} />
      ))}
    </div>
  );
}
