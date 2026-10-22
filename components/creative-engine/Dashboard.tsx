'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clapperboard, FileText, Gauge as GaugeIcon, Library, MoreHorizontal, PenLine, Plus, Sparkles, Trash2, UserRound } from 'lucide-react';
import type { Campaign, PoolAd } from '@/lib/creative-engine/schemas';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import type { SavedAd } from '@/lib/foreplay/saved';
import type { WatchEntry } from '@/lib/foreplay/watchlist';
import type { Signal } from '@/lib/foreplay/signals';
import { api, type CampaignSummary, type HealthSnapshot } from '@/components/creative-engine/api';
import { ErrorLine, Progress, fmtMs } from '@/components/creative-engine/primitives';
import { BriefStatusControl, RenderTrack, RunScrubber, useNow } from '@/components/creative-engine/EngineTimeline';
import { droppedLinkText, elapsedAt, engineSearch, kindNoun, parseEngineLink, resolveLinkIds, readyOrder, routeForRun, type BriefStatus, type SheetTarget } from '@/lib/creative-engine/timeline';
import { fmtCredits } from '@/lib/creative-engine/format';
import { DEPTH_BUDGET } from '@/lib/creative-engine/schemas';
import { CreativeGenerator } from '@/components/creative-engine/CreativeGenerator';
import { Scripter } from '@/components/creative-engine/Scripter';
import { Briefings } from '@/components/creative-engine/Briefings';
import { UgcStudio } from '@/components/creative-engine/UgcStudio';
import { MotionConsole, type ConsoleSheet } from '@/components/creative-engine/MotionConsole';
import { RunsDrawer, ProofDrawer, CreditsDrawer, RunRow, CheckNow, opensElsewhere, useRunActions } from '@/components/creative-engine/Drawers';
import { ConnectArcads } from '@/components/creative-engine/ConnectArcads';
import { ENGINE_HREF, ENGINE_NAME_SENTENCE } from '@/lib/creative-engine/name';
import { hiddenCampaigns, hiddenLine, pickInitialCampaign, toSummary } from '@/lib/creative-engine/pick';
import { DRY_CAMPAIGN_TAG, statusCard } from '@/lib/creative-engine/status-card';
import type { Catalog } from '@/lib/arcads/catalog';
import type { ProductOption } from '@/lib/creative-engine/products';
import { CampaignSwitcher, DeleteCampaignDialog, RenameInput, type DeleteTarget } from '@/components/creative-engine/CampaignSwitcher';
import { useToast } from '@/components/ui/Toast';
import { GBigNumber, GBlob, GCardRaised, GHeroCard, GRings, type GRingsStatus } from '@/components/g';
import { ActionsMenu, Btn, EngineSkin, NavPill, PopAnchor, SetupLink, TextButton, TitleTabs, useG } from '@/components/creative-engine/skin';
import { Badge, CardButton, Cloud, EngineSheet, Eyebrow, Gauge, Numeral, OverlayButton, Stat, Tag } from '@/components/creative-engine/skin-dash';
import { ClassicHeroButton, ClassicRings } from '@/components/creative-engine/classic';

/**
 * Creative Engine dashboard — the reference's structure, element for element:
 * pill nav on the left with status badges · thin headline · a row of dotted
 * numerals with lime/white badge labels · a timeline strip with a floating
 * status pill · two gradient hero cards · a "snapshot" row of small cards ·
 * action cards and a pending card on the right · a product-style row of
 * ready scripts. Every function from SPEC §3 opens from here in a sheet.
 */

type Sheet = 'generator' | 'scripter' | 'briefings' | 'ugc' | 'runs' | 'proof' | 'credits' | 'connect' | null;

type Props = {
  campaigns: CampaignSummary[];
  health: HealthSnapshot;
  saved: SavedAd[];
  watchlist: WatchEntry[];
  signals: Signal[];
  products?: ProductOption[];
  sample?: { campaign: Campaign; runs: ResolvedRun[]; catalog: Catalog & { setupHref: string } } | null;
  /** the server's render time, so the first client render matches the server HTML */
  renderedAt?: number;
  /** Render the GladOS tree: the style is glados and /creative-engine is in G_READY (glados-ui GP1, X5). */
  g?: boolean;
};

export function Dashboard({ g = false, ...props }: Props) {
  return (
    <EngineSkin g={g}>
      <DashboardBody {...props} />
    </EngineSkin>
  );
}

