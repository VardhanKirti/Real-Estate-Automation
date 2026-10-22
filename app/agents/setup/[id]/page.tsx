import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Hammer, KeyRound, UserRound } from 'lucide-react';
import { getDb } from '@/lib/data';
import { setupFor } from '@/lib/agent-setup';
import { listKeyStatuses } from '@/lib/keys';
import { agentAvatars } from '@/lib/agent-avatars';
import { AgentAvatar } from '@/components/AgentAvatar';
import { SetupKeyInput } from '@/components/SetupKeyInput';
import { Badge, Label } from '@/components/terminal';
import { PageHeader } from '@/components/PageHeader';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { SetupG } from '@/components/agents/SetupG';

export const dynamic = 'force-dynamic';

export default function AgentSetupPage({ params }: { params: { id: string } }) {
  const agent = getDb().agents.all().find((a) => a.id === params.id);
  if (!agent) notFound();
  const spec = setupFor(agent.id);
  const keys = new Map(listKeyStatuses().map((k) => [k.envVar, k]));
  const avatar = agentAvatars().get(agent.id) ?? null;

  // GladOS tree (glados-ui SPEC S04 §4.2): G_READY lists the route pattern.
  if (treeFor(getAppearance(), '/agents/setup/:id') === 'glados') {
    const envVars = (spec?.steps ?? []).flatMap((s) => (s.kind === 'env' ? [s.envVar] : []));
    return (
      <SetupG
        view={{
          agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status, model: agent.model },
          avatar,
          blurb: spec?.blurb ?? agent.description,
          steps: spec?.steps ?? null,
          keys: Object.fromEntries(envVars.map((v) => [v, { present: keys.get(v)?.present ?? false, masked: keys.get(v)?.masked ?? '' }])),
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Agent setup" title={agent.name} />
      <Link href="/agents" className="mb-6 inline-flex items-center gap-2 text-[12.5px] text-os-dim transition-colors hover:text-os-text">
        <ArrowLeft size={13} strokeWidth={1.8} /> back to the roster
      </Link>

      <div className="mb-8 flex items-center gap-5 rounded-lg-t border border-os-border bg-os-surface px-6 py-5">
        <AgentAvatar src={avatar} name={agent.name} size={56} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[16px] font-medium">{agent.name}</span>
            <Badge tone={agent.status === 'active' ? 'ok' : 'warn'}>{agent.status}</Badge>
            <Badge>{agent.tier}</Badge>
          </div>
          <div className="mt-1 text-[12.5px] text-os-dim">{agent.role} · <span className="font-mono text-[12px]">{agent.model}</span></div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-os-muted">{spec?.blurb ?? agent.description}</p>
        </div>
      </div>

      {!spec && (
        <div className="rounded-lg-t border border-dashed border-os-border px-6 py-8 text-center text-[13px] text-os-dim">
          No setup guide written for this agent yet — describe what it should do in a session and the guide gets built with it.
        </div>
      )}

      {spec && (
        <div className="max-w-[760px] space-y-4">
          <Label rule count={spec.steps.length}>
            Setup steps
          </Label>
          {spec.steps.map((step, i) => {
            const key = step.kind === 'env' ? keys.get(step.envVar) : undefined;
            return (
              <div key={i} className="rounded-lg-t border border-os-border bg-os-surface px-6 py-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-os-border font-mono text-[12px] tabular-nums text-os-dim">
                    {i + 1}
                  </span>
                  {step.kind === 'env' ? (
                    <KeyRound size={14} strokeWidth={1.7} className={key?.present ? 'text-os-accent' : 'text-os-dim'} />
                  ) : step.kind === 'build' ? (
                    <Hammer size={14} strokeWidth={1.7} className="text-os-dim" />
                  ) : (
                    <UserRound size={14} strokeWidth={1.7} className="text-os-dim" />
                  )}
                  <span className="text-[13.5px] font-medium">{step.label}</span>
                  {step.kind === 'build' && <Badge tone="warn">build owed</Badge>}
                  {step.kind === 'external' && <Badge>yours to do</Badge>}
                </div>
                {step.kind === 'env' && (
                  <div className="mt-3 pl-10">
                    {step.hint && <p className="mb-2 text-[12px] text-os-dim">{step.hint}</p>}
                    <SetupKeyInput envVar={step.envVar} present={key?.present ?? false} masked={key?.masked ?? ''} />
                  </div>
                )}
                {step.kind !== 'env' && (
                  <p className="mt-2.5 pl-10 text-[12.5px] leading-relaxed text-os-muted">
                    {step.detail}{' '}
                    {'href' in step && step.href && (
                      <a href={step.href} target="_blank" rel="noreferrer" className="text-os-dim transition-colors hover:text-os-text">
                        open →
                      </a>
                    )}
                  </p>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[12.5px] text-os-dim">
            Keys land in .env.local on this host and take effect immediately. The agent flips to active once its wiring is proven, not when boxes are ticked.
          </p>
        </div>
      )}
    </div>
  );
}
