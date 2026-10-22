/**
 * Routes converted to the new UI style (SPEC S00 FR-14, X5).
 *
 * Under `ui = glados` a route listed here renders its new-style tree; every
 * other route renders its Classic tree under the derived `data-theme`
 * (lib/appearance.ts `deriveClassicTheme`). Under `ui = classic` this list
 * changes nothing.
 *
 * A page lane adds its routes in a one-line merge at lane exit (SPEC C37),
 * only after the Classic-control guard finds zero Classic controls on the
 * route (§3.2, GP4). `G_TREE_FILES` names each route's new-style files so the
 * guard knows what to scan (scripts/g-audit/_lib.mjs parses both literals, so
 * keep them plain string arrays and object literals).
 *
 * lib/appearance.ts re-exports both, so code imports them from there.
 */
export const G_READY: string[] = ['/creative-engine', '/setup', '/login', '/compute', '/usage', '/integrations/whatsapp', '/drift', '/integrations', '/database', '/knowledge', '/brain', '/blueprint', '/brand-deals', '/clients', '/finances', '/funnel', '/agents', '/chats', '/agents/setup/:id', '/tasks', '/wizard', '/inbox', '/skills', '/org', '/roadmap', '/workflows', '/social', '/social/beehiiv', '/social/:platform', '/analytics', '/adpilot', '/', '/lab', '/lead-magnets', '/trading'];

