import { CircleDashed, CheckCircle2, ExternalLink, UserRound } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/lib/data';
import { buildSystemSetup } from '@/lib/system-setup';
import { listKeyStatuses } from '@/lib/keys';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Label } from '@/components/terminal';
import { SetupKeyInput } from '@/components/SetupKeyInput';
import { AppearancePicker } from '@/components/AppearancePicker';
import { getAppearance, getStoredAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { GPage, GSectionHeader } from '@/components/g';
import { AboutButton } from '@/components/system-g/AboutButton';
import { BringUpHero, PhaseCard, SettingCard } from '@/components/setup/SetupG';
import { FilmingG, SecurityG } from '@/components/setup/SetupControlsG';
import { rolloutProgress } from '@/lib/g-rollout';
import { SetupManualCheck } from '@/components/SetupManualCheck';
import { SetupSecurity } from '@/components/SetupSecurity';
import { isConfigured } from '@/lib/auth';
import { SetupFilming } from '@/components/SetupFilming';
import { dataDir, filmingMode } from '@/lib/paths';
import { getModulesOff } from '@/lib/modules-server';
import { ModulesClassic, ModulesG } from '@/components/setup/Modules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const setup = await buildSystemSetup(getDb());
  const keys = new Map(listKeyStatuses().map((k) => [k.envVar, k]));
  const done = setup.totals.verified + setup.totals.marked;
  const pct = setup.totals.total > 0 ? done / setup.totals.total : 0;
  const filmingPinned = Boolean(process.env.GLADOS_DATA_DIR) || process.env.DEMO_MODE === '0' || process.env.DEMO_MODE === '1';

  // Two trees, one data fetch (glados-ui SPEC X5, S05 F05.90 to F05.95).
  if (treeFor(getAppearance(), '/setup') === 'glados') {
    const keyState = Object.fromEntries([...keys].map(([k, v]) => [k, { present: v.present, masked: v.masked }]));
    const firstOpen = setup.phases.flatMap((p) => p.steps).find((s) => s.status === 'open')?.id ?? null;
    return (
      <GPage className="kg-page kg-narrow">
        <GSectionHeader
          size="page"
          title="Settings"
          caption="Appearance, recording and security, then bring-up: keys, connectors and agents proven live."
          action={
            <AboutButton>
              <p>
                Everything auto-checked here reads the same live sources as the rest of the OS — keys, connector probes, agent
                status, files on disk. Only the five human steps have boxes to tick. If a step looks done but is not verified,
                the wiring is not actually proven yet.
              </p>
            </AboutButton>
          }
        />
        <section className="kg-section" aria-labelledby="setup-appearance">
          <GSectionHeader size={22} id="setup-appearance" title="Appearance" caption="How every page looks. Changes apply immediately." />
          <AppearancePicker initial={getStoredAppearance()} rollout={rolloutProgress()} />
        </section>
        <section className="kg-section" id="modules" aria-labelledby="setup-modules">
          <GSectionHeader size={22} id="setup-modules" title="Modules" caption="Which pages this OS shows. A module that is off leaves the sidebar, search and number keys; its data is kept." />
          <ModulesG initialOff={getModulesOff()} />
        </section>
        <section className="kg-section" aria-label="Bring-up">
          <BringUpHero totals={setup.totals} firstOpen={firstOpen} />
        </section>
        <div className="kg-section kg-grid-2">
          <SettingCard
            title="Recording"
            caption="Point the OS at the sample dataset for filming. Only the directory the stores read changes; real data is never seeded over or copied."
          >
            <FilmingG filming={filmingMode()} pinned={filmingPinned} dataDir={dataDir()} />
          </SettingCard>
          <SettingCard title="Security" caption="Who can open this OS. Without a password it answers only on this machine.">
            <SecurityG configured={isConfigured()} />
          </SettingCard>
        </div>
        <div className="kg-section kg-stack">
          {setup.phases.map((phase) => (
            <PhaseCard key={phase.n} phase={phase} keys={keyState} />
          ))}
        </div>
      </GPage>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="System bring-up · keys, connectors and agents proven live"
        title="Settings"
        right={
          <div className="flex items-center gap-3">
            <Badge tone="accent">{setup.totals.verified} verified</Badge>
            <Badge tone="default">{setup.totals.marked} marked done</Badge>
            <Badge tone={setup.totals.open > 0 ? 'warn' : 'ok'}>{setup.totals.open} open</Badge>
          </div>
        }
      />

      {/* Appearance first (S05 F05.90): style, colour and mode for every page,
          applied the moment they are picked and kept per browser (S00 FR-13). */}
      <section className="mb-10 max-w-[860px]">
        <Label rule>Appearance</Label>
        <p className="mb-3 mt-2 text-[12.5px] text-os-dim">How every page looks. Changes apply immediately.</p>
        <AppearancePicker initial={getStoredAppearance()} rollout={rolloutProgress()} />
      </section>

      {/* Modules: which sidebar views this install shows (lib/modules.ts). */}
      <section id="modules" className="mb-10 max-w-[860px]">
        <Label rule>Modules</Label>
        <p className="mb-3 mt-2 text-[12.5px] text-os-dim">
          Which pages this OS shows. A module that is off leaves the sidebar, search and number keys; its data is kept.
        </p>
        <ModulesClassic initialOff={getModulesOff()} />
      </section>

      {/* Progress: verified fills solid, marked-done fills dimmer — the split stays visible. */}
      <Label rule>Bring-up</Label>
      <div className="mb-2 mt-3 flex items-baseline justify-between">
        <span className="text-[12.5px] tabular-nums text-os-muted">
          {done} of {setup.totals.total} steps done
        </span>
        <span className="text-[12.5px] tabular-nums text-os-dim">{Math.round(pct * 100)}%</span>
      </div>
      <div className="mb-10 flex h-[10px] overflow-hidden rounded-full" style={{ background: 'color-mix(in oklab, var(--text) 8%, transparent)' }}>
        <div className="h-full" style={{ width: `${(setup.totals.verified / setup.totals.total) * 100}%`, background: 'var(--accent)' }} />
        <div
          className="h-full"
          style={{ width: `${(setup.totals.marked / setup.totals.total) * 100}%`, background: 'color-mix(in oklab, var(--accent) 40%, transparent)' }}
        />
      </div>

      {/* Recording — which dataset the OS is reading. Switching never writes to the other one. */}
      <section className="mb-10 max-w-[860px]">
        <Label rule>Recording</Label>
        <p className="mb-3 mt-2 text-[12.5px] text-os-dim">
          Point the OS at the sample dataset for filming. This only changes which directory the stores read; your real
          data is never seeded over or copied.
        </p>
        <SetupFilming
          filming={filmingMode()}
          pinned={Boolean(process.env.GLADOS_DATA_DIR) || process.env.DEMO_MODE === '0' || process.env.DEMO_MODE === '1'}
          dataDir={dataDir()}
        />
      </section>

      {/* Security — who can open this OS. The password is set here, never in a config file. */}
      <section className="mb-10 max-w-[860px]">
        <Label rule>Security</Label>
        <p className="mb-3 mt-2 text-[12.5px] text-os-dim">
          Who can open this OS. Without a password it answers only on this machine; with one, every device signs in.
        </p>
        <SetupSecurity configured={isConfigured()} />
      </section>

      <div className="max-w-[860px] space-y-10">
        {setup.phases.map((phase) => {
          const phaseDone = phase.steps.filter((s) => s.status !== 'open').length;
          return (
            <section key={phase.n}>
              <Label rule count={`${phaseDone}/${phase.steps.length}`}>
                Phase {phase.n} · {phase.title}
              </Label>
              <p className="mb-4 mt-2 text-[12.5px] text-os-dim">{phase.blurb}</p>
              <div className="space-y-3">
                {phase.steps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-lg-t border bg-os-surface px-5 py-4"
                    style={{
                      borderColor:
                        step.status === 'verified'
                          ? 'color-mix(in oklab, var(--accent) 30%, var(--border))'
                          : 'var(--border)',
                      opacity: step.status === 'verified' ? 0.85 : 1,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      {step.status === 'verified' ? (
                        <CheckCircle2 size={16} strokeWidth={1.8} className="shrink-0 text-os-accent" />
                      ) : step.status === 'marked' ? (
                        <CheckCircle2 size={16} strokeWidth={1.8} className="shrink-0 text-os-muted" />
                      ) : (
                        <CircleDashed size={16} strokeWidth={1.8} className="shrink-0 text-os-dim" />
                      )}
                      <span className="text-[13.5px] font-medium">{step.title}</span>
                      {step.auto ? (
                        <span className="text-[11.5px] text-os-dim">
                          {step.status === 'verified' ? 'auto-verified' : 'auto-checks'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-os-dim">
                          <UserRound size={11} strokeWidth={1.7} /> yours to confirm
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2.5">
                        {!step.auto && <SetupManualCheck id={step.id} marked={step.status === 'marked'} />}
                        {step.href && (
                          <Link
                            href={step.href}
                            className="inline-flex items-center gap-1 text-[12.5px] text-os-dim transition-colors hover:text-os-text"
                          >
                            open <ExternalLink size={11} strokeWidth={1.8} />
                          </Link>
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 pl-[28px] text-[12.5px] leading-relaxed text-os-muted [overflow-wrap:anywhere]">{step.detail}</p>
                    {step.envVar && step.status === 'open' && (
                      <div className="mt-3 pl-[28px]">
                        <SetupKeyInput
                          envVar={step.envVar}
                          present={keys.get(step.envVar)?.present ?? false}
                          masked={keys.get(step.envVar)?.masked ?? ''}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-10 max-w-[860px] text-[12.5px] leading-relaxed text-os-dim">
        Everything auto-checked here reads the same live sources as the rest of the OS — keys, connector probes, agent
        status, files on disk. Only the five human steps have boxes to tick. If a step looks done but is not verified,
        the wiring is not actually proven yet.
      </p>
    </div>
  );
}