function DashboardBody({ campaigns: initialCampaigns, health: initialHealth, saved, watchlist, signals, products = [], sample = null, renderedAt }: Omit<Props, 'g'>) {
  const g = useG();
  const readOnly = sample !== null;
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [campaign, setCampaign] = useState<Campaign | null>(sample?.campaign ?? null);
  const [runs, setRuns] = useState<ResolvedRun[]>(sample?.runs ?? []);
  const [sheet, setSheetState] = useState<Sheet>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // SPEC C20: one target for every sheet (which brief, run, angle or asset it opens on).
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [health, setHealth] = useState(initialHealth);
  const [tab, setTab] = useState<'engine' | 'runs'>('engine');
  // S03 FR-4/FR-6/FR-10 + S04 B16/B44 (SPEC C6, C7): switcher, inline rename, delete.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [genFresh, setGenFresh] = useState(false);
  const [renamingH1, setRenamingH1] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  // S05a FR-15 / SPEC G8 A9: Connect Arcads opened from the console offers the way back.
  // S05a FR-15: a sheet opened from the Motion console hands back to it on close (Runs can open on motion runs only).
  const [returnTo, setReturnTo] = useState<'console' | null>(null);
  const [runsKind, setRunsKind] = useState<'motion' | null>(null);
  const pillRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const { toast } = useToast();
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkRead = useRef(false);
  const load = useCallback(async (id: string): Promise<boolean> => {
    if (retry.current) clearTimeout(retry.current);
    setLoading(true);
    try {
      const res = await api.campaign(id);
      setCampaign(res.campaign);
      setRuns(res.runs);
      setLoadError(false);
      return true;
    } catch {
      // S07 F6: keep the last values, say so, and try again.
      setLoadError(true);
      retry.current = setTimeout(() => { void load(id); }, 10_000);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);

  /** Open a sheet, optionally on one item (S07 §7.5, C20). A target in another campaign loads it first. */
  const go = useCallback(async (t: SheetTarget) => {
    if (t.campaignId && t.campaignId !== campaign?.id && !readOnly) {
      const ok = await load(t.campaignId);
      if (!ok) t = { sheet: 'runs' };
    }
    setTarget(t);
    if (t.sheet === 'console') setConsoleOpen(true);
    else setSheetState(t.sheet);
  }, [campaign?.id, load, readOnly]);
  const setSheet = useCallback((s: Sheet) => {
    setTarget(s ? { sheet: s } : null);
    setSheetState(s);
  }, []);

  useEffect(() => {
    // S03 FR-2: open the newest campaign that may auto-open (live; Filming's own
    // while filming; anything in a dry session). Dry campaigns wait to be asked for.
    const first = readOnly ? null : pickInitialCampaign(initialCampaigns, { dry: initialHealth.dryEnv, filming: initialHealth.filming });
    // C20 deep link: ?engine=<sheet>&brief=&run=&angle=&asset=. Unknown ids fall back to the sheet's default
    // once the campaign they would live in is loaded (the check below drops them with a toast).
    const link = parseEngineLink(window.location.search);
    if (first) void load(first.id).then((ok) => { if (ok) setLinkCheck((n) => n + 1); });
    else setLinkCheck((n) => n + 1);
    if (link) {
      setTarget(link);
      if (link.sheet === 'console') setConsoleOpen(true);
      else setSheetState(link.sheet);
    }
    if (new URLSearchParams(window.location.search).get('tab') === 'runs') setTab('runs');
    linkRead.current = true;
  }, [initialCampaigns, initialHealth.dryEnv, initialHealth.filming, load, readOnly]);

  // C20: a link that names a brief, run, angle or asset this campaign does not have opens the sheet
  // without it, says so, and the address bar stops carrying the id. Runs once, after the first load.
  const [linkCheck, setLinkCheck] = useState(0);
  const linkChecked = useRef(false);
  useEffect(() => {
    if (!linkCheck || linkChecked.current) return;
    linkChecked.current = true;
    if (!target) return;
    const { target: next, dropped } = resolveLinkIds(target, campaign, runs);
    if (!dropped.length) return;
    setTarget(next);
    toast({ text: droppedLinkText(dropped), tone: 'info' });
  }, [linkCheck, campaign, runs, target, toast]);

  /** S04 B42: the tab lives in the URL so a reload or a shared link keeps it. */
  const changeTab = useCallback((next: 'engine' | 'runs') => {
    setTab(next);
    try {
      const q = new URLSearchParams(window.location.search);
      if (next === 'runs') q.set('tab', 'runs');
      else q.delete('tab');
      const s = q.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`);
    } catch { /* history blocked: the tab still switches */ }
  }, []);

  /** S07 F15 + SPEC G3: a delivered motion run opens the console on its asset; one the console cannot show opens the Runs drawer on the run. */
  const openRun = useCallback((r: ResolvedRun) => {
    const dest = routeForRun(r, campaign);
    if (dest.sheet === 'console' && (!dest.campaignId || dest.campaignId === campaign?.id) && !isMotionAsset(campaign, dest.assetId)) {
      void go({ sheet: 'runs', runId: r.id });
      return;
    }
    void go(dest);
  }, [campaign, go]);

  // The address bar follows the open sheet, so a reload or a shared link lands on the same place.
  useEffect(() => {
    if (!linkRead.current) return;
    const open: SheetTarget | null = consoleOpen ? { ...(target?.sheet === 'console' ? target : {}), sheet: 'console' } : sheet ? { ...(target?.sheet === sheet ? target : {}), sheet } : null;
    const next = engineSearch(window.location.search, open);
    if (next !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
  }, [sheet, consoleOpen, target]);

  const anyRunning = runs.some((r) => r.status === 'running');
  // One clock for every surface: 5 s while something runs or the console is open, else nothing.
  useEffect(() => {
    if ((!anyRunning && !consoleOpen) || readOnly) return;
    const tick = async () => {
      try {
        const res = await api.runs(campaign?.id ?? null);
        setRuns(res.runs);
        if (res.advanced > 0 && campaign) void load(campaign.id);
      } catch {
        /* next tick */
      }
    };
    const t = setInterval(tick, anyRunning ? 5_000 : 20_000);
    return () => clearInterval(t);
  }, [anyRunning, consoleOpen, campaign, load, readOnly]);

  const onCampaign = useCallback((c: Campaign) => {
    setCampaign(c);
    setCampaigns((prev) => [toSummary(c), ...prev.filter((p) => p.id !== c.id)]);
    void api.runs(c.id).then((r) => setRuns(r.runs)).catch(() => {});
  }, []);

  /** Rename from the H1 or a switcher row. Returns the error text, or null when saved. */
  const renameCampaign = useCallback(async (id: string, name: string): Promise<string | null> => {
    try {
      const res = await api.patchCampaign(id, { name });
      setCampaign((cur) => (cur?.id === id ? res.campaign : cur));
      setCampaigns((prev) => prev.map((p) => (p.id === id ? toSummary(res.campaign) : p)));
      setAnnounce(`Renamed to ${res.campaign.name}`);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not rename the campaign.';
    }
  }, []);

  /** Open the confirm with what will go; the workflow and rendering counts arrive a moment later. */
  const askDelete = useCallback((c: Pick<CampaignSummary, 'id' | 'name' | 'assets'>) => {
    setSwitcherOpen(false);
    setDeleteError(null);
    setDeleteTarget({ id: c.id, name: c.name, files: c.assets, workflows: null, rendering: 0 });
    void Promise.all([api.workflows(c.id).catch(() => null), api.runs(c.id).catch(() => null)]).then(([w, rr]) => {
      setDeleteTarget((t) => (t && t.id === c.id ? { ...t, workflows: w ? w.workflows.length : null, rendering: rr ? rr.runs.filter((x) => x.status === 'running').length : 0 } : t));
    });
  }, []);

  const confirmDelete = async () => {
    const t = deleteTarget;
    if (!t || readOnly) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // An in-flight run is abandoned first, as the confirm said (S03 edge 7).
      const inFlight = await api.runs(t.id).then((x) => x.runs.filter((r) => r.status === 'running')).catch(() => []);
      for (const r of inFlight) await api.abandon(r.id).catch(() => {});
      await api.deleteCampaign(t.id);
      const remaining = campaigns.filter((c) => c.id !== t.id);
      setCampaigns(remaining);
      if (campaign?.id === t.id) {
        const next = pickInitialCampaign(remaining, { dry: health.dryEnv, filming: health.filming });
        setCampaign(null);
        setRuns([]);
        if (next) void load(next.id);
      }
      setDeleteTarget(null);
      setAnnounce(`Deleted ${t.name}`);
      toast({ text: `Deleted "${t.name}"`, tone: 'ok' });
      setTimeout(() => h1Ref.current?.focus({ preventScroll: true }), 0);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the campaign.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch {
      /* keep */
    }
  }, []);

  /* ── derived ── */
  const pool = campaign?.research?.pool ?? [];
  const minDays = campaign?.research?.minDays ?? 21;
  const proven = pool.filter((a) => a.live && a.daysRunning >= minDays);
  const selected = campaign?.angles.filter((a) => a.selected) ?? [];
  const median = medianDays(selected.length ? pool.filter((a) => new Set(selected.flatMap((s) => s.proofAdIds)).has(a.id)) : proven);
  const approvedScripts = campaign?.scripts.filter((s) => s.approvedVersion !== null) ?? [];
  const running = runs.filter((r) => r.status === 'running').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latestDone = runs.find((r) => r.status === 'delivered') ?? null;
  // F17: elapsed times tick every second client-side while anything runs.
  const now = useNow(running.length > 0, renderedAt);
  const ugcCount = campaign?.generations.filter((g) => g.kind === 'ugc').length ?? 0;
  const motionCount = campaign?.generations.filter((g) => g.kind === 'motion').length ?? 0;
  const proofStrength = median === null ? null : Math.round(Math.min(100, (median / 90) * 100));
  const credits = health.arcads.creditsThisMonth;
  // SPEC C23 (S04 B14): the ruler is the session against its cap; the caption names both numbers.
  const sessionPct = Math.min(1, Math.max(0, health.arcads.sessionSpent / Math.max(1, health.arcads.sessionCap)));
  const sessionLine = `session ${fmtCredits(health.arcads.sessionSpent)} of ${fmtCredits(health.arcads.sessionCap)} cap · ${fmtCredits(credits)} this month`;

  const nav: { key: Exclude<Sheet, null> | 'console'; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: 'generator', label: 'Creative generator', icon: <Sparkles className="h-4 w-4" strokeWidth={1.6} />, badge: campaign?.research ? `${campaign.research.apiCalls} calls` : undefined },
    { key: 'scripter', label: 'Ad scripter', icon: <PenLine className="h-4 w-4" strokeWidth={1.6} />, badge: selected.length ? `${selected.length} selected` : undefined },
    { key: 'briefings', label: 'Briefings', icon: <FileText className="h-4 w-4" strokeWidth={1.6} />, badge: campaign?.briefs.length ? `${campaign.briefs.length}` : undefined },
    { key: 'ugc', label: 'UGC studio', icon: <UserRound className="h-4 w-4" strokeWidth={1.6} />, badge: ugcCount ? `${ugcCount} video${ugcCount === 1 ? '' : 's'}` : undefined },
    { key: 'console', label: 'Motion console', icon: <Clapperboard className="h-4 w-4" strokeWidth={1.6} />, badge: motionCount ? `${motionCount} run${motionCount === 1 ? '' : 's'}` : undefined },
    { key: 'proof', label: 'Proof library', icon: <Library className="h-4 w-4" strokeWidth={1.6} />, badge: saved.length ? `${saved.length} saved` : undefined },
    { key: 'runs', label: 'Runs', icon: <Activity className="h-4 w-4" strokeWidth={1.6} />, badge: running.length ? `${running.length} live` : runs.length ? `${runs.length}` : undefined },
    { key: 'credits', label: 'Credits & health', icon: <GaugeIcon className="h-4 w-4" strokeWidth={1.6} />, badge: health.arcads.configured ? fmtCredits(credits) : 'set up' },
  ];

  // F22: the caption names the real poll interval; the sample is never polled.
  const recentFail = running.length ? null : runs.find((r) => (r.status === 'failed' || r.status === 'stale') && r.finishedAt && now - Date.parse(r.finishedAt) < 10 * 60_000) ?? null;
  const renderCaption = running.length
    ? `${running[0].title.slice(0, 48)} · ${readOnly ? 'sample data, not checked' : 'checked every 5 seconds'}; open to see every run or abandon one.`
    : recentFail
      ? `${kindNoun(recentFail.kind)} failed: ${(recentFail.error ?? 'no reason given').split('\n')[0].slice(0, 90)}`
      : 'Submit a UGC or motion video and its progress shows here.';

  /** F24, F25: optimistic, rolled back with a red toast when the save fails. */
  const setBriefStatus = async (briefId: string, status: BriefStatus) => {
    if (readOnly || !campaign) return;
    const before = campaign;
    setCampaign({ ...campaign, briefs: campaign.briefs.map((b) => (b.id === briefId ? { ...b, status } : b)) });
    try {
      const res = await api.patchBrief(briefId, { status });
      setCampaign((cur) => (cur?.id === res.campaign.id ? res.campaign : cur));
      setAnnounce(`Brief marked ${status}`);
    } catch {
      setCampaign((cur) => (cur?.id === before.id ? before : cur));
      toast({ text: 'Could not save the brief status.', tone: 'err' });
    }
  };

  const noResearchKey = !health.dry && !health.foreplay.configured && !campaign?.research;
  const pickCtx = { dry: health.dryEnv, filming: health.filming };
  const switcherList: CampaignSummary[] = readOnly && campaign ? [toSummary(campaign)] : campaigns;
  const hidden = readOnly ? [] : hiddenCampaigns(campaigns, pickCtx);
  const hiddenText = hiddenLine(hidden);
  // S03 FR-3: a dry campaign opened by hand outside a dry session wears its provenance.
  const dryCampaign = !readOnly && !health.dryEnv && campaign?.origin === 'dry';
  const card = statusCard({ sample: readOnly, dryEnv: health.dryEnv, dryEnvName: health.dryEnvName, filming: health.filming, foreplayConfigured: health.foreplay.configured, campaign: campaign ? { origin: campaign.origin, assets: campaign.assets.length } : null });

  const closeSheet = () => {
    setSheet(null);
    setGenFresh(false);
    setRunsKind(null);
    if (returnTo === 'console') { setReturnTo(null); setConsoleOpen(true); }
  };
  const openFromConsole = (s: ConsoleSheet, opts?: { runsKind?: 'motion' }) => {
    setConsoleOpen(false);
    setReturnTo('console');
    setRunsKind(opts?.runsKind ?? null);
    setSheet(s);
  };
  const backLabel = returnTo === 'console' ? 'Back to Motion console' : undefined;
  // A normal close forgets a deep-linked ?asset=, so reopening later starts on the default asset.
  const closeConsole = () => { setConsoleOpen(false); setTarget((x) => (x?.sheet === 'console' ? null : x)); };

  const open = (key: Exclude<Sheet, null> | 'console') => (key === 'console' ? setConsoleOpen(true) : setSheet(key));
  // The open sheet's target, and a key that remounts the sheet when the target changes.
  const t = target && (target.sheet === sheet || (target.sheet === 'console' && consoleOpen)) ? target : null;
  const targetKey = t ? [t.sheet, t.briefId, t.runId, t.angleId, t.scriptId, t.assetId, t.focus].join('|') : 'none';

  // GP1 FR-GP1.4: the console card's rings are a readout. Lit rings = motion and UGC runs in flight (0 to 3);
  // the centre dot = Arcads: connected (a check has passed), key set but unverified, or not configured.
  const arcadsChecks = Object.values(health.arcads.health);
  const arcadsState: GRingsStatus = !health.arcads.configured ? 'off' : arcadsChecks.some((v) => v.ok) ? 'ok' : 'warn';
  const arcadsWord = arcadsState === 'off' ? 'Arcads not configured' : arcadsState === 'ok' ? 'Arcads connected' : 'Arcads key set, not verified yet';
  const inFlight = running.length;
  const ringsLabel = `${inFlight === 1 ? '1 run' : `${inFlight} runs`} in flight · ${arcadsWord}`;

  return (
    <div className="ae-paper relative">
      <div className="ae-dash">
        {/* ── left: pill nav ── */}
        <aside className="ae-dash-nav">
          <div className="flex items-baseline gap-5 px-1 pb-3">
            {/* S04 B42: real tabs; Left/Right move between them and the choice is in the URL (?tab=runs). */}
            <TitleTabs tabs={[{ value: 'engine', label: 'Engine' }, { value: 'runs', label: 'Runs' }] as const} value={tab} onChange={changeTab} label="Creative engine view" panelId="ae-tabpanel" />
          </div>
          <nav className="ae-dash-pills" aria-label="Creative engine tools">
          {switcherList.length === 0 ? (
            <NavPill active icon={<Plus className="h-4 w-4" strokeWidth={1.6} />} label="New concept" onClick={() => { setGenFresh(true); setSheet('generator'); }} />
          ) : (
            <PopAnchor>
              <NavPill ref={pillRef} active aria-haspopup="true" aria-expanded={switcherOpen} onClick={() => setSwitcherOpen((o) => !o)} icon={<Plus className="h-4 w-4" strokeWidth={1.6} />} label="All campaigns" badge={switcherList.length} />
              {switcherOpen && (
                <CampaignSwitcher
                  campaigns={switcherList}
                  currentId={campaign?.id ?? null}
                  readOnly={readOnly}
                  filming={health.filming}
                  anchorRef={pillRef}
                  onClose={() => setSwitcherOpen(false)}
                  onOpen={(id) => { setSwitcherOpen(false); if (id !== campaign?.id) void load(id); pillRef.current?.focus(); }}
                  onNew={() => { setSwitcherOpen(false); setGenFresh(true); setSheet('generator'); }}
                  onRename={renameCampaign}
                  onDelete={askDelete}
                />
              )}
            </PopAnchor>
          )}
          {nav.map((n) => (
            <NavPill key={n.key} onClick={() => open(n.key)} icon={n.icon} label={n.label} badge={n.badge} />
          ))}
          </nav>
          <div className="ae-card ae-dash-status p-5">
            <Badge data-status={card.kind}>{card.badge}</Badge>
            <div className="mt-3 text-[15px] text-[var(--p-ink)]">{card.title}</div>
            <div className="mt-1 text-[12px] leading-snug text-[var(--p-muted)]">{card.body}</div>
            {card.kind === 'dry-campaign' && campaign && <RerunResearch campaign={campaign} health={health} onCampaign={onCampaign} />}
            <div className="ae-status-actions mt-4 flex flex-wrap items-center justify-between gap-2">
              {!health.foreplay.configured && !readOnly && card.kind !== 'dry-campaign' ? <SetupLink href={health.foreplay.setupHref} hint="FOREPLAY_API_KEY" label="Set up Foreplay" className="whitespace-nowrap" /> : !health.arcads.configured && !readOnly ? <Btn size="sm" onClick={() => setSheet('connect')}>Connect Arcads</Btn> : <span />}
              {/* S03 FR-8: the sample is offered only on a truly blank store; ?sample=1 by hand still works. */}
              {readOnly ? <Btn href={ENGINE_HREF}>Leave sample</Btn> : campaigns.length === 0 ? <Btn href={`${ENGINE_HREF}?sample=1`}>Try the sample</Btn> : null}
            </div>
          </div>
        </aside>

        {/* ── centre ── */}
        <main className="ae-dash-main">
          <div role="tabpanel" id="ae-tabpanel" aria-labelledby={g ? undefined : `ae-tab-${tab}`} aria-label={g ? (tab === 'engine' ? 'Engine' : 'Runs') : undefined}>
          {tab === 'engine' ? (
            <>
              {campaign ? (
                <>
                  {/* S04 B44: the eyebrow says the headline is data, not the page title. */}
                  <Eyebrow className="mb-1.5" cClassName="uppercase tracking-[0.08em]">Campaign</Eyebrow>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    {readOnly && <Badge className="self-center" data-sample-badge>Sample</Badge>}
                    {renamingH1 ? (
                      <RenameInput initial={campaign.name} className="ae-h1-input" onCancel={() => { setRenamingH1(false); }} onSave={async (name) => { const err = await renameCampaign(campaign.id, name); if (!err) setRenamingH1(false); return err; }} />
                    ) : (
                      <h1 ref={h1Ref} tabIndex={-1} className="ae-display ae-h1-clamp min-w-0 outline-none" title={campaign.name}>{campaign.name}</h1>
                    )}
                    {!readOnly && !renamingH1 && (
                      <PopAnchor className="flex items-center gap-1 self-center">
                        <Btn icon onClick={() => setRenamingH1(true)} aria-label="Rename campaign" title="Rename campaign"><PenLine className="h-4 w-4" strokeWidth={1.6} /></Btn>
                        <ActionsMenu
                          label="Campaign actions"
                          triggerIcon={<MoreHorizontal className="h-4 w-4" strokeWidth={1.6} />}
                          items={[
                            { id: 'rename', label: 'Rename', icon: <PenLine className="h-4 w-4" strokeWidth={1.6} />, onSelect: () => setRenamingH1(true) },
                            { id: 'delete', label: 'Delete campaign', icon: <Trash2 className="h-4 w-4" strokeWidth={1.6} />, danger: true, onSelect: () => askDelete({ id: campaign.id, name: campaign.name, assets: campaign.assets.length }) },
                          ]}
                        />
                      </PopAnchor>
                    )}
                    {dryCampaign && <Tag data-dry-tag>{DRY_CAMPAIGN_TAG}</Tag>}
                  </div>
                </>
              ) : (
                <>
                  <h1 className="ae-display">{ENGINE_NAME_SENTENCE}</h1>
                  {/* S03 FR-7: the empty state says what the engine does and offers the one next step. */}
                  <p className="mt-3 max-w-[560px] text-[13.5px] leading-snug text-[var(--p-muted)]">Type an idea for your product and the engine finds ads that have been running for weeks, then turns them into angles, scripts and videos.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Btn tone="ink" onClick={() => setSheet('generator')}>Start a concept</Btn>
                    {hiddenText && <span className={g ? 'ae-cap flex items-center gap-2' : 'ae-cap'} data-hidden-line>{hiddenText} <TextButton onClick={() => setSwitcherOpen(true)} cClassName="underline underline-offset-2 hover:text-[var(--p-ink)]">Show</TextButton></span>}
                  </div>
                </>
              )}
              {/* S07 F1 to F7: four stats, each a button to where its number lives; a true 0 when empty. */}
              <div className="ae-stats" aria-busy={loading || undefined} data-loading={loading || undefined}>
                <Stat value={campaign?.research?.pooled ?? 0} badge="Pooled" lime tip="Ads the research pulled from the library for this concept." unconfigured={noResearchKey} missing="FOREPLAY_API_KEY" onOpen={() => void go({ sheet: 'generator', focus: campaign?.research ? 'research' : 'concept' })} />
                <Stat value={campaign?.research ? proven.length : 0} badge={`Proven ${minDays}+ d`} tip={`Pooled ads still live after ${minDays} or more days. Longevity is the only spend proxy.`} unconfigured={noResearchKey} missing="FOREPLAY_API_KEY" onOpen={() => void go(campaign?.research ? { sheet: 'generator', focus: 'angles', proofOnly: true } : { sheet: 'generator', focus: 'concept' })} />
                <Stat value={campaign?.angles.length ?? 0} badge="Angles" tip="Angles proposed from the pooled ads." onOpen={() => void go({ sheet: 'generator', focus: campaign?.angles.length ? 'angles' : 'concept' })} />
                <Stat value={selected.length} badge="Selected" tip="Angles you picked to script." onOpen={() => void go(selected[0] ? { sheet: 'scripter', angleId: selected[0].id } : { sheet: 'generator', focus: campaign?.angles.length ? 'angles' : 'concept' })} />
                {loadError && <span className="ae-stat-err" role="status" title="Could not refresh. Retrying on the next tick." aria-label="Could not refresh. Retrying on the next tick." />}
              </div>

              {/* S07 F8 to F18: the "brief ready" strip is a run scrubber; the pill opens the selected run. */}
              <RunScrubber
                runs={runs}
                now={now}
                onOpen={openRun}
                onEmpty={() => void go({ sheet: 'generator', focus: 'concept' })}
                onRunsDrawer={(ids) => void go({ sheet: 'runs', runIds: ids })}
              />

              {/* hero cards */}
              <div className="ae-hero-row mt-6">
                {g ? (
                  <>
                    <GHeroCard
                      variant="a"
                      caption={`Proof strength${dryCampaign ? ' · dry-run fixtures' : ''}`}
                      value={proofStrength === null ? null : String(proofStrength)}
                      label={proofStrength === null ? 'Proof strength: no proof set yet' : `Proof strength ${proofStrength} of 100`}
                      title={proofStrength === null ? 'No proof set yet' : `Proof strength ${proofStrength} of 100: median days live of the ${selected.length ? 'proof behind the selected angles' : 'proven ads'}. 90 days live = 100; under 45 is thin.`}
                      status={proofStrength === null || median === null ? 'No proof set yet' : `${proofStrength >= 45 ? 'On track' : 'Thin proof'} · median ${median} d live`}
                      strip={<Cloud total={campaign?.research?.pooled ?? pool.length} lit={proven.length} label={`${campaign?.research?.pooled ?? pool.length} pooled · ${proven.length} proven ${minDays}+ days`} onHero />}
                      onClick={() => void go({ sheet: 'generator', focus: campaign?.angles.length ? 'angles' : 'concept' })}
                    />
                    <GHeroCard
                      variant="b"
                      caption="Credits this month"
                      value={health.arcads.configured ? fmtCredits(credits) : null}
                      label={health.arcads.configured ? `${fmtCredits(credits)} Arcads credits this month` : 'Arcads not configured'}
                      title={health.arcads.configured ? `${sessionLine}. Opens Credits and health.` : 'Arcads is not configured. Opens Connect Arcads.'}
                      status={health.arcads.configured ? sessionLine : 'Not configured · opens Connect Arcads'}
                      strip={health.arcads.configured ? <Gauge value={health.arcads.sessionSpent} max={Math.max(1, health.arcads.sessionCap)} tone={sessionPct >= 1 ? 'over' : sessionPct >= 0.8 ? 'warn' : undefined} label={`Session spend ${fmtCredits(health.arcads.sessionSpent)} of the ${fmtCredits(health.arcads.sessionCap)} credit cap`} onHero /> : undefined}
                      onClick={() => (health.arcads.configured || readOnly ? setSheet('credits') : setSheet('connect'))}
                    />
                  </>
                ) : (
                  <>
                    <ClassicHeroButton tone="green" onClick={() => void go({ sheet: 'generator', focus: campaign?.angles.length ? 'angles' : 'concept' })} className="min-h-[250px] p-6 text-left">
                      <div className="text-center text-[13px] text-[var(--p-on-hero-dim)]">Proof strength{dryCampaign ? ' · dry-run fixtures' : ''}</div>
                      <div className="mt-6 flex justify-center" title={proofStrength === null ? 'No proof set yet' : `Proof strength ${proofStrength} of 100: median days live of the ${selected.length ? 'proof behind the selected angles' : 'proven ads'}. 90 days live = 100; under 45 is thin.`}><Numeral value={proofStrength === null ? '—' : String(proofStrength)} size={7} onHero /></div>
                      <div className="mt-3 text-center text-[13px] text-[var(--p-on-hero-dim)]" title="90 days live = 100. Under 45 is thin.">{proofStrength === null || median === null ? 'No proof set yet' : `${proofStrength >= 45 ? 'On track' : 'Thin proof'} · median ${median} d live`}</div>
                      <div className="absolute inset-x-6 bottom-5"><Cloud total={campaign?.research?.pooled ?? pool.length} lit={proven.length} label={`${campaign?.research?.pooled ?? pool.length} pooled · ${proven.length} proven ${minDays}+ days`} /></div>
                    </ClassicHeroButton>
                    <ClassicHeroButton tone="warm" onClick={() => (health.arcads.configured || readOnly ? setSheet('credits') : setSheet('connect'))} className="min-h-[250px] p-6 text-left">
                      <div className="text-center text-[13px] text-[var(--p-on-hero-dim)]">Credits this month</div>
                      <div className="mt-6 flex justify-center"><Numeral value={health.arcads.configured ? fmtCredits(credits) : '—'} size={7} onHero /></div>
                      <div className="mt-3 text-center text-[13px] text-[var(--p-on-hero-dim)]">{health.arcads.configured ? sessionLine : 'Arcads not connected'}</div>
                      {health.arcads.configured && <div className="absolute inset-x-6 bottom-5"><Gauge value={health.arcads.sessionSpent} max={Math.max(1, health.arcads.sessionCap)} tone={sessionPct >= 1 ? 'over' : sessionPct >= 0.8 ? 'warn' : undefined} label={`Session spend ${fmtCredits(health.arcads.sessionSpent)} of the ${fmtCredits(health.arcads.sessionCap)} credit cap`} onHero /></div>}
                    </ClassicHeroButton>
                  </>
                )}
              </div>

              {/* snapshot row */}
              <div className="mt-9 flex items-end justify-between">
                <div>
                  <h2 className="ae-section flex flex-wrap items-center gap-3">Angles{dryCampaign && <Tag>{DRY_CAMPAIGN_TAG}</Tag>}</h2>
                  <div className="text-[13px] text-[var(--p-muted)]">A snapshot of what is proven in the library.</div>
                </div>
                <Btn onClick={() => setSheet('generator')}>See all</Btn>
              </div>
              <div className="ae-angle-row mt-4">
                {(campaign?.angles.slice(0, 3) ?? []).map((a) => {
                  const proof = a.proofAdIds.map((id) => pool.find((p) => p.id === id)).filter((p): p is PoolAd => !!p);
                  const m = medianDays(proof);
                  return (
                    <CardButton key={a.id} onClick={() => void go({ sheet: 'generator', angleId: a.id })} className="min-h-[150px] p-4 text-left">
                      <div className="flex items-center gap-2 text-[12px] text-[var(--p-muted)]"><Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />{a.confidence === 'strong' ? 'Strong' : 'Plausible'}{a.selected ? ' · selected' : ''}</div>
                      <div className="mt-4 flex items-end gap-2"><Numeral value={m === null ? '—' : String(m)} size={4} /> <span className="pb-[2px] text-[12px] text-[var(--p-muted)]">days live</span></div>
                      <div className="mt-2 line-clamp-1 text-[13px] text-[var(--p-ink)]">{a.title}</div>
                      <div className="mt-3"><Gauge value={m} max={90} label={m === null ? 'No proof ads found for this angle' : `Median ${m} days live on a 0 to 90 day scale`} /></div>
                    </CardButton>
                  );
                })}
                {(campaign?.angles.length ?? 0) === 0 && (
                  <div className="ae-card-2 col-span-full p-5 text-[13px] text-[var(--p-muted)]">No angles yet. Open the Creative generator, type a concept, and the engine researches the library and proposes angles that cite live ads.</div>
                )}
              </div>
            </>
          ) : (
            <RunsTab runs={runs} campaignId={campaign?.id ?? null} readOnly={readOnly} onChange={setRuns} onOpen={(r) => (opensElsewhere(r) ? openRun(r) : void go({ sheet: 'runs', runId: r.id }))} onEmpty={() => void go({ sheet: 'generator', focus: 'concept' })} />
          )}
          </div>
        </main>

        {/* ── right rail ── */}
        <aside className="ae-dash-rail">
          <div className="grid grid-cols-2 gap-4">
            {/* S04 row 27: with no approved script the card leads to the Ad scripter instead. */}
            <CardButton onClick={() => setSheet(approvedScripts.length || readOnly ? 'ugc' : 'scripter')} className="ae-rail-card relative min-h-[236px] p-4 text-left" title={approvedScripts.length || readOnly ? 'Open the UGC studio' : 'Approve a script first: opens the Ad scripter'}>
              <div className="flex flex-1 items-center pr-9 text-[13px] leading-tight text-[var(--p-ink)]"><span>{approvedScripts.length || readOnly ? <>Make a<br />UGC video</> : <>Approve a<br />script first</>}</span></div>
              <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--p-card)]"><Plus className="h-4 w-4" strokeWidth={1.8} /></span>
              <div className="mt-3 rounded-[14px] bg-[var(--p-card)] p-3">
                <div className="whitespace-nowrap text-[12.5px] text-[var(--p-ink)]">Approved</div>
                <div className="whitespace-nowrap text-[11.5px] text-[var(--p-muted)]">{approvedScripts.length} ready</div>
              </div>
            </CardButton>
            {g ? (
              // GP1 FR-GP1.4: the rings read runs in flight and the Arcads state; the card holds its action and,
              // unconfigured, the Set up link (a link cannot sit inside a card button). A raised card, not a
              // third hero: at most two heroes per view (C22).
              <GCardRaised p={16} className="ae-rail-card ce-g-console-card relative min-h-[236px]" title={ringsLabel}>
                <div className="pr-2 text-[13px] leading-tight text-[var(--p-ink)]">Motion<br />console</div>
                <div className="flex flex-1 items-center justify-center py-2"><GRings value={inFlight} status={arcadsState} label={ringsLabel} size={76} /></div>
                <div className="ce-g-console-status text-[11.5px] leading-snug text-[var(--p-muted)]">{inFlight > 0 ? `${inFlight} in flight` : 'Nothing in flight'} · {arcadsState === 'ok' ? 'Arcads connected' : arcadsState === 'warn' ? 'key not verified' : 'Arcads not set up'}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Btn size="sm" onClick={() => (health.arcads.configured ? setConsoleOpen(true) : setSheet('connect'))}>{health.arcads.configured ? 'Open' : 'Connect'}</Btn>
                  {!health.arcads.configured && !readOnly && <SetupLink href={health.arcads.setupHref} hint="ARCADS_BASIC_AUTH" />}
                </div>
              </GCardRaised>
            ) : (
              <ClassicHeroButton tone="pink" onClick={() => (health.arcads.configured ? setConsoleOpen(true) : setSheet('connect'))} className="ae-rail-card relative min-h-[236px] p-4 text-left">
                <div className="flex flex-1 items-center pr-9 text-[13px] leading-tight text-[var(--p-on-hero-dim)]"><span>{health.arcads.configured ? 'Open the' : 'Connect'}<br />{health.arcads.configured ? 'Motion console' : 'Arcads'}</span></div>
                <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--p-on-hero-faint)] text-[var(--p-on-hero)]"><Plus className="h-4 w-4" strokeWidth={1.8} /></span>
                <div className="flex justify-center pb-1 pt-3"><ClassicRings /></div>
              </ClassicHeroButton>
            )}
          </div>

          <CardButton onClick={() => setSheet('runs')} className="w-full p-5 text-left" p={20}>
            <div className="flex items-start justify-between">
              <div className="text-[15px] text-[var(--p-ink)]">{running.length ? (running[0].kind === 'research' || running[0].kind === 'angles' || running[0].kind === 'script' ? 'Working' : 'Your video is rendering') : latestDone ? 'Nothing is pending' : 'Nothing is rendering'}</div>
              {running.length > 0 && <Tag>{running.length}</Tag>}
            </div>
            {g ? (
              <div className="mt-4"><GBigNumber value={running.length ? fmtMs(elapsedAt(running[0], now)) : '0'} unit={running.length ? 'elapsed' : 'in flight'} /></div>
            ) : (
              <div className="mt-4 flex items-end gap-2"><span className="ae-title ae-tick text-[34px] leading-none text-[var(--p-ink)]">{running.length ? fmtMs(elapsedAt(running[0], now)) : '0'}</span><span className="pb-1 text-[12px] text-[var(--p-muted)]">{running.length ? 'elapsed' : 'in flight'}</span></div>
            )}
            {/* S07 F19 to F22: elapsed against the kind's typical time (tick) and timeout (ring). */}
            <div className="mt-4"><RenderTrack runs={runs} now={now} /></div>
            <div className="mt-3 text-[11.5px] leading-snug text-[var(--p-muted)]">{renderCaption}</div>
          </CardButton>

          <div className="ae-rail-wide">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="ae-section !text-[22px]">Ready for you</h2>
                <div className="text-[12.5px] text-[var(--p-muted)]">Scripts and briefs you can ship.</div>
              </div>
              <Btn onClick={() => setSheet('briefings')}>See all</Btn>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {readyOrder(campaign?.scripts ?? [], campaign?.briefs ?? []).slice(0, 2).map((s, i) => {
                const v = s.versions.find((x) => x.n === s.approvedVersion) ?? s.versions.at(-1);
                const angle = campaign?.angles.find((a) => a.id === s.angleId);
                const brief = campaign?.briefs.find((b) => b.scriptId === s.id);
                const label = `${angle?.title ?? 'Script'}${brief ? ', open the brief' : ', open the script'}`;
                const state = brief ? (brief.status === 'sent' ? 'sent' : brief.status === 'ready' ? 'ready' : 'draft') : s.approvedVersion !== null ? 'approved' : 'draft';
                return (
                  <div key={s.id} className="ae-card-2 ae-ready-card relative min-h-[190px] overflow-hidden p-3 text-left">
                    {/* F26: the card opens this brief (or this script), not the newest one. */}
                    <OverlayButton label={label} onClick={() => void go(brief ? { sheet: 'briefings', briefId: brief.id } : { sheet: 'scripter', angleId: s.angleId })} />
                    {/* F23, F24: the badge is the brief's stored status, and on a brief it is the control. */}
                    <div className="absolute inset-x-3 top-3 z-[1]">
                      {brief ? (
                        <BriefStatusControl status={brief.status} disabled={readOnly} disabledReason="Sample data: actions are off" onChange={(st) => void setBriefStatus(brief.id, st)} />
                      ) : s.approvedVersion !== null ? (
                        <Badge className="pointer-events-none" data-state="approved">Approved</Badge>
                      ) : (
                        <Tag className="pointer-events-none" data-state="draft">Draft</Tag>
                      )}
                    </div>
                    {/* S04 B19: the blob colour is the item's state, not its position. */}
                    {g ? (
                      <span className="pointer-events-none absolute" style={{ left: '22%', top: '26%' }}><GBlob state={state} label={`${state === 'ready' ? 'Brief ready' : state === 'sent' ? 'Sent' : state === 'approved' ? 'Approved' : 'Draft'}`} size={70} /></span>
                    ) : (
                      <>
                        <span className="ae-blob" data-state={state} style={{ left: '22%', top: '26%', width: 70, height: 70 }} />
                        <span className="ae-blob ae-blob-deep" data-state={state} style={{ left: '38%', top: '34%', width: 50, height: 50 }} />
                      </>
                    )}
                    <div className="pointer-events-none absolute inset-x-3 bottom-3">
                      <div className="line-clamp-1 text-[11.5px] text-[var(--p-muted)]">{angle?.title ?? 'Script'}</div>
                      <div className="text-[16px] text-[var(--p-ink)]">{v ? `${v.targetSeconds ?? '—'}s · ${v.wordCount} words` : 'draft'}</div>
                    </div>
                  </div>
                );
              })}
              {(campaign?.scripts.length ?? 0) === 0 && <div className="ae-card-2 col-span-2 p-4 text-[12.5px] text-[var(--p-muted)]">No scripts yet. Select angles, then write them in the Ad scripter.</div>}
            </div>
          </div>
        </aside>
      </div>

      {/* ── sheets ── */}
      {sheet && sheet !== 'runs' && sheet !== 'proof' && sheet !== 'credits' && sheet !== 'connect' && (
        <EngineSheet title={nav.find((n) => n.key === sheet)?.label ?? ''} onClose={closeSheet} backLabel={backLabel}>
          {sheet === 'generator' && <CreativeGenerator key={targetKey} fresh={genFresh} focus={t?.focus ?? (t?.angleId ? { angleId: t.angleId } : undefined)} proofOnly={t?.proofOnly ?? false} onProofOnly={(on) => setTarget((x) => (x?.sheet === 'generator' ? { ...x, proofOnly: on } : { sheet: 'generator', proofOnly: on }))} products={products} onConnect={() => setSheet('connect')} campaign={campaign} campaigns={campaigns} health={health} readOnly={readOnly} onCampaign={onCampaign} onSwitch={(id) => void load(id)} onContinue={() => setSheet('scripter')} />}
          {sheet === 'scripter' && <Scripter key={targetKey} onGenerator={() => void go({ sheet: 'generator', focus: campaign?.angles.length ? 'angles' : 'concept' })} initialAngleId={t?.angleId} initialScriptId={t?.scriptId} campaign={campaign} readOnly={readOnly} onCampaign={onCampaign} onUgc={() => setSheet('ugc')} onMotion={() => { setSheet(null); setReturnTo(null); setConsoleOpen(true); }} onBrief={() => setSheet('briefings')} />}
          {sheet === 'briefings' && <Briefings key={targetKey} onScripter={() => setSheet('scripter')} campaign={campaign} initialBriefId={t?.briefId} readOnly={readOnly} onStatus={(id, st) => void setBriefStatus(id, st)} />}
          {sheet === 'ugc' && <UgcStudio key={targetKey} onScripter={() => setSheet('scripter')} highlightAssetId={t?.assetId} catalogOverride={sample?.catalog ?? null} campaign={campaign} health={health} readOnly={readOnly} onCampaign={onCampaign} onRuns={setRuns} onConnect={() => setSheet('connect')} />}
        </EngineSheet>
      )}
      {sheet === 'runs' && <RunsDrawer onOpenRun={openRun} runs={runs} focusRunIds={t?.runIds ?? (t?.runId ? [t.runId] : undefined)} readOnly={readOnly} onClose={closeSheet} onChange={setRuns} campaignId={campaign?.id ?? null} kind={runsKind} onAllKinds={() => setRunsKind(null)} backLabel={backLabel} />}
      {sheet === 'proof' && <ProofDrawer sample={readOnly} note={dryCampaign ? DRY_CAMPAIGN_TAG : null} saved={saved} watchlist={watchlist} signals={signals} onClose={() => setSheet(null)} />}
      {sheet === 'credits' && <CreditsDrawer health={health} readOnly={readOnly} onRefresh={refreshHealth} onConnect={() => setSheet('connect')} onClose={closeSheet} backLabel={backLabel} />}
      {sheet === 'connect' && <ConnectArcads health={health} readOnly={readOnly} onChanged={refreshHealth} onClose={closeSheet} backLabel={backLabel} />}
      {deleteTarget && <DeleteCampaignDialog target={deleteTarget} busy={deleteBusy} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />}
      <span className="sr-only" aria-live="polite">{announce}</span>
      {consoleOpen && <MotionConsole initialAssetId={t?.sheet === 'console' ? t.assetId : undefined} campaign={campaign} health={health} runs={runs} readOnly={readOnly} onClose={closeConsole} onConnect={() => openFromConsole('connect')} onCampaign={onCampaign} onRuns={setRuns} campaigns={campaigns} onSwitchCampaign={(id) => void load(id)} onOpenSheet={openFromConsole} />}
    </div>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

/**
 * S03 FR-5: re-run a dry campaign's research for real. A paid action, so it
 * is two clicks: the first names the cost source and the most it can spend,
 * the second runs (§3.1.7). Disabled with Set up when Foreplay is missing.
 * Escape does not cancel a paid run. Angles are replaced; scripts, briefs and
 * delivered files stay. The server flips the campaign to live.
 */
function RerunResearch({ campaign, health, onCampaign }: { campaign: Campaign; health: HealthSnapshot; onCampaign: (c: Campaign) => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const max = DEPTH_BUDGET.standard.maxCalls;
  if (!health.foreplay.configured) {
    return (
      <div className="mt-4 space-y-2">
        <Btn size="sm" disabled title="Research needs the Foreplay key" disabledReason="Research needs the Foreplay key">Re-run research live</Btn>
        <div><SetupLink href={health.foreplay.setupHref} hint="FOREPLAY_API_KEY" label="Set up Foreplay" /></div>
      </div>
    );
  }
  const run = async () => {
    setPhase('running');
    setError(null);
    try {
      const researched = (await api.research(campaign.id, 'standard')).campaign;
      onCampaign(researched);
      onCampaign((await api.angles(campaign.id)).campaign);
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed.');
      setPhase('error');
    }
  };
  return (
    <div className="mt-4" data-rerun-research>
      {phase === 'running' ? (
        <Progress text="Researching: planning searches and keeping only ads still running" />
      ) : phase === 'confirm' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--p-ink)]">{health.dry ? 'Dry run: fixtures again, nothing is charged.' : `Spends up to ${max} Foreplay credits.`}</span>
          <Btn tone="ink" size="sm" onClick={() => void run()}>Run</Btn>
          <Btn size="sm" onClick={() => setPhase('idle')}>Cancel</Btn>
        </div>
      ) : (
        <Btn size="sm" onClick={() => setPhase('confirm')} title={`Standard depth, up to ${max} Foreplay credits; asks before it spends`}>Re-run research live</Btn>
      )}
      {error && <ErrorLine text={error} />}
    </div>
  );
}

function medianDays(ads: { daysRunning: number }[]): number | null {
  if (ads.length === 0) return null;
  const d = ads.map((a) => a.daysRunning).sort((a, b) => a - b);
  const m = Math.floor(d.length / 2);
  return d.length % 2 ? d[m] : Math.round((d[m - 1] + d[m]) / 2);
}

/**
 * The Runs tab (S04 B27, SPEC C24): the full-page list, the same rows and
 * actions as the Runs drawer. A row opens what the run made; a run still in
 * flight (or failed) opens in the drawer, where it is ringed.
 */
function RunsTab({ runs, campaignId, readOnly, onChange, onOpen, onEmpty }: { runs: ResolvedRun[]; campaignId: string | null; readOnly: boolean; onChange: (r: ResolvedRun[]) => void; onOpen: (r: ResolvedRun) => void; onEmpty: () => void }) {
  const { busy, error, refresh, abandon } = useRunActions(campaignId, readOnly, onChange);
  // F37: under GladOS the tab already says "Runs", so the card drops its repeated h1;
  // the caption and Check now share the card's header row. Classic keeps its heading.
  const g = useG();
  return (
    <div className="ae-card p-5">
      <div className={g ? 'flex items-center justify-between gap-3' : 'flex items-start justify-between gap-3'}>
        <div>
          {!g && <h1 className="ae-section !text-[30px]">Runs</h1>}
          <div className="text-[12.5px] text-[var(--p-muted)]">Status is derived on every read; nothing is marked done by this page.</div>
        </div>
        <CheckNow busy={busy === 'refresh'} readOnly={readOnly} onClick={() => void refresh()} />
      </div>
      {error && <ErrorLine text={error} />}
      {runs.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 py-6 text-[13px] text-[var(--p-muted)]">No runs yet. <Btn size="sm" onClick={onEmpty}>Open the Creative generator</Btn></div>
      ) : (
        <ul className="mt-4 space-y-2">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} readOnly={readOnly} busy={busy === r.id} onOpen={onOpen} openLabel={opensElsewhere(r) ? 'Open what this run made' : 'Open this run in the Runs drawer'} onAbandon={(id) => void abandon(id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether an asset is one the Motion console can put on stage (SPEC G3). */
function isMotionAsset(campaign: Campaign | null, assetId: string | undefined): boolean {
  if (!campaign || !assetId) return false;
  const a = campaign.assets.find((x) => x.id === assetId);
  return !!a && campaign.generations.find((g) => g.id === a.generationId)?.kind === 'motion';
}