export const G_TREE_FILES: Record<string, string[]> = {
  // fo/clients (founderos-ui pages/clients.md, lead-magnets.md): page.tsx forks; the GladOS trees and their controls live here.
  '/clients': ['app/clients/page.tsx', 'components/clients/ClientsG.tsx', 'components/clients/use-clients.ts'],
  '/lead-magnets': ['app/lead-magnets/page.tsx', 'components/lead-magnets/LeadMagnetsG.tsx', 'components/lead-magnets/use-lead-magnets.ts'],
  // GP1 (lane 2c): one engine, two skins. Every shared surface below renders kit controls under the
  // GladOS style; the Classic markup lives in classic.tsx, timeline-classic.tsx and primitives.tsx, which
  // only the Classic style renders and which are therefore not listed.
  '/creative-engine': [
    'app/creative-engine/page.tsx',
    'components/creative-engine/BackLink.tsx',
    'components/creative-engine/Dashboard.tsx',
    'components/creative-engine/skin.tsx',
    'components/creative-engine/skin-dash.tsx',
    'components/creative-engine/EngineTimeline.tsx',
    'components/creative-engine/Widget.tsx',
    'components/creative-engine/Drawers.tsx',
    'components/creative-engine/CampaignSwitcher.tsx',
    'components/creative-engine/CreativeGenerator.tsx',
    'components/creative-engine/Scripter.tsx',
    'components/creative-engine/Briefings.tsx',
    'components/creative-engine/UgcStudio.tsx',
    'components/creative-engine/ConnectArcads.tsx',
    'components/creative-engine/MotionConsole.tsx',
    'components/creative-engine/octane-rows.tsx',
    'components/creative-engine/SpendGate.tsx',
    'components/creative-engine/ConsoleErrorBoundary.tsx',
    'components/creative-engine/WorkflowCanvas.tsx',
    'components/creative-engine/workflow/Coach.tsx',
    'components/creative-engine/workflow/ContextMenu.tsx',
    'components/creative-engine/workflow/Dialogs.tsx',
    'components/creative-engine/workflow/Palette.tsx',
    'components/creative-engine/workflow/Shortcuts.tsx',
    'components/creative-engine/workflow/StartCard.tsx',
    'components/creative-engine/workflow/Versions.tsx',
  ],
  // Lane K (S05). app/<route>/page.tsx only forks the trees (its Classic tree is not scanned); the
  // GladOS trees and their controls live in the files below.
  '/login': ['components/login/LoginG.tsx'],
  '/compute': ['components/compute/ComputeG.tsx'],
  // FounderOS merge lane fo/usage: page.tsx only forks; the GladOS tree is UsageG.
  '/usage': ['components/usage/UsageG.tsx'],
  '/integrations/whatsapp': ['components/integrations/WhatsAppG.tsx', 'components/integrations/ConnectFlowG.tsx'],
  '/drift': ['components/knowledge/DriftG.tsx'],
  '/database': ['components/database/DatabaseG.tsx'],
  // /brain: the radial and the knowledge-graph engine are shared by both styles; their GladOS controls use the
  // kit classes through a g prop or useGc (components/system-g/style-context.tsx), so the runtime guard covers them.
  '/brain': ['components/brain/BrainG.tsx', 'components/brain/BrainAbout.tsx', 'components/system-g/AboutButton.tsx'],
  // /blueprint: one workspace for both styles; its controls take kit classes through useGc and the GladOS
  // look is the scoped .kg-blueprint block in globals.css. The guard runs on the DOM (runtime) for it.
  '/blueprint': ['components/system-g/style-context.tsx'],
  '/knowledge': ['components/knowledge/KnowledgeG.tsx', 'components/knowledge/FocusG.tsx', 'components/knowledge/KnowledgeAbout.tsx', 'components/system-g/AboutButton.tsx'],
  '/integrations': ['components/integrations/ConnectionsG.tsx', 'components/integrations/CategoryG.tsx', 'components/integrations/ConnectFlowG.tsx', 'components/integrations/ApiKeysG.tsx'],
  '/setup': ['components/setup/SetupG.tsx', 'components/setup/SetupControlsG.tsx', 'components/system-g/AboutButton.tsx', 'components/AppearancePicker.tsx'],
  // S02 lane R: the Brand Deals GladOS tree (the Classic DealBoard is not listed).
  '/brand-deals': ['app/brand-deals/page.tsx', 'components/brand-deals/DealBoardG.tsx', 'components/brand-deals/use-deal-board.ts'],
  '/finances': ['app/finances/page.tsx', 'app/finances/FinancesG.tsx', 'app/finances/SpendingG.tsx'],
  // fo/trading: the GladOS tree over the shared model (lib/trading-page.ts); TradingClassic is not listed.
  '/trading': ['components/trading/TradingG.tsx', 'components/trading/use-trading.ts'],
  '/funnel': ['app/funnel/page.tsx', 'components/funnel/FunnelDashboardG.tsx', 'components/funnel/model.ts', 'components/funnel/FunnelLinksG.tsx', 'components/funnel/FunnelChannelsG.tsx', 'components/funnel/links-model.ts'],
  // Phase 3 lane W (S04): workforce pages, one GladOS tree per route over the Classic data.
  '/agents': [
    // page.tsx only forks (its Classic tree keeps Classic markup), so the scan starts at the G tree
    'components/agents/AgentsG.tsx',
    'components/agents/AgentCard.tsx',
    'components/agents/AgentFace.tsx',
    'components/agents/AgentSheet.tsx',
    'components/agents/SheetChat.tsx',
    'components/agents/SheetWork.tsx',
  ],
  // fo/chats (founderos-ui pages/chats.md): page.tsx forks; the GladOS tree and the shared state hook.
  '/chats': ['components/chats/ChatsG.tsx', 'components/chats/useChats.ts', 'components/agents/AgentFace.tsx'],
  // a dynamic route: the page checks the pattern itself (usesGTree(…, '/agents/setup/:id'))
  '/agents/setup/:id': ['components/agents/SetupG.tsx', 'components/agents/AgentFace.tsx'],
  '/tasks': ['components/tasks/TasksG.tsx', 'components/tasks/TimeGrid.tsx', 'components/agents/AgentSheet.tsx', 'components/agents/SheetChat.tsx', 'components/agents/SheetWork.tsx'],
  '/wizard': ['components/wizard/WizardG.tsx', 'components/wizard/useWizardWorkspace.ts', 'components/agents/AgentSheet.tsx', 'components/agents/SheetChat.tsx', 'components/agents/SheetWork.tsx'],
  '/inbox': ['components/inbox/InboxG.tsx', 'components/inbox/useInboxWorkspace.ts'],
  // SkillHierarchy renders both skins (skin="g" here); its Classic panel markup only renders without it
  '/skills': ['components/skills/SkillsG.tsx'],
  '/org': ['components/org/OrgG.tsx', 'components/agents/AgentSheet.tsx', 'components/agents/AgentFace.tsx'],
  '/roadmap': ['components/roadmap/RoadmapG.tsx'],
  // The canvas engine builds its DOM outside React; kit.ts swaps its control classes for the kit's at
  // mount (GP4.1). WorkflowCanvas.tsx's static markup is converted the same way, so the runtime guard
  // (g-audit --controls) is the check for it.
  '/workflows': ['app/workflows/page.tsx', 'components/workflow-canvas/kit.ts'],
  // Phase 3 lane H (S01): Home6Console gathers once and forks; its Classic markup is not scanned. The chart's
  // G skin lives in Home6Chart (shared with Classic), so the runtime guard is the check for it.
  '/': ['components/home/HomeG.tsx'],
  // Phase 3 lane G (S03): page.tsx forks (its Classic tree is not scanned); the GladOS trees live below.
  '/social': ['components/social/SocialG.tsx', 'components/social/SocialChartsG.tsx', 'components/social/SeriesSheetG.tsx', 'components/social/DmInboxG.tsx', 'components/social/PostComposerG.tsx'],
  '/social/beehiiv': ['components/social/PlatformG.tsx'],
  // a dynamic route: the page checks the concrete path (usesGTree(…, `/social/${platform}`))
  '/social/:platform': ['components/social/PlatformG.tsx'],
  '/analytics': ['components/analytics/AnalyticsG.tsx'],
  // AdLibrary renders both skins: under <GStyleProvider> its controls take kit classes (useGc), so the
  // runtime guard is the check for it; the deck has its own GladOS file.
  '/adpilot': ['components/adpilot/AdPilotDeckG.tsx'],
  // Content Lab v2 (01 1): page.tsx files fork; the GladOS tree is components/lab/v2/g plus the shared layer.
  '/lab': [
    'components/lab/v2/g/BreakoutsPage.tsx',
    'components/lab/v2/g/Dialogs.tsx',
    'components/lab/v2/g/Field.tsx',
    'components/lab/v2/g/Frame.tsx',
    'components/lab/v2/g/LedgerPage.tsx',
    'components/lab/v2/g/PageShell.tsx',
    'components/lab/v2/g/PlaybookPage.tsx',
    'components/lab/v2/g/PostCard.tsx',
    'components/lab/v2/g/RadarPage.tsx',
    'components/lab/v2/g/RunNow.tsx',
    'components/lab/v2/g/Strand.tsx',
    'components/lab/v2/g/StudioPage.tsx',
    'components/lab/v2/g/TodayPage.tsx',
    'components/lab/v2/g/adapt.ts',
    'components/lab/v2/g/ask/AskBox.tsx',
    'components/lab/v2/g/bits.tsx',
    'components/lab/v2/g/index.ts',
    'components/lab/v2/g/progress/ProgressRow.tsx',
    'components/lab/v2/g/setup/PlanPanel.tsx',
    'components/lab/v2/g/setup/ScheduleEditor.tsx',
    'components/lab/v2/g/setup/SetupSections.tsx',
    'components/lab/v2/g/sheets/AskSheet.tsx',
    'components/lab/v2/g/sheets/EventSheet.tsx',
    'components/lab/v2/g/sheets/IdeaSheet.tsx',
    'components/lab/v2/g/sheets/PostSheet.tsx',
    'components/lab/v2/g/sheets/ScriptSheet.tsx',
    'components/lab/v2/g/sheets/SetupSheet.tsx',
    'components/lab/v2/g/sheets/SheetHost.tsx',
    'components/lab/v2/g/sheets/SheetShell.tsx',
    'components/lab/v2/g/sheets/TestSheet.tsx',
    'components/lab/v2/g/studio/IdeaDetail.tsx',
    'components/lab/v2/g/studio/ScriptEditor.tsx',
    'components/lab/v2/g/studio/StudioParts.tsx',
    'components/lab/v2/shared/ActionPill.tsx',
    'components/lab/v2/shared/Aurora.tsx',
    'components/lab/v2/shared/DotMatrix.tsx',
    'components/lab/v2/shared/Glass.tsx',
    'components/lab/v2/shared/HeroMetric.tsx',
    'components/lab/v2/shared/LabAuroraIntro.tsx',
    'components/lab/v2/shared/LabDialogs.tsx',
    'components/lab/v2/shared/LabRoot.tsx',
    'components/lab/v2/shared/MiniViz.tsx',
    'components/lab/v2/shared/NarrativeCard.tsx',
    'components/lab/v2/shared/PeriodScrubber.tsx',
    'components/lab/v2/shared/Progress.tsx',
    'components/lab/v2/shared/SearchPill.tsx',
    'components/lab/v2/shared/Segmented.tsx',
    'components/lab/v2/shared/Sheet.tsx',
    'components/lab/v2/shared/Tile.tsx',
    'components/lab/v2/shared/format.ts',
    'components/lab/v2/shared/icons.tsx',
    'components/lab/v2/shared/index.ts',
    'components/lab/v2/shared/motion/LabIntroScript.tsx',
    'components/lab/v2/shared/motion/useCountUp.ts',
    'components/lab/v2/shared/motion/useFlipSheet.ts',
    'components/lab/v2/shared/motion/useInViewPause.ts',
    'components/lab/v2/shared/motion/useLabIntro.ts',
    'components/lab/v2/shared/motion/useReducedMotion.ts',
    'components/lab/v2/shared/motion/useWindowPulse.ts',
    'components/lab/v2/shared/progressView.ts',
    'components/lab/v2/shared/runPoller.ts',
    'components/lab/v2/shared/tokens.ts',
    'components/lab/v2/shared/useLabPost.tsx',
    'components/lab/v2/shared/useLabRun.tsx',
    'components/lab/v2/shared/useSheetRoute.ts',
  ],
};

/** Does a concrete pathname match a registry entry? `:name` segments match any one segment. */
export function matchesReadyRoute(entry: string, pathname: string): boolean {
  if (entry === pathname) return true;
  if (!entry.includes('/:')) return false;
  const a = entry.split('/');
  const b = pathname.split('/');
  return a.length === b.length && a.every((seg, i) => (seg.startsWith(':') ? b[i].length > 0 : seg === b[i]));
}

/** True when `pathname` (query and hash ignored) is converted. Entries may carry `:param` segments. */
export function isGReady(pathname: string, ready: readonly string[] = G_READY): boolean {
  const p = pathname.split(/[?#]/)[0] || '/';
  return ready.some((entry) => matchesReadyRoute(entry, p));
}
