'use client';
/**
 * Setup sheet (`?setup=<section>`), GladOS tree (01 19): 560px, the section switcher is a row of tabs in
 * the sheet header (C8) so every section gets the full width; at 390 the tabs scroll. Switching sections
 * is local (SetupView carries every section) and mirrors `setup=` with replaceState. The OAuth return
 * (`&oauth=`) shows its toast once and drops the param.
 */
import { useEffect, useState } from 'react';
import { useToast } from '@/components/g';

import type { SetupSection } from '@/lib/lab/view/shared';
import type { SetupSheetView } from '@/lib/lab/view/sheets/setup';
import { ScheduleEditor } from '../setup/ScheduleEditor';
import { ChecklistSection, KeysSection, SourcesSection, SpendSection } from '../setup/SetupSections';
import { SheetShell, SheetTabs, type SheetCtx } from './SheetShell';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const OAUTH: Record<string, { text: string; tone: 'ok' | 'info' | 'err' }> = {
  'youtube.ok': { text: 'YouTube connected', tone: 'ok' },
  'instagram.ok': { text: 'Instagram connected', tone: 'ok' },
  'youtube.denied': { text: 'Sign-in was cancelled. Nothing changed.', tone: 'info' },
  'instagram.denied': { text: 'Sign-in was cancelled. Nothing changed.', tone: 'info' },
  'youtube.error': { text: 'Sign-in did not finish. Nothing was saved.', tone: 'err' },
  'instagram.error': { text: 'Sign-in did not finish. Nothing was saved.', tone: 'err' },
};

export function SetupSheet({ ctx, view, section }: { ctx: SheetCtx; view: SetupSheetView | null | undefined; section: string }) {
  const v = view ?? null;
  const [sec, setSec] = useState<SetupSection>((v?.section ?? section) as SetupSection);
  const { toast } = useToast();
  useEffect(() => {
    if (v?.section) setSec(v.section);
  }, [v?.section]);
  useEffect(() => {
    const u = new URL(window.location.href);
    const o = u.searchParams.get('oauth');
    if (!o) return;
    const t = OAUTH[o];
    if (t) toast(t);
    u.searchParams.delete('oauth');
    window.history.replaceState(null, '', u.pathname + u.search);
  }, [toast]);
  const s = v?.setup;
  const ro = ctx.frame.readOnly ?? (s?.mode.readOnly ? ctx.frame.readOnly : null);
  return (
    <SheetShell
      kind="setup"
      ctx={ctx}
      title={LAB_UI.kindSetup}
      caption={s ? s.brand.name : undefined}
      tabs={
        v && (
          <SheetTabs
            tabs={v.rail.map((r) => ({ id: r.id, label: r.badge ? `${r.label} · ${r.badge}` : r.label }))}
            value={sec}
            label={LAB_UI.kindSetup}
            onChange={(id) => {
              setSec(id);
              const u = new URL(window.location.href);
              u.searchParams.set('setup', id);
              u.searchParams.delete('focus');
              window.history.replaceState(null, '', u.pathname + u.search);
            }}
          />
        )
      }
    >
      {v && s && (
        <div className="lab2g-sheetbody lab2g-setup">
          {v.pausedBanner && sec !== 'schedule' && <p className="lab2g-banner-line" data-lab-ink="">{v.pausedBanner}</p>}
          {s.mode.dryLabel && <p className="lab2g-muted" data-lab-ink="">{s.mode.dryLabel}</p>}
          {sec === 'checklist' && <ChecklistSection c={s.checklist} notes={s.notes} readOnly={ro} />}
          {sec === 'keys' && <KeysSection keys={s.keys} readOnly={ro} filming={s.mode.filming} />}
          {sec === 'sources' && <SourcesSection setup={s} focusAdd={v.focusAdd} readOnly={ro} sample={s.mode.sample} />}
          {sec === 'schedule' && <ScheduleEditor schedule={s.schedule} planner={s.planner} readOnly={ro} pausedBanner={v.pausedBanner} />}
          {sec === 'spend' && <SpendSection spend={s.spend} readOnly={ro} />}
        </div>
      )}
    </SheetShell>
  );
}
