/**
 * Content Lab v2 page and sheet models: the barrel (01 5.1). Components import every type from
 * here (`@/lib/lab/view`, which now resolves to this file). v1's view module moved whole to
 * legacy.ts and is re-exported so v1 callers (agents, CLI, tests) keep working.
 *
 * Inside lib/, import a module under lib/lab/view/ directly (never this barrel) to avoid cycles.
 */
import type { SetupSection } from '@/lib/lab/view/shared';
import type { TodayPageView } from '@/lib/lab/view/today';
import type { RadarPageView } from '@/lib/lab/view/radar';
import type { BreakoutsPageView } from '@/lib/lab/view/breakouts';
import type { PlaybookPageView } from '@/lib/lab/view/playbook';
import type { StudioPageView } from '@/lib/lab/view/studio';
import type { LedgerPageView } from '@/lib/lab/view/ledger';
import type { CreatorversePageView } from '@/lib/lab/view/creatorverse';
import type { PostSheetView } from '@/lib/lab/view/sheets/post';
import type { EventSheetUi } from '@/lib/lab/view/sheets/event';
import type { IdeaSheetUi } from '@/lib/lab/view/sheets/idea';
import type { ScriptSheetUi } from '@/lib/lab/view/sheets/script';
import type { TestSheetView } from '@/lib/lab/view/sheets/test';
import type { SetupSheetView } from '@/lib/lab/view/sheets/setup';
import type { AskSheetView } from '@/lib/lab/view/sheets/ask';

/* v1 view module (types and builders), unchanged */
export * from '@/lib/lab/view/legacy';
/* 01 page and sheet models */
export * from '@/lib/lab/view/shared';
export * from '@/lib/lab/view/format';
export { LAB_COPY, COPY_09_8 } from '@/lib/lab/view/copy';
export type * from '@/lib/lab/view/frame';
export type * from '@/lib/lab/view/period';
export type * from '@/lib/lab/view/today';
export type * from '@/lib/lab/view/radar';
export type * from '@/lib/lab/view/breakouts';
export type * from '@/lib/lab/view/playbook';
export type * from '@/lib/lab/view/studio';
export type * from '@/lib/lab/view/ledger';
export type * from '@/lib/lab/view/creatorverse';
export type * from '@/lib/lab/view/sheets/post';
export type * from '@/lib/lab/view/sheets/event';
export type * from '@/lib/lab/view/sheets/idea';
export type * from '@/lib/lab/view/sheets/script';
export type * from '@/lib/lab/view/sheets/test';
export type * from '@/lib/lab/view/sheets/setup';
export type * from '@/lib/lab/view/sheets/ask';
export { LAB_LAYERS_BUILT, layerStates } from '@/lib/lab/view/layers';

/* domain types re-exported so components import from one place (01 5.1); never redefined here */
export type { RadarView, EventRow, EventSheetView, WindowCardView, RadarTile, BriefView, MorningBriefView, RadarSourceHealth, AngleCell, AngleId } from '@/lib/lab/radar/view';
export type { LedgerView, PredictorCard, MetricCell, PredictionRow, TestRow, ReliabilityBin, PlannerView, TestMark, Verdict } from '@/lib/lab/ledger/view';
export type { StudioView, IdeaSheetView, ScriptSheetView, AskView, AskFilters, JudgeRecord } from '@/lib/lab/gen/view';
export type { SetupView, SourcesSetupView, ScheduleView, SpendView } from '@/lib/lab/setup/view';
export type { ChecklistView, ChecklistStep } from '@/lib/lab/setup/checklist';
export type { LabKeyRow, LabKeyState } from '@/lib/lab/setup/keys';
export type { BatchProgress, RunRowProgress } from '@/lib/lab/setup/progress';
export type { PlanEstimate, PlanInputs } from '@/lib/lab/setup/estimate';
export type { GateEta } from '@/lib/lab/setup/gates';
export type { ScheduleJobRow } from '@/lib/lab/setup/schedule';

/** 01 5.4: view null = not found (13.4). */
export type SheetPayload =
  | { kind: 'post'; id: string; view: PostSheetView | null }
  | { kind: 'event'; id: string; view: EventSheetUi | null }
  | { kind: 'idea'; id: string; view: IdeaSheetUi | null }
  | { kind: 'script'; id: string; view: ScriptSheetUi | null }
  | { kind: 'test'; id: string; view: TestSheetView | null }
  | { kind: 'setup'; id: SetupSection; view: SetupSheetView }
  | { kind: 'ask'; id: string; view: AskSheetView };

export type LabPageView = TodayPageView | RadarPageView | BreakoutsPageView | PlaybookPageView | StudioPageView | LedgerPageView | CreatorversePageView;

/*
 * 01 5.4 builders: buildPageView and buildSheet live in lib/lab/view/build.ts (server only) and are
 * deliberately not re-exported here, so client components can import this barrel safely.
 */

/** The page model for each route, by page id. */
export type PageViewOf = { today: TodayPageView; radar: RadarPageView; breakouts: BreakoutsPageView; playbook: PlaybookPageView; studio: StudioPageView; ledger: LedgerPageView; creatorverse: CreatorversePageView };
