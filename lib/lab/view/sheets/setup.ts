/**
 * Setup sheet (`?setup=<section>`) model (01 19.1) and its builder. SetupView and its parts are
 * section 08's (lib/lab/setup/view.ts), embedded unchanged as `setup`.
 */
import type { SetupSection } from '@/lib/lab/view/shared';
import { SETUP_SECTIONS, setupView, type SetupView } from '@/lib/lab/setup/view';
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';
import { withSample } from '@/lib/lab/view/section';

export type SetupSheetView = {
  /** resolved: '1' or empty -> checklist until setup.checklist.complete, then keys (08.3) */
  section: SetupSection;
  /** section 08 setupView(store, opts), unchanged */
  setup: SetupView;
  /** labels Checklist, Keys, Sources, Schedule, Spend; a row of tabs in the sheet header (C8) */
  rail: { id: SetupSection; label: string; badge: string | null; href: string }[];
  /** ?focus=add on sources */
  focusAdd: boolean;
  /** "The Lab is paused. Nothing runs on schedule." | "Paused for all automation by PAUSED in {dir}" */
  pausedBanner: string | null;
};

/* ── builder (01 19) ──────────────────────────────────────────────────── */

export function buildSetupSheet(store: LabStore, requested: string, focusAdd: boolean, now: Date, env: LabLayerEnv): SetupSheetView {
  const setup = setupView(store, { now, dry: env.dry, dryLabel: env.dryLabel, sample: env.sample, filming: env.filming, readOnly: Boolean(env.readOnly), section: requested, env: env.env });
  const section = setup.focus;
  const keysOff = setup.keys.filter((k) => k.state === 'not_configured' || k.state === 'needs_connect').length;
  const badge = (id: SetupSection): string | null => {
    if (id === 'checklist') return setup.checklist.complete ? null : `${setup.checklist.requiredDone}/${setup.checklist.requiredTotal}`;
    if (id === 'keys') return keysOff >= 1 ? `${keysOff} not set up` : null;
    if (id === 'spend') return setup.spend.blocked ? 'Blocked' : null;
    return null;
  };
  const p = setup.schedule.paused;
  const pausedBanner = p.by ? (p.scope === 'all' ? fill(LAB_COPY.sheet.pausedAll, { dir: p.by.replace(/\/PAUSED[^/]*$/, '') }) : LAB_COPY.frame.bannerPaused) : null;
  return {
    section,
    setup,
    rail: SETUP_SECTIONS.map((id) => ({ id, label: LAB_COPY.sheet.setupTabs[id], badge: badge(id), href: withSample(`?setup=${id}`, env.sample) })),
    focusAdd: section === 'sources' && focusAdd,
    pausedBanner,
  };
}
