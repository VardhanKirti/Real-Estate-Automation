'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, FileEdit, Mail } from 'lucide-react';
import { GButton, GCard, GChip, GDiff, GEmpty, GList, GRow, GSectionHeader, GTag, useToast } from '@/components/g';
import type { DriftInsight } from '@/lib/drift';
import { DRAFT_FOOTER, PROPOSED_FIX, humanizeSource } from './DriftRail';

/**
 * /drift under the GladOS style (SPEC S05 F05.40 to F05.43). Nothing here
 * sends or writes (H35): the draft and the new canon passage are offered
 * for copying only. Insights without a proposed fix show no actions (edge 9).
 */

function CopyDraft({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const onCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      toast({ text: 'Draft copied', tone: 'ok' });
    } catch {
      toast({ text: 'Copy failed: select the text and copy it by hand', tone: 'err' });
    }
  };
  return (
    <GButton variant="sm" onClick={onCopy} aria-label={label} title={label}>
      <Copy size={13} strokeWidth={1.8} aria-hidden="true" /> Copy
    </GButton>
  );
}

function OpenInsight({ insight }: { insight: DriftInsight }) {
  const [openOcc, setOpenOcc] = useState<Set<number>>(new Set());
  const [showDiff, setShowDiff] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const fix = PROPOSED_FIX[insight.id];
  const toggleOcc = (i: number) =>
    setOpenOcc((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <GCard as="article" p={24} className="kg-drift" aria-label={insight.claim}>
      <p className="kg-claim">{insight.claim}</p>

      <div className="kg-chips" role="group" aria-label="Occurrences">
        {insight.occurrences.map((occ, i) => (
          <GChip key={`${occ.source}-${i}`} pressed={openOcc.has(i)} onPressedChange={() => toggleOcc(i)} title={`${occ.source}: show the excerpt`}>
            {humanizeSource(occ.source)} · {occ.date}
          </GChip>
        ))}
      </div>
      {insight.occurrences.map((occ, i) =>
        openOcc.has(i) ? (
          <div key={`${occ.source}-${i}-x`} className="kg-quote">
            <div className="kg-quote-head">
              <span>{occ.speaker}</span>
              <span className="kg-mono" data-mono-ok="">
                {occ.source}
              </span>
            </div>
            <p>&ldquo;{occ.excerpt}&rdquo;</p>
          </div>
        ) : null,
      )}

      <div className="kg-quote" aria-label="Canon">
        <div className="kg-quote-head">
          <span>Canon</span>
          <span className="kg-mono" data-mono-ok="">
            {insight.canon.file}
          </span>
        </div>
        <p>{insight.canon.passage}</p>
      </div>

      <div className="kg-drift-foot">
        <GTag tone={insight.confidence === 'high' ? 'accent' : 'neutral'}>{insight.confidence === 'high' ? 'High confidence' : 'Medium confidence'}</GTag>
        <span className="kg-cap">detected {insight.detectedAt}</span>
        <span className="kg-spacer" />
        {fix && (
          <>
            <GButton variant="sm" onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>
              <FileEdit size={13} strokeWidth={1.8} aria-hidden="true" /> Update canon
            </GButton>
            <GButton variant="sm" onClick={() => setShowDraft((v) => !v)} aria-expanded={showDraft}>
              <Mail size={13} strokeWidth={1.8} aria-hidden="true" /> Draft correction
            </GButton>
          </>
        )}
      </div>

      {showDiff && fix && (
        <div className="kg-stack-sm">
          <GDiff removed={[fix.removed]} added={[fix.added]} file={insight.canon.file} />
          <p className="kg-cap">Not written. Copy the new passage into {insight.canon.file}.</p>
        </div>
      )}

      {showDraft && fix && (
        <div className="kg-quote">
          <div className="kg-quote-head">
            <span>To: {fix.to}</span>
          </div>
          <p>{fix.message}</p>
          <div className="kg-draft-foot">
            <p className="kg-cap">
              {DRAFT_FOOTER} <Link href="/inbox">Comms</Link>.
            </p>
            <CopyDraft text={fix.message} label={`Copy the draft to the ${fix.to}`} />
          </div>
        </div>
      )}
    </GCard>
  );
}

function ResolvedRow({ insight }: { insight: DriftInsight }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GRow
        leading={<CheckCircle2 size={16} strokeWidth={1.7} aria-hidden="true" />}
        title={insight.claim}
        meta={`${insight.canon.file} · detected ${insight.detectedAt}`}
        trailing={<GTag tone="ok">Resolved</GTag>}
        onClick={() => setOpen((v) => !v)}
        selected={open}
        hint={open ? 'Hide details' : 'Show details'}
      />
      {open && (
        <li className="kg-resolved-body">
          <div className="kg-quote">
            <div className="kg-quote-head">
              <span>Canon</span>
              <span className="kg-mono" data-mono-ok="">
                {insight.canon.file}
              </span>
            </div>
            <p>{insight.canon.passage}</p>
          </div>
        </li>
      )}
    </>
  );
}

export function DriftG({ insights }: { insights: DriftInsight[] }) {
  if (insights.length === 0) {
    return (
      <GCard p={24}>
        <GEmpty
          kind="unconfigured"
          title="Drift detection is not running yet"
          body="It compares claims in incoming calls and threads against the knowledge canon and surfaces contradictions here."
          setupHref="/setup"
          setupHint="The extraction pipeline is not configured"
        />
      </GCard>
    );
  }
  const open = insights.filter((i) => i.state !== 'resolved');
  const resolved = insights.filter((i) => i.state === 'resolved');
  return (
    <>
      {open.length > 0 ? (
        <div className="kg-drift-grid">
          {open.map((i) => (
            <OpenInsight key={i.id} insight={i} />
          ))}
        </div>
      ) : (
        <GCard p={24}>
          <GEmpty title="No open drift" body="Every contradiction found so far has been resolved." />
        </GCard>
      )}
      {resolved.length > 0 && (
        <section className="kg-section" aria-labelledby="drift-resolved">
          <GSectionHeader size={22} id="drift-resolved" title="Resolved" caption={`${resolved.length} closed`} />
          <GCard p={16}>
            <GList divided label="Resolved drift">
              {resolved.map((i) => (
                <ResolvedRow key={i.id} insight={i} />
              ))}
            </GList>
          </GCard>
        </section>
      )}
    </>
  );
}
