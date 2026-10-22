'use client';

/**
 * F9 under the GladOS style: the Review tab (GList rows with Approve and
 * Reject) and the failover control in the AgentSheet (GSelect plus a GDialog
 * confirm). Data: lib/agent-review.ts, built once by app/agents/page.tsx.
 */
import { useState } from 'react';
import { GButton, GCard, GDialog, GEmpty, GField, GList, GRow, GSectionHeader, GSelect, GTag, GTextarea } from '@/components/g';
import { outputTitle, type Deliverable, type ReviewView } from '@/lib/agent-review';
import { AgentFace } from '@/components/agents/AgentFace';
import { age, useFailover, useReview } from './hooks';

export function ReviewG({ initial, avatars, now }: { initial: ReviewView; avatars: Record<string, string>; now: number }) {
  const { pending, decided, busy, decide } = useReview(initial);
  const [rejecting, setRejecting] = useState<Deliverable | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="wg-af-review">
      <GCard p={20} className="wg-af-card">
        <GSectionHeader size={22} title="Awaiting review" caption={`${pending.length} finished ${pending.length === 1 ? 'output' : 'outputs'} from the last 30 days`} />
        {pending.length === 0 ? (
          <GEmpty inline title="Nothing to review" body="Finished agent runs with output land here until you approve or reject them." />
        ) : (
          <GList divided label="Deliverables awaiting review">
            {pending.map((d) => (
              <GRow
                key={d.runId}
                leading={<AgentFace src={avatars[d.agentId]} name={d.agentName} size={32} />}
                title={outputTitle(d.summary)}
                meta={`${d.agentName} · ${age(d.finishedAt, now)}`}
                hint={d.summary}
                trailing={
                  <span className="wg-af-actions">
                    <GButton variant="ink" size="compact" busy={busy === d.runId} onClick={() => void decide(d, 'approved')}>
                      Approve
                    </GButton>
                    <GButton
                      size="compact"
                      disabled={busy === d.runId}
                      onClick={() => {
                        setReason('');
                        setRejecting(d);
                      }}
                    >
                      Reject
                    </GButton>
                  </span>
                }
              />
            ))}
          </GList>
        )}
      </GCard>

      {decided.length > 0 && (
        <GCard p={20} className="wg-af-card">
          <GSectionHeader size={22} title="Decided" caption="The latest decisions, one per run" />
          <GList divided label="Decided deliverables">
            {decided.map((d) => (
              <GRow
                key={d.runId}
                leading={<AgentFace src={avatars[d.agentId]} name={d.agentName} size={28} />}
                title={outputTitle(d.summary)}
                meta={`${d.agentName} · ${age(d.at, now)}${d.reason ? ` · ${d.reason}` : ''}`}
                trailing={<GTag tone={d.decision === 'approved' ? 'ok' : 'err'} dot>{d.decision === 'approved' ? 'Approved' : 'Rejected'}</GTag>}
              />
            ))}
          </GList>
        </GCard>
      )}

      <GDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.agentName}'s output` : 'Reject'}
        confirmLabel="Reject"
        tone="danger"
        busy={!!rejecting && busy === rejecting.runId}
        confirmDisabledReason={reason.trim() ? undefined : 'Say why, so the agent can do better next time'}
        onConfirm={async () => {
          if (!rejecting || !reason.trim()) return;
          if (await decide(rejecting, 'rejected', reason)) setRejecting(null);
        }}
      >
        {rejecting && <p className="wg-cap">{outputTitle(rejecting.summary, 160)}</p>}
        <GField label="Reason">
          <GTextarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What was wrong with it" />
        </GField>
      </GDialog>
    </div>
  );
}

/** Failover inside the AgentSheet: pick a model, confirm, PATCH (A-2 logs it to the run feed). */
export function FailoverG({ agentId, agentName, model, options }: { agentId: string; agentName: string; model: string; options: string[] }) {
  const fo = useFailover(agentId, agentName, model);
  const [choice, setChoice] = useState(fo.model);
  const [confirming, setConfirming] = useState(false);
  const same = choice === fo.model;
  return (
    <div className="wg-af-failover">
      <GField label="Model">
        <GSelect value={choice} onChange={(e) => setChoice(e.target.value)} options={options.map((o) => ({ value: o, label: o === 'builtin' ? 'builtin (its own code path)' : o }))} aria-label={`Model for ${agentName}`} />
      </GField>
      <GButton disabled={same} disabledReason="Pick a different model first" busy={fo.busy} onClick={() => setConfirming(true)}>
        Switch model
      </GButton>
      <GDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Move ${agentName} to ${choice}?`}
        confirmLabel="Switch model"
        busy={fo.busy}
        onConfirm={async () => {
          if (await fo.switchTo(choice)) setConfirming(false);
        }}
      >
        <p className="wg-cap">
          From {fo.model || 'its default model'} to {choice}. Its next chat runs on the new model, which may cost more or less per message. The change is logged to its run history.
        </p>
      </GDialog>
    </div>
  );
}
