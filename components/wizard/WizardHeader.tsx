'use client';

import { Plus } from 'lucide-react';

export type WizardTab = 'workspace' | 'sessions';

export function WizardHeader({
  tab,
  onTab,
  onCreateAgent,
  projectCount,
}: {
  tab: WizardTab;
  onTab: (t: WizardTab) => void;
  onCreateAgent: () => void;
  projectCount: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] leading-none tracking-[-0.01em] text-os-text">Wizard</h1>
          <button type="button" aria-label="Create an agent" onClick={onCreateAgent} className="wz-plus group/plus">
            <Plus className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 ease-[var(--ease)] group-hover/plus:rotate-90" strokeWidth={2.2} />
            <span className="wz-plus-label">Create an agent</span>
          </button>
        </div>
        <p className="mt-2 text-[13px] text-os-muted">Talk to the system. Every conversation becomes a project.</p>
      </div>
      <div className="flex items-center gap-6">
        <span className="text-[12px] text-os-dim tabular-nums">
          {projectCount} project{projectCount === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-5" role="tablist">
          {(['workspace', 'sessions'] as WizardTab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)} className={`wz-tab ${tab === t ? 'wz-tab-on' : ''}`}>
              {t === 'workspace' ? 'Workspace' : 'Sessions'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
