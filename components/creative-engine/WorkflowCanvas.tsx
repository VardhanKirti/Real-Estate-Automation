'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OBtn, OInput, useG } from '@/components/creative-engine/skin';
import { BRAND } from '@/lib/brand';
import { createPortal } from 'react-dom';
import { ChevronDown, CircleDollarSign, CircleHelp, Layers, LayoutGrid, Maximize2, Minimize2, Minus, MoreHorizontal, Plus, Redo2, RotateCcw, Scan, Square, SquarePlus, Trash2, Undo2, X } from 'lucide-react';
import type { Campaign, ConsoleControls, NodeType, PortType, Workflow, WorkflowEdge, WorkflowNode } from '@/lib/creative-engine/schemas';
import { IMAGE_MODELS, VIDEO_MODELS } from '@/lib/creative-engine/schemas';
import { NODE_SPECS, blockingProblems, isPaid, newEdge, newNode, type GraphProblem, type NodeStatus, type TemplateSummary } from '@/lib/creative-engine/workflow';
import { History, applyConnect, connectVerdict, copyNodes, duplicateNodes, edgeType, firstInput, firstOutput, moveNodes, nodesInRect, parseClip, pasteNodes, reconnect, removeEdges, removeNodes, snap, tidy, toLayout, type Clip, type ConnectVerdict, type PaletteContext, type RunScope } from '@/lib/creative-engine/workflow-edit';
import type { RunPlan } from '@/lib/creative-engine/workflow-run';
import type { WorkflowVersion } from '@/lib/creative-engine/store';
import { SAMPLE_CAMPAIGN_ID, sampleWorkflow } from '@/lib/creative-engine/demo';
import { DURATION_RULES } from '@/lib/creative-engine/duration';
import { fmtCredits, plural } from '@/lib/creative-engine/format';
import { MODEL_RULES } from '@/lib/arcads/validate';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import type { Catalog } from '@/lib/arcads/catalog';
import type { ArcadsSituation, AssetResponse } from '@/lib/arcads/client';
import { api, ApiError, type HealthSnapshot } from '@/components/creative-engine/api';
import { CheckRow, SelectRow, SliderRow, TextAreaRow, TextRow } from '@/components/creative-engine/octane-rows';
import { SpendGate } from '@/components/creative-engine/SpendGate';
import { ToastStack } from '@/components/ui/Toast';
import { NODE_ICON } from '@/components/creative-engine/workflow/icons';
import { Palette } from '@/components/creative-engine/workflow/Palette';
import { ContextMenu, type MenuItem } from '@/components/creative-engine/workflow/ContextMenu';
import { EmptyCanvas, StartCard } from '@/components/creative-engine/workflow/StartCard';
import { COACH_KEY, COACH_STEPS, Coach } from '@/components/creative-engine/workflow/Coach';
import { Shortcuts } from '@/components/creative-engine/workflow/Shortcuts';
import { VersionsPanel } from '@/components/creative-engine/workflow/Versions';
import { ConfirmDialog, Lightbox, type LightboxAsset } from '@/components/creative-engine/workflow/Dialogs';
import { readLocal, useEscapeLayer, useStageToasts, writeLocal } from '@/components/creative-engine/workflow/hooks';

/**
 * Workflow builder — Arcads' builder logic with our UI (PLAN, approved
 * 2026-10-01). A free canvas: double-click (or Add node, Cmd/Ctrl+K, /)
 * for a searchable palette, drag a node by its head or body, drag from an
 * output port to an input port to connect. Dropping on an occupied single
 * input replaces its link; pressing a linked input picks the link up;
 * dropping on empty canvas opens the palette to connect a new node. Links
 * are selectable (click, Delete, right-click menu, hover "×"). Click a node
 * for its settings, Run to execute in dependency order. Status rings are
 * derived on read from the engine; previews are the delivered assets.
 *
 * View (S05b FR-1 to FR-9): the docked stage is clamp(420px, 56vh, 760px)
 * with a resize grip; Full screen portals the builder over the console;
 * wheel and pinch are one native non-passive listener (pan only once the
 * canvas has focus, zoom with Ctrl/Cmd); every drag uses pointer capture.
 *
 * History and clarity (FR-20 to FR-37, FR-45 to FR-53): every edit is one
 * undo step; Shift+click and Shift+drag select several nodes, which move,
 * copy, paste, nudge and delete together; a start card, empty-canvas chips
 * and three coach marks explain where to begin; problems mark their nodes.
 *
 * Run (FR-54 to FR-66): Run always opens the cost gate (SpendGate) with the
 * server's own plan for the chosen scope (all, failed only, from a node);
 * while running it becomes Stop. Versions are saved on every run and on
 * Save version. Autosave sends only the layout with the design stamp it was
 * based on; a newer design elsewhere shows Reload / Keep mine.
 */

const NODE_W = 224;
const PORT_GAP = 22;
const ASPECT6 = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const K_MIN = 0.25;
const K_MAX = 2;
const FIT_FLOOR = 0.6;
const FIT_PAD = 48;
const H_MIN = 320;
const H_KEY = 'ae-wf-height';
const RECENT_KEY = 'ae-wf-recent';
const EDGE_EDGE = 32; // auto-pan band at the stage edge
const AUTO_PAN = 12; // px per frame at the very edge

type Props = { campaign: Campaign | null; health: HealthSnapshot; runs: ResolvedRun[]; readOnly?: boolean; consoleControls: ConsoleControls; onRuns: (r: ResolvedRun[]) => void; onCampaign: (c: Campaign) => void; onNotice: (m: string) => void; /** opens the console's Arcads connect sheet (Run's "Connect Arcads") */ onConnect?: () => void; /** opens the console's campaign picker (no-campaign state) */ onChooseCampaign?: () => void; /** the picker's button text ("Choose a campaign", or "Create a campaign" when there is none) */ chooseLabel?: string; /** opens the Scripter (a template that needs an approved script) */ onScripter?: () => void };
type View = { x: number; y: number; k: number };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'node'; ids: string[]; sx: number; sy: number; origin: Record<string, { x: number; y: number }>; before: Workflow; moved: boolean }
  | { kind: 'wire'; from: string; port: string; type: PortType; x: number; y: number; detached: WorkflowEdge | null; sx: number; sy: number; moved: boolean }
  | { kind: 'marquee'; x1: number; y1: number; x2: number; y2: number; base: string[] }
  | null;
type PaletteState = { at: { x: number; y: number }; wx: number; wy: number; title?: string; ctx?: PaletteContext; connect?: { from: string; port: string; type: PortType; detached: WorkflowEdge | null }; insert?: WorkflowEdge; feed?: { to: string; toPort: string; type: PortType } };
type MenuState = { at: { x: number; y: number }; label: string; items: MenuItem[]; wide?: boolean };
type Target = { nodeId: string; port: string; key: string };
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type GateState = { scope: RunScope; nodeId: string | null; plan: RunPlan | null; error: string | null; capAsk: string | null };

const RUNTIME = ['runId', 'outputAssetId', 'outputText', 'error', 'resolvedAt'] as const;
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); };
const wirePath = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
/**
 * Where a link's "×" sits: the bezier midpoint of wirePath (t = 0.5),
 * pushed `off` world units off the curve along its normal, so the button
 * never covers the link itself (a click on the link always selects it).
 */
const wireMid = (a: { x: number; y: number }, b: { x: number; y: number }, off = 0) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const p1 = { x: a.x + dx, y: a.y }; const p2 = { x: b.x - dx, y: b.y };
  const mid = { x: (a.x + 3 * p1.x + 3 * p2.x + b.x) / 8, y: (a.y + b.y) / 2 };
  const tx = 0.75 * (p1.x - a.x) + 1.5 * (p2.x - p1.x) + 0.75 * (b.x - p2.x); const ty = 1.5 * (p2.y - p1.y);
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len; let ny = tx / len;
  if (ny > 0) { nx = -nx; ny = -ny; } // the side above the curve
  return { x: mid.x + nx * off, y: mid.y + ny * off };
};
const DROP: Record<ConnectVerdict['kind'], string> = { add: 'ok', replace: 'replace', noop: 'same', refuse: 'no' };
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const hhmm = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (!Number.isFinite(s)) return ''; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`; };
const stampOf = (w: Workflow) => w.layoutAt ?? w.updatedAt;
const versionToWorkflow = (v: WorkflowVersion, live: Workflow): Workflow => ({ ...live, name: v.name, runStartedAt: null, runScope: null, nodes: v.nodes.filter((n): n is typeof n & { type: NodeType } => n.type in NODE_SPECS).map((n) => ({ ...n, type: n.type as NodeType, runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null })), edges: v.edges });

export function WorkflowCanvas({ campaign, health, runs, readOnly = false, consoleControls, onRuns, onCampaign, onNotice, onConnect, onChooseCampaign, chooseLabel = 'Choose a campaign', onScripter }: Props) {
  const uid = useId().replace(/:/g, '');
  const [list, setList] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [approvedScript, setApprovedScript] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [engineDry, setEngineDry] = useState(health.dry);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [status, setStatus] = useState<Record<string, NodeStatus>>({});
  const [problems, setProblems] = useState<GraphProblem[]>([]);
  const [selNodes, setSelNodes] = useState<string[]>([]);
  const [selEdges, setSelEdges] = useState<string[]>([]);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 1 });
  const [animate, setAnimate] = useState(false);
  const [full, setFull] = useState(false);
  // GP4 FR-GP4.3: the canvas is an application surface and the grip a separator, not kit control roles; their
  // controls inside are kit buttons (the source guard checks them), so under the kit both carry an exemption reason.
  const g = useG();
  const [stageH, setStageH] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null); // "nodeId|port" under a wire drag
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [discard, setDiscard] = useState<{ go: () => void } | null>(null); // "Discard unsaved changes?" (edge case 8)
  const [lightbox, setLightbox] = useState<LightboxAsset | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<Workflow | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // the workflow name being edited inline
  const [renamingNode, setRenamingNode] = useState<{ id: string; value: string } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [coach, setCoach] = useState<number | null>(null);
  const [versions, setVersions] = useState<{ list: WorkflowVersion[]; loading: boolean } | null>(null);
  const [preview, setPreview] = useState<WorkflowVersion | null>(null);
  const [legend, setLegend] = useState(false);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [, setTick] = useState(0); // re-render when history changes
  const { items: toasts, toast, dismiss } = useStageToasts();
  /* Autosave. Only the layout is ever sent (ids, titles, positions, settings,
     edges); the server keeps runtime fields, so a stale save can't clear a
     runId and make the engine pay for a node twice (S05b R10). `pending` is
     the edit waiting out the debounce, `inflight` the PATCH on the wire, and
     `current` the workflow the canvas shows: a reply for any other workflow
     is dropped, so a switch or delete never paints the wrong state. `base`
     is the design stamp the canvas last saw from the server (FR-28). */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Workflow | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const current = useRef<string | null>(null);
  const base = useRef<string | null>(null);
  const failed = useRef<Workflow | null>(null);
  /* Live mirrors for native listeners (wheel, keys, rAF), which are bound once. */
  const wfRef = useRef<Workflow | null>(null);
  wfRef.current = wf;
  const viewRef = useRef<View>(view);
  const hist = useRef(new History<Workflow>());
  const spaceRef = useRef(false);
  const altRef = useRef(false);
  const hintShown = useRef(false);
  const roShown = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverAt = useRef<{ x: number; y: number } | null>(null);
  const clip = useRef<Clip | null>(null);
  const pendingCentre = useRef<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockedH = useRef<number | null>(null);

  const campaignId = campaign?.id ?? null;
  const sample = readOnly && campaignId === SAMPLE_CAMPAIGN_ID;
  /** No edits: the read-only sample, or a version preview on screen. */
  const locked = readOnly || !!preview;
  const shown = useMemo(() => (preview && wf ? versionToWorkflow(preview, wf) : wf), [preview, wf]);

  const roNote = () => { if (!readOnly || roShown.current) return; roShown.current = true; toast({ text: sample ? 'Sample is read only' : 'Read only' }); };

  /* ── view ── */
  const updateView = useCallback((next: View | ((v: View) => View), anim = false) => {
    const v = typeof next === 'function' ? next(viewRef.current) : next;
    viewRef.current = v;
    setView(v);
    if (anim && !reducedMotion()) { setAnimate(true); setTimeout(() => setAnimate(false), 200); }
  }, []);
  const clampK = (k: number) => Math.min(K_MAX, Math.max(K_MIN, k));
  const zoomAt = useCallback((cx: number, cy: number, factor: number, anim = false) => {
    const el = stageEl; if (!el) return;
    const r = el.getBoundingClientRect(); const mx = cx - r.left; const my = cy - r.top;
    updateView((v) => { const k = clampK(v.k * factor); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }; }, anim);
  }, [stageEl, updateView]);
  const zoomCentre = (factor: number) => { if (!stageEl) return; const r = stageEl.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor, true); };
  const zoomTo = (k: number) => zoomCentre(k / viewRef.current.k);
  const nodeSize = useCallback((n: WorkflowNode) => { const d = stageEl?.querySelector<HTMLElement>(`[data-node-id="${n.id}"]`); return { w: d?.offsetWidth || NODE_W, h: d?.offsetHeight || 170 }; }, [stageEl]);
  /** Frame the given nodes (or all) from measured sizes: 48px padding, never above 100%, never below 60% (then it frames the left column). */
  const fit = useCallback((ids?: string[], anim = true) => {
    const el = stageEl; const w = wfRef.current;
    if (!el || !w || !w.nodes.length || !el.clientWidth) return;
    const pick = ids && ids.length ? w.nodes.filter((n) => ids.includes(n.id)) : w.nodes;
    if (!pick.length) return;
    const boxes = pick.map((n) => ({ n, ...nodeSize(n) }));
    const minX = Math.min(...boxes.map((b) => b.n.x)); const minY = Math.min(...boxes.map((b) => b.n.y));
    const maxX = Math.max(...boxes.map((b) => b.n.x + b.w)); const maxY = Math.max(...boxes.map((b) => b.n.y + b.h));
    const W = el.clientWidth; const H = el.clientHeight;
    let k = Math.min(1, (W - 2 * FIT_PAD) / Math.max(1, maxX - minX), (H - 2 * FIT_PAD) / Math.max(1, maxY - minY));
    if (k >= FIT_FLOOR) { updateView({ k, x: (W - (maxX - minX) * k) / 2 - minX * k, y: (H - (maxY - minY) * k) / 2 - minY * k }, anim); return; }
    // too big for the floor: show the graph's left column at 60%, the rest is a pan away
    k = FIT_FLOOR;
    const col = boxes.filter((b) => b.n.x <= minX + NODE_W / 2);
    const top = Math.min(...col.map((b) => b.n.y)); const bottom = Math.max(...col.map((b) => b.n.y + b.h));
    const y = (bottom - top) * k <= H - 2 * FIT_PAD ? H / 2 - ((top + bottom) / 2) * k : FIT_PAD - top * k;
    updateView({ k, x: FIT_PAD - minX * k, y }, anim);
  }, [stageEl, updateView, nodeSize]);
  /** Fit once the stage is laid out and every node is in the DOM (fitWhenLaidOut). */
  const fitSoon = useCallback(() => {
    let tries = 0;
    const step = () => {
      const el = stageEl; const w = wfRef.current;
      if (el && w && el.clientWidth > 0 && el.querySelectorAll('[data-node-id]').length >= w.nodes.length) { fit(undefined, false); return; }
      if (++tries < 30) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [stageEl, fit]);
  const fitRef = useRef(fitSoon);
  fitRef.current = fitSoon;

  const adopt = (w: Workflow) => { setWf(w); wfRef.current = w; base.current = stampOf(w); };
  const refresh = useCallback(async (id: string, doFit = false) => {
    try {
      const v = await api.workflow(id);
      if (current.current !== id) return;
      // a refresh during an edit keeps the edit's layout; only the engine's runtime fields come in
      const mine = pending.current ?? failed.current;
      if (mine && mine.id === id) { const srv = new Map(v.workflow.nodes.map((n) => [n.id, n])); setWf((w) => (w && w.id === id ? { ...w, runStartedAt: v.workflow.runStartedAt, runScope: v.workflow.runScope, deliveries: v.workflow.deliveries, nodes: w.nodes.map((n) => { const s = srv.get(n.id); return s ? { ...n, runId: s.runId, outputAssetId: s.outputAssetId, outputText: s.outputText, error: s.error, resolvedAt: s.resolvedAt } : n; }) } : w)); }
      else { setWf(v.workflow); wfRef.current = v.workflow; }
      base.current = stampOf(v.workflow);
      setStatus(v.status); setProblems(v.problems); if (doFit) fitRef.current();
    } catch { /* keep */ }
  }, []);
  const clearSel = () => { setSelNodes([]); setSelEdges([]); };
  const resetEditor = () => { hist.current.clear(); clearSel(); setPalette(null); setMenu(null); setHoverEdge(null); setPreview(null); setVersions(null); setRenamingNode(null); setConflict(null); setTick((t) => t + 1); };
  useEffect(() => {
    resetEditor(); setListLoaded(false);
    // no campaign (deleted, or none picked): drop the last campaign's workflow so the canvas never shows a stale graph
    if (!campaignId) { cancelSave(); current.current = null; setList([]); setWf(null); wfRef.current = null; setStatus({}); setProblems([]); return; }
    if (readOnly) {
      // the read-only sample shows its one workflow; nothing is fetched or written (FR-66)
      if (sample) { const s = sampleWorkflow(); current.current = s.id; setList([s]); adopt(s); setStatus({}); setProblems([]); fitRef.current(); }
      return;
    }
    api.workflows(campaignId).then((r) => {
      setList(r.workflows); setTemplates(r.templates); setApprovedScript(!!r.approvedScript); if (typeof r.dry === 'boolean') setEngineDry(r.dry); setListLoaded(true);
      if (r.workflows[0]) { current.current = r.workflows[0].id; void refresh(r.workflows[0].id, true); }
      else { current.current = null; setWf(null); wfRef.current = null; }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, readOnly, refresh]);
  // the Dashboard's clock delivers runs; every change re-reads the workflow so rings and previews follow
  const runKey = runs.map((r) => `${r.id}:${r.status}`).join(',');
  useEffect(() => { if (wf?.runStartedAt && !readOnly) void refresh(wf.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [runKey]);
  // while a run is live, read it every 4s too (local steps resolve between run-list changes)
  const live = Object.values(status).some((s) => s === 'running' || s === 'ready');
  useEffect(() => { if (!live || !wf || readOnly) return; const t = setInterval(() => void refresh(wf.id), 4000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [live, wf?.id]);

  // the docked height a viewer chose, if any (FR-2)
  useEffect(() => { const raw = readLocal(H_KEY); const n = raw ? Number(raw) : NaN; if (Number.isFinite(n) && n >= H_MIN) setStageH(Math.min(n, window.innerHeight - 160)); }, []);
  // coach marks once per viewer, on the first workflow they open with nodes (FR-48)
  useEffect(() => { if (wf && wf.nodes.length && !locked && coach === null && readLocal(COACH_KEY) !== 'done') setCoach(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wf?.id, wf?.nodes.length]);
  const endCoach = () => { setCoach(null); writeLocal(COACH_KEY, 'done'); };

  /** Send one layout now, with the design stamp it was based on. The reply only lands if the canvas still shows that workflow; runtime fields come from the server. */
  const send = (next: Workflow, force = false): Promise<void> => {
    const id = next.id;
    setSaveState('saving');
    const p = api.patchWorkflow(id, { name: next.name, layout: toLayout(next), ...(base.current ? { baseUpdatedAt: base.current } : {}), ...(force ? { force: true } : {}) }).then(
      (v) => {
        if (current.current !== id) return;
        base.current = stampOf(v.workflow); failed.current = null;
        setStatus(v.status); setProblems(v.problems);
        if (!pending.current && !saveTimer.current) setSaveState('saved');
        const srv = new Map(v.workflow.nodes.map((n) => [n.id, n]));
        setWf((w) => (w && w.id === id ? { ...w, runStartedAt: v.workflow.runStartedAt, runScope: v.workflow.runScope, deliveries: v.workflow.deliveries, updatedAt: v.workflow.updatedAt, layoutAt: v.workflow.layoutAt, nodes: w.nodes.map((n) => { const s = srv.get(n.id); return s ? { ...n, runId: s.runId, outputAssetId: s.outputAssetId, outputText: s.outputText, error: s.error, resolvedAt: s.resolvedAt } : n; }) } : w));
        setList((l) => l.map((x) => (x.id === id ? { ...x, name: v.workflow.name, nodes: v.workflow.nodes, updatedAt: v.workflow.updatedAt } : x)));
      },
      (err: unknown) => {
        if (current.current === id) {
          if (err instanceof ApiError && err.kind === 'conflict' && err.body.workflow) { setConflict(err.body.workflow as Workflow); failed.current = next; setSaveState('error'); }
          else { failed.current = next; setSaveState('error'); }
        }
        throw err;
      },
    );
    const settled: Promise<void> = p.catch(() => {}).finally(() => { if (inflight.current === settled) inflight.current = null; });
    inflight.current = settled;
    return p;
  };
  const save = (next: Workflow) => {
    setWf(next); wfRef.current = next;
    if (locked) return;
    pending.current = next; failed.current = null;
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; const n = pending.current; pending.current = null; if (n) send(n).catch(() => {}); }, 400);
  };
  /** Drop the debounced edit without sending it (the workflow is being deleted). */
  const cancelSave = () => { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = null; pending.current = null; };
  /** Send the debounced edit now (before a run, a switch or a new workflow). Rejects when that save fails. */
  const flushSave = async () => { const n = pending.current; cancelSave(); if (n) await send(n); };
  const retry = () => { const n = failed.current ?? wfRef.current; if (n) send(n).catch(() => {}); };
  // leaving the page while a save is in flight or failed asks first (FR-27)
  const unsaved = saveState === 'pending' || saveState === 'saving' || saveState === 'error';
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [unsaved]);
  /** Conflict (FR-28): take the other tab's copy, or send mine over it. */
  const reloadTheirs = () => { const c = conflict; if (!c) return; setConflict(null); failed.current = null; cancelSave(); hist.current.clear(); adopt(c); setSaveState('saved'); void refresh(c.id); setTick((t) => t + 1); };
  const keepMine = () => { const mine = failed.current ?? wfRef.current; setConflict(null); if (mine) send(mine, true).catch(() => {}); };

  /* ── history: every structural edit goes through commit, so Undo restores it ── */
  const commit = (next: Workflow, opts: { before?: Workflow; mergeKey?: string; label?: string } = {}) => {
    const before = opts.before ?? wfRef.current;
    if (!before) return;
    if (locked) { roNote(); return; }
    hist.current.push(before, opts.mergeKey, Date.now(), opts.label ?? 'edit');
    save(next);
    setTick((t) => t + 1);
  };
  /** A snapshot's layout with the live runtime fields (runtime is the engine's, never the history's). */
  const withRuntime = (snap: Workflow, live: Workflow): Workflow => {
    const byId = new Map(live.nodes.map((n) => [n.id, n]));
    return { ...snap, runStartedAt: live.runStartedAt, runScope: live.runScope, deliveries: live.deliveries, updatedAt: live.updatedAt, layoutAt: live.layoutAt, nodes: snap.nodes.map((n) => { const l = byId.get(n.id); if (!l) return n; const r = { ...n }; for (const k of RUNTIME) (r as Record<string, unknown>)[k] = l[k]; return r; }) };
  };
  const travel = (dir: 'undo' | 'redo') => {
    const live = wfRef.current; if (!live) return;
    if (locked) { roNote(); return; }
    const label = dir === 'undo' ? hist.current.undoLabel : hist.current.redoLabel;
    const snap = dir === 'undo' ? hist.current.undo(live) : hist.current.redo(live);
    if (!snap) return;
    const next = withRuntime(snap, live);
    save(next);
    const ids = new Set(next.nodes.map((n) => n.id)); const eids = new Set(next.edges.map((e) => e.id));
    setSelNodes((s) => s.filter((x) => ids.has(x))); setSelEdges((s) => s.filter((x) => eids.has(x)));
    setTick((t) => t + 1);
    if (label) toast({ text: `${dir === 'undo' ? 'Undid' : 'Redid'}: ${label}`, ms: 1800 });
  };
  const undoRef = useRef(() => travel('undo'));
  undoRef.current = () => travel('undo');
  const undoAction = { label: 'Undo', onClick: () => undoRef.current() };

  const patchNode = (id: string, patch: Partial<WorkflowNode>, mergeKey?: string, label = 'change settings') => { const w = wfRef.current; if (!w) return; commit({ ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }, { mergeKey, label }); };
  const patchSettings = (id: string, patch: Record<string, unknown>) => { const n = wfRef.current?.nodes.find((x) => x.id === id); if (!n) return; patchNode(id, { settings: { ...n.settings, ...patch } }, `settings:${id}:${Object.keys(patch).join(',')}`); };
  const deleteEdges = (ids: string[]) => {
    const w = wfRef.current;
    if (!w || !ids.length) return;
    if (locked) { roNote(); return; }
    commit(removeEdges(w, ids), { label: ids.length === 1 ? 'remove link' : 'remove links' });
    setSelEdges((s) => s.filter((x) => !ids.includes(x))); setHoverEdge(null);
    toast({ text: ids.length === 1 ? 'Link removed' : `${ids.length} links removed`, tone: 'ok', action: undoAction, ms: 5000 });
  };
  const deleteNodes = (ids: string[]) => {
    const w = wfRef.current;
    if (!w || !ids.length) return;
    if (locked) { roNote(); return; }
    const inFlight = w.nodes.some((n) => ids.includes(n.id) && n.runId && status[n.id] === 'running');
    commit(removeNodes(w, ids), { label: ids.length === 1 ? 'remove node' : 'remove nodes' });
    setSelNodes((s) => s.filter((x) => !ids.includes(x)));
    toast({ text: `${ids.length === 1 ? `Removed ${w.nodes.find((n) => n.id === ids[0])?.title ?? 'the node'}` : `${ids.length} nodes removed`}${inFlight ? '. A request was in flight; its result still lands in the campaign' : ''}`, tone: 'ok', action: undoAction, ms: 5000 });
  };
  const deleteSelection = () => {
    const w = wfRef.current;
    if (!w) return;
    if (locked) { roNote(); return; }
    if (selNodes.length && selEdges.length) { commit(removeNodes(removeEdges(w, selEdges), selNodes), { label: 'remove selection' }); clearSel(); toast({ text: 'Selection removed', tone: 'ok', action: undoAction, ms: 5000 }); }
    else if (selNodes.length) deleteNodes(selNodes);
    else if (selEdges.length) deleteEdges(selEdges);
  };
  const disconnectAll = (id: string) => { const w = wfRef.current; if (!w) return; const ids = w.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id); if (ids.length) deleteEdges(ids); else toast({ text: 'That node has no links' }); };

  /* ── copy, paste, duplicate, nudge, tidy (FR-24 to FR-26) ── */
  /** A missing-type placeholder can't be copied: the server refuses new placeholders. */
  const copyable = (ids: string[]) => { const w = wfRef.current; const ok = ids.filter((id) => w?.nodes.find((n) => n.id === id)?.type !== 'missing'); if (ok.length < ids.length) toast({ text: 'A missing node type can\'t be copied; remove or replace it' }); return ok; };
  const copySel = () => {
    const w = wfRef.current; if (!w || !selNodes.length) return;
    const ids = copyable(selNodes); if (!ids.length) return;
    const c = copyNodes(w, ids); clip.current = c;
    try { void navigator.clipboard?.writeText(JSON.stringify(c)).catch(() => {}); } catch { /* best effort */ }
    toast({ text: `Copied ${plural(c.nodes.length, 'node')}`, ms: 1800 });
  };
  const pasteClip = (c: Clip, at?: { x: number; y: number } | null) => {
    const w = wfRef.current; if (!w) return;
    if (locked) { roNote(); return; }
    const r = pasteNodes(w, c, at ?? null, new Set((campaign?.scripts ?? []).map((s) => s.id)));
    if (!r.ids.length) return;
    commit(r.workflow, { label: 'paste' });
    setSelEdges([]); setSelNodes(r.ids);
  };
  const paste = (at?: { x: number; y: number } | null) => {
    const spot = at ?? (hoverAt.current && stageEl ? toWorld(hoverAt.current.x, hoverAt.current.y) : null);
    if (clip.current) { pasteClip(clip.current, spot); return; }
    try {
      void navigator.clipboard?.readText().then((t) => { const c = parseClip(t); if (c) { clip.current = c; pasteClip(c, spot); } else toast({ text: 'Nothing to paste: copy some nodes first' }); }).catch(() => toast({ text: 'Nothing to paste: copy some nodes first' }));
    } catch { toast({ text: 'Nothing to paste: copy some nodes first' }); }
  };
  const duplicate = (idsIn: string[]) => {
    let ids = idsIn;
    const w = wfRef.current; if (!w || !ids.length) return;
    if (locked) { roNote(); return; }
    ids = copyable(ids); if (!ids.length) return;
    const r = duplicateNodes(w, ids);
    commit(r.workflow, { label: ids.length === 1 ? 'duplicate node' : 'duplicate nodes' });
    setSelEdges([]); setSelNodes(r.ids);
  };
  const nudge = (dx: number, dy: number) => {
    const w = wfRef.current; if (!w || !selNodes.length) return;
    if (locked) { roNote(); return; }
    commit(moveNodes(w, selNodes, dx, dy), { mergeKey: `nudge:${selNodes.join(',')}`, label: 'nudge' });
  };
  const doTidy = () => {
    const w = wfRef.current; if (!w || w.nodes.length < 2) return;
    if (locked) { roNote(); return; }
    commit(tidy(w, Object.fromEntries(w.nodes.map((n) => [n.id, nodeSize(n).h]))), { label: 'tidy' });
    requestAnimationFrame(() => fit());
  };
  const selectAll = () => { const w = wfRef.current; if (!w) return; setSelEdges([]); setSelNodes(w.nodes.map((n) => n.id)); };

  /** Where a new node goes: head at the point, nudged down past any node it would cover (FR-44). */
  const nodeHeight = (n: WorkflowNode) => stageEl?.querySelector<HTMLElement>(`[data-node-id="${n.id}"]`)?.offsetHeight || 60 + Math.max(NODE_SPECS[n.type].inputs.length, NODE_SPECS[n.type].outputs.length) * PORT_GAP;
  const place = (wx: number, wy: number, nodes: WorkflowNode[]) => {
    const x = Math.round(wx - 24); let y = Math.round(wy - 19);
    for (let i = 0; i < 10; i++) {
      const hit = nodes.find((n) => x < n.x + NODE_W && x + NODE_W > n.x && y < n.y + nodeHeight(n) && y + 120 > n.y);
      if (!hit) break;
      y = hit.y + nodeHeight(hit) + 16;
    }
    return { x, y };
  };
  const recent = (): NodeType[] => { try { const v = JSON.parse(readLocal(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((t): t is NodeType => typeof t === 'string' && t in NODE_SPECS).slice(0, 5) : []; } catch { return []; } };
  const [recentTypes, setRecentTypes] = useState<NodeType[]>([]);
  const remember = (t: NodeType) => { const next = [t, ...recent().filter((x) => x !== t)].slice(0, 5); writeLocal(RECENT_KEY, JSON.stringify(next)); setRecentTypes(next); };
  const seedFor = (type: NodeType): Record<string, unknown> => {
    if (type === 'video') return { model: consoleControls.model, duration: consoleControls.duration, aspectRatio: consoleControls.aspectRatio, resolution: consoleControls.resolution };
    if (type === 'script') { const s = campaign?.scripts.find((x) => x.approvedVersion !== null) ?? campaign?.scripts[0]; return s ? { scriptId: s.id } : {}; }
    return {};
  };

  /** Add a node from the palette: plain, connected to a dropped wire, spliced into a link, or feeding an input. One history step. */
  const addNode = (type: NodeType, p: PaletteState) => {
    const w = wfRef.current;
    if (!w) return;
    if (locked) { roNote(); return; }
    let next: Workflow = w;
    if (p.connect?.detached) next = removeEdges(next, [p.connect.detached.id]);
    if (p.insert) next = removeEdges(next, [p.insert.id]);
    const at = place(p.wx, p.wy, next.nodes);
    const n = newNode(type, at.x, at.y, seedFor(type));
    next = { ...next, nodes: [...next.nodes, n] };
    if (p.connect) {
      const inp = firstInput(type, p.connect.type);
      if (inp) next = applyConnect(next, connectVerdict(next, p.connect.from, p.connect.port, n.id, inp), newEdge(p.connect.from, p.connect.port, n.id, inp));
    }
    if (p.insert) {
      const t = edgeType(w, p.insert);
      const inp = t ? firstInput(type, t) : null; const out = t ? firstOutput(type, t) : null;
      if (inp && out) next = { ...next, edges: [...next.edges, newEdge(p.insert.from, p.insert.fromPort, n.id, inp), newEdge(n.id, out, p.insert.to, p.insert.toPort)] };
    }
    if (p.feed) {
      const out = firstOutput(type, p.feed.type);
      if (out) next = applyConnect(next, connectVerdict(next, n.id, out, p.feed.to, p.feed.toPort), newEdge(n.id, out, p.feed.to, p.feed.toPort));
    }
    commit(next, { before: w, label: 'add node' });
    remember(type);
    setPalette(null); setSelEdges([]); setSelNodes([n.id]);
    stageEl?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  };
  const pick = (type: NodeType) => { if (palette) addNode(type, palette); };
  const quickAdd = (type: NodeType) => { if (!stageEl) return; const c = stageCentre(); const wpt = toWorld(c.x, c.y); addNode(type, { at: c, wx: wpt.x - NODE_W / 2 + 24, wy: wpt.y - 40 }); };

  const create = (template?: string) => leave(() => void createNow(template));
  const createNow = async (template?: string) => {
    if (!campaignId || readOnly) return;
    setBusy('new');
    try {
      await flushSave().catch(() => {});
      const r = await api.createWorkflow({ campaignId, template, name: template ? undefined : `Workflow ${list.length + 1}` });
      current.current = r.workflow.id; setList((l) => [r.workflow, ...l]); adopt(r.workflow); setStatus({}); setProblems([]); resetEditor(); setSaveState('idle');
      void refresh(r.workflow.id);
      if (r.workflow.nodes.length) fitSoon(); else updateView({ x: 20, y: 20, k: 1 });
    } catch (err) { toast({ text: `Couldn't create the workflow: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); } finally { setBusy(null); }
  };
  /**
   * Leave this workflow (switch, new, duplicate) only once its edits are on
   * the server. The waiting edit is sent first; when that or an earlier save
   * failed, ask "Discard unsaved changes?" instead of dropping them silently
   * (S05b edge case 8). Keep editing leaves everything as it is, with Retry.
   */
  const leave = async (go: () => void) => {
    if (!locked && pending.current) await flushSave().catch(() => {});
    if (!locked && failed.current && failed.current.id === current.current) { setMenu(null); setDiscard({ go }); return; }
    go();
  };
  const discardAndGo = () => { const d = discard; setDiscard(null); failed.current = null; cancelSave(); setSaveState('idle'); d?.go(); };
  const switchTo = (id: string) => {
    if (!id || id === wf?.id) return;
    void leave(() => {
      current.current = id; resetEditor(); setSaveState('idle'); failed.current = null;
      void refresh(id, true);
    });
  };
  const duplicateWorkflow = () => leave(() => void duplicateNow());
  const duplicateNow = async () => {
    if (!wf || readOnly) return;
    try { await flushSave().catch(() => {}); const r = await api.duplicateWorkflow(wf.id); setList((l) => [r.workflow, ...l]); current.current = r.workflow.id; resetEditor(); adopt(r.workflow); void refresh(r.workflow.id, true); toast({ text: `Duplicated as "${r.workflow.name}"`, tone: 'ok' }); } catch (err) { toast({ text: `Couldn't duplicate: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); }
  };
  const rename = (name: string) => {
    const w = wfRef.current; if (!w) return;
    const v = name.trim();
    if (!v) { toast({ text: 'A workflow needs a name', tone: 'err' }); return; }
    if (v.length > 80) { toast({ text: 'Keep the name under 80 characters', tone: 'err' }); return; }
    setRenaming(null);
    if (v === w.name) return;
    commit({ ...w, name: v }, { label: 'rename workflow' });
    setList((l) => l.map((x) => (x.id === w.id ? { ...x, name: v } : x)));
  };
  /** Delete after the confirm. Nothing is sent for this workflow after the DELETE; a failure keeps it and says why. */
  const remove = async () => {
    if (!wf || readOnly) return;
    const id = wf.id;
    const held = pending.current; // an edit still in the debounce is held back, and sent only if the delete fails
    setConfirmDelete(false); cancelSave(); setBusy('delete');
    try {
      await inflight.current; // a save already on the wire lands before the DELETE, never after it
      await api.deleteWorkflow(id);
      const rest = list.filter((w) => w.id !== id); setList(rest);
      current.current = rest[0]?.id ?? null; setWf(null); wfRef.current = null; resetEditor(); setStatus({}); setProblems([]); setSaveState('idle');
      if (rest[0]) void refresh(rest[0].id, true);
    } catch (err) {
      toast({ text: `Couldn't delete: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' });
      if (held && current.current === id) send(held).catch(() => {});
    } finally { setBusy(null); }
  };

  /* ── run (FR-58 to FR-62): the gate shows the server's plan for the scope; Stop, Reset, versions ── */
  const openGate = async (scope: RunScope = 'all', nodeId: string | null = null) => {
    if (!wf || readOnly) return;
    setMenu(null);
    setGate({ scope, nodeId, plan: null, error: null, capAsk: null });
    try { await flushSave(); const r = await api.planWorkflow(wf.id, scope, nodeId); setGate((g) => (g && g.scope === scope && g.nodeId === nodeId ? { ...g, plan: r.plan } : g)); }
    catch (err) { setGate((g) => (g ? { ...g, error: err instanceof Error ? err.message : 'could not read the plan' } : g)); }
  };
  const run = async (override: boolean) => {
    const g = gate; if (!wf || readOnly || !g) return;
    setBusy('run');
    try {
      await flushSave();
      const r = await api.runWorkflow(wf.id, { override, scope: g.scope, nodeId: g.nodeId });
      setGate(null);
      adopt(r.workflow); setStatus(r.status); setProblems(r.problems);
      const rr = await api.runs(wf.campaignId); onRuns(rr.runs);
      if (campaign) onCampaign((await api.campaign(campaign.id)).campaign);
      onNotice(g.scope === 'all' ? 'Workflow started.' : g.scope === 'failed' ? 'Re-running what failed.' : 'Running from the selected node.');
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'cap') setGate((x) => (x ? { ...x, capAsk: err.message } : x));
      else if (err instanceof ApiError && err.kind === 'graph') { setProblems((err.body.problems as GraphProblem[]) ?? problems); setGate((x) => (x ? { ...x, error: err.message } : x)); }
      else setGate((x) => (x ? { ...x, error: err instanceof Error ? err.message : 'run failed' } : x));
    } finally { setBusy(null); }
  };
  const stop = async () => {
    if (!wf || readOnly) return;
    setConfirmStop(false); setBusy('stop');
    try { const v = await api.stopWorkflow(wf.id); adopt(v.workflow); setStatus(v.status); setProblems(v.problems); const rr = await api.runs(wf.campaignId); onRuns(rr.runs); toast({ text: 'Stopped. Nothing new will be sent.', tone: 'ok' }); }
    catch (err) { toast({ text: `Couldn't stop: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); } finally { setBusy(null); }
  };
  const reset = async () => {
    if (!wf || readOnly) return;
    const id = wf.id;
    try {
      const v = await api.patchWorkflow(id, { reset: true }); adopt(v.workflow); setStatus(v.status); setProblems(v.problems);
      toast({ text: 'Run results cleared from the canvas. Delivered assets stay in the campaign.', tone: 'ok', ms: 6000, action: { label: 'Undo', onClick: () => { api.patchWorkflow(id, { restoreRunSnapshot: true }).then((x) => { if (current.current === id) { adopt(x.workflow); setStatus(x.status); setProblems(x.problems); } }).catch((err: unknown) => toast({ text: `Couldn't restore: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' })); } } });
    } catch (err) { toast({ text: `Couldn't clear: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); }
  };
  const openVersions = async () => {
    if (!wf) return;
    setMenu(null); setSelNodes([]);
    if (readOnly) { setVersions({ list: [], loading: false }); return; }
    setVersions({ list: [], loading: true });
    try { const r = await api.workflowVersions(wf.id); setVersions({ list: r.versions, loading: false }); } catch { setVersions({ list: [], loading: false }); }
  };
  const saveVersion = async () => {
    if (!wf) return;
    if (readOnly) { roNote(); return; }
    try { await flushSave(); const r = await api.saveWorkflowVersion(wf.id); toast({ text: `Saved v${r.version.n}`, tone: 'ok' }); setVersions((v) => (v ? { list: r.versions, loading: false } : v)); }
    catch (err) { toast({ text: `Couldn't save a version: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); }
  };
  const restoreVersion = async (v: WorkflowVersion) => {
    const w = wfRef.current; if (!w || readOnly) return;
    try {
      await flushSave();
      const before = w;
      const r = await api.restoreWorkflowVersion(w.id, v.n);
      hist.current.push(before, undefined, Date.now(), `restore v${v.n}`);
      setPreview(null); adopt(r.workflow); setStatus(r.status); setProblems(r.problems); setTick((t) => t + 1);
      setList((l) => l.map((x) => (x.id === w.id ? { ...x, name: r.workflow.name } : x)));
      const fresh = await api.workflowVersions(w.id).catch(() => null);
      if (fresh) setVersions({ list: fresh.versions, loading: false });
      toast({ text: `Restored v${v.n}. Your previous design was saved as a version.`, tone: 'ok', action: undoAction, ms: 6000 });
      requestAnimationFrame(() => fit());
    } catch (err) { toast({ text: `Couldn't restore: ${err instanceof Error ? err.message : 'unknown error'}`, tone: 'err' }); }
  };

  /* ── geometry ── */
  const toWorld = (cx: number, cy: number) => { const r = stageEl!.getBoundingClientRect(); const v = viewRef.current; return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }; };
  const portPos = (n: WorkflowNode, port: string, side: 'in' | 'out') => {
    const spec = NODE_SPECS[n.type];
    const i = (side === 'in' ? spec.inputs : spec.outputs).findIndex((p) => p.name === port);
    return { x: n.x + (side === 'in' ? 0 : NODE_W), y: n.y + 46 + 7 + Math.max(0, i) * PORT_GAP };
  };
  const stageCentre = () => { const r = stageEl!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const openPalette = (cx: number, cy: number, extra: Partial<PaletteState> = {}) => {
    if (!wfRef.current || !stageEl) return;
    if (locked) { roNote(); return; }
    const w = toWorld(cx, cy);
    setMenu(null); setRecentTypes(recent());
    setPalette({ at: { x: cx, y: cy }, wx: w.x, wy: w.y, ...extra });
  };
  const openPaletteCentre = () => { if (!stageEl) return; const c = stageCentre(); openPalette(c.x, c.y); };
  /** "not linked" in the sheet: add a node that outputs this type, left of the node, linked into the port (FR-53). */
  const feedPort = (n: WorkflowNode, port: string, type: PortType) => {
    if (!stageEl) return;
    const r = stageEl.getBoundingClientRect(); const v = viewRef.current;
    const pp = portPos(n, port, 'in');
    const cx = r.left + v.x + (pp.x - 260) * v.k; const cy = r.top + v.y + pp.y * v.k;
    openPalette(Math.max(r.left + 8, cx), cy, { title: `Feed ${n.title} · ${port}`, ctx: { needsOutputType: type }, feed: { to: n.id, toPort: port, type } });
    setPalette((p) => (p ? { ...p, wx: pp.x - NODE_W - 60, wy: pp.y - 40 } : p));
  };

  /* ── full screen (FR-3): same builder, portalled over the console, view centre kept ── */
  const toggleFull = () => {
    if (!full && rootEl) dockedH.current = rootEl.getBoundingClientRect().height;
    if (stageEl) { const r = stageEl.getBoundingClientRect(); const v = viewRef.current; pendingCentre.current = { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k }; }
    setPalette(null); setMenu(null);
    setFull((f) => !f);
  };
  useLayoutEffect(() => {
    const c = pendingCentre.current; if (!c || !stageEl) return;
    pendingCentre.current = null;
    const k = viewRef.current.k;
    updateView({ k, x: stageEl.clientWidth / 2 - c.x * k, y: stageEl.clientHeight / 2 - c.y * k });
    stageEl.focus({ preventScroll: true, focusVisible: false } as FocusOptions); // no ring for a pointer-driven move; Tab still shows it
  }, [stageEl, updateView]);
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [full]);

  /* ── wire targets ── */
  const wireBase = useMemo(() => (wf && drag?.kind === 'wire' && drag.detached ? removeEdges(wf, [drag.detached.id]) : wf), [wf, drag]);
  const verdicts = useMemo(() => {
    const m = new Map<string, ConnectVerdict>();
    if (!wireBase || drag?.kind !== 'wire') return m;
    for (const n of wireBase.nodes) for (const p of NODE_SPECS[n.type].inputs) {
      const key = `${n.id}|${p.name}`;
      if (drag.detached && drag.detached.to === n.id && drag.detached.toPort === p.name) m.set(key, { kind: 'noop', reason: 'Same port' });
      else m.set(key, connectVerdict(wireBase, drag.from, drag.port, n.id, p.name));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireBase, drag?.kind, drag?.kind === 'wire' ? `${drag.from}|${drag.port}|${drag.detached?.id ?? ''}` : '']);
  /** The input port under a point: the ring or label itself, or the best input of the node under it (free first, then replace). */
  const targetAt = (cx: number, cy: number): Target | null => {
    const el = document.elementFromPoint(cx, cy);
    const portEl = el?.closest<HTMLElement>('[data-in-port]');
    if (portEl?.dataset.inPort) { const [nodeId, port] = portEl.dataset.inPort.split('|'); return { nodeId, port, key: portEl.dataset.inPort }; }
    const nodeEl = el?.closest<HTMLElement>('[data-node-id]');
    const n = nodeEl ? wfRef.current?.nodes.find((x) => x.id === nodeEl.dataset.nodeId) : null;
    if (!n) return null;
    const keys = NODE_SPECS[n.type].inputs.map((p) => `${n.id}|${p.name}`);
    const best = keys.find((k) => verdicts.get(k)?.kind === 'add') ?? keys.find((k) => verdicts.get(k)?.kind === 'replace');
    if (!best) return null;
    const [nodeId, port] = best.split('|');
    return { nodeId, port, key: best };
  };
  const finishWire = (d: Extract<Drag, { kind: 'wire' }>, cx: number, cy: number) => {
    const w = wfRef.current; if (!w) return;
    const t = targetAt(cx, cy);
    const title = (id: string) => w.nodes.find((n) => n.id === id)?.title ?? 'node';
    if (t) {
      if (d.detached) {
        const r = reconnect(w, d.detached.id, t.nodeId, t.port);
        if (r.kind === 'moved') {
          commit(r.workflow, { before: w, label: r.replacedEdgeId ? 'replace link' : 'move link' });
          const old = r.replacedEdgeId ? w.edges.find((e) => e.id === r.replacedEdgeId) : null;
          toast({ text: old ? `Replaced ${title(old.from)} → ${old.toPort} with ${title(d.from)} → ${t.port}` : `Moved ${title(d.from)} → ${t.port}`, tone: 'ok', action: undoAction, ms: 5000 });
        } else if (r.kind === 'refuse') toast({ text: r.reason, tone: 'err' });
        return;
      }
      const v = connectVerdict(w, d.from, d.port, t.nodeId, t.port);
      if (v.kind === 'refuse') { toast({ text: v.reason, tone: 'err' }); return; }
      if (v.kind === 'noop') { toast({ text: v.reason }); return; }
      commit(applyConnect(w, v, newEdge(d.from, d.port, t.nodeId, t.port)), { before: w, label: v.kind === 'replace' ? 'replace link' : 'link' });
      if (v.kind === 'replace') { const old = w.edges.find((e) => e.id === v.removeEdgeId); toast({ text: `Replaced ${old ? title(old.from) : 'the link'} → ${t.port} with ${title(d.from)} → ${t.port}`, tone: 'ok', action: undoAction, ms: 5000 }); }
      return;
    }
    const over = document.elementFromPoint(cx, cy);
    if (over && stageEl?.contains(over) && !over.closest('.ae-o-wf-node, .ae-o-wf-sheet, .ae-o-wf-zoom')) {
      const src = w.nodes.find((n) => n.id === d.from);
      openPalette(cx, cy, { title: `Connect ${src?.title ?? 'node'} · ${d.port} to…`, ctx: { needsInputType: d.type }, connect: { from: d.from, port: d.port, type: d.type, detached: d.detached } });
    }
    // anywhere else: nothing changes (a picked-up link stays where it was)
  };

  /* ── pointer (FR-9, FR-21, FR-22): one handler set on the stage, pointer capture for every drag ── */
  const onStageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('.ae-o-wf-sheet, .ae-o-wf-zoom, .ae-o-wf-edge-x, .ae-o-wf-hit, .ui-toasts, .ae-o-wf-port-x, .ae-o-wf-empty-act, .ae-o-wf-start, .ae-o-wf-banner, .ae-o-wf-legend, .ae-o-wf-rename')) return;
    if (e.button === 2) return;
    if (palette) setPalette(null);
    if (menu) setMenu(null);
    if (!shown) return;
    altRef.current = e.altKey;
    const capture = () => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browsers */ } };
    pointer.current = { x: e.clientX, y: e.clientY };
    // Space+drag and middle-drag pan from anywhere, over nodes too
    if (e.button === 1 || spaceRef.current) { e.preventDefault(); capture(); setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y }); return; }
    const outEl = t.closest<HTMLElement>('[data-out-port]');
    if (outEl?.dataset.outPort) {
      if (locked) { roNote(); return; }
      const [from, port] = outEl.dataset.outPort.split('|');
      const n = shown.nodes.find((x) => x.id === from); const p = n ? NODE_SPECS[n.type].outputs.find((x) => x.name === port) : null;
      if (!n || !p) return;
      e.preventDefault(); capture();
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'wire', from, port, type: p.type, x: w.x, y: w.y, detached: null, sx: e.clientX, sy: e.clientY, moved: false });
      return;
    }
    const inEl = t.closest<HTMLElement>('[data-in-port]');
    if (inEl?.dataset.inPort) {
      if (locked) { roNote(); return; }
      const [to, port] = inEl.dataset.inPort.split('|');
      const linked = shown.edges.filter((x) => x.to === to && x.toPort === port);
      const edge = linked[linked.length - 1]; // a many port with several links picks the last added (edge case 4); the port "×" list is the precise path
      if (!edge) return;
      const src = shown.nodes.find((x) => x.id === edge.from);
      const type = src ? NODE_SPECS[src.type].outputs.find((x) => x.name === edge.fromPort)?.type : null;
      if (!type) return;
      e.preventDefault(); capture();
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'wire', from: edge.from, port: edge.fromPort, type, x: w.x, y: w.y, detached: edge, sx: e.clientX, sy: e.clientY, moved: false });
      return;
    }
    const nodeEl = t.closest<HTMLElement>('[data-node-id]');
    if (nodeEl?.dataset.nodeId) {
      const id = nodeEl.dataset.nodeId;
      setSelEdges([]);
      let ids = selNodes;
      if (e.shiftKey) { ids = selNodes.includes(id) ? selNodes.filter((x) => x !== id) : [...selNodes, id]; setSelNodes(ids); if (!ids.includes(id)) return; }
      else if (!selNodes.includes(id)) { ids = [id]; setSelNodes(ids); }
      if (t.closest('button, a, input, textarea, select, video')) return;
      if (locked) return; // the sample and a version preview select, never move
      const w = toWorld(e.clientX, e.clientY);
      capture();
      setDrag({ kind: 'node', ids, sx: w.x, sy: w.y, origin: Object.fromEntries(shown.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])), before: shown, moved: false });
      return;
    }
    capture();
    // Shift+drag on empty canvas draws a marquee; a plain drag pans (Q-WF-6 default) and a press clears the selection
    if (e.shiftKey) { e.preventDefault(); const w = toWorld(e.clientX, e.clientY); setSelEdges([]); setDrag({ kind: 'marquee', x1: w.x, y1: w.y, x2: w.x, y2: w.y, base: selNodes }); return; }
    clearSel();
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y });
  };
  const applyMove = (cx: number, cy: number) => {
    const d = drag; if (!d) return;
    if (d.kind === 'pan') { updateView((v) => ({ ...v, x: d.ox + (cx - d.sx), y: d.oy + (cy - d.sy) })); return; }
    const w = toWorld(cx, cy);
    if (d.kind === 'node') {
      const cur = wfRef.current; if (!cur) return;
      const dx = w.x - d.sx; const dy = w.y - d.sy;
      if (!d.moved && Math.hypot(dx * viewRef.current.k, dy * viewRef.current.k) < 2) return;
      // snap to the 11px grid unless Alt is held (FR-22)
      const pos = (o: { x: number; y: number }) => (altRef.current ? { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : { x: snap(o.x + dx), y: snap(o.y + dy) });
      const next = { ...cur, nodes: cur.nodes.map((n) => (d.origin[n.id] ? { ...n, ...pos(d.origin[n.id]) } : n)) };
      wfRef.current = next; setWf(next);
      if (!d.moved) setDrag({ ...d, moved: true });
      return;
    }
    if (d.kind === 'marquee') {
      const next = { ...d, x2: w.x, y2: w.y };
      setDrag(next);
      const cur = shown; if (!cur) return;
      const hit = nodesInRect(cur.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...nodeSize(n) })), next);
      setSelNodes([...new Set([...d.base, ...hit])]);
      return;
    }
    setDrag({ ...d, x: w.x, y: w.y, moved: d.moved || Math.hypot(cx - d.sx, cy - d.sy) > 3 });
    const t = targetAt(cx, cy);
    setHot(t?.key ?? null);
  };
  const onStageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    hoverAt.current = { x: e.clientX, y: e.clientY };
    if (!drag) return;
    altRef.current = e.altKey;
    pointer.current = { x: e.clientX, y: e.clientY };
    applyMove(e.clientX, e.clientY);
  };
  const onStageUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    setDrag(null); setHot(null); pointer.current = null;
    if (!d) return;
    if (d.kind === 'node' && d.moved && wfRef.current) commit(wfRef.current, { before: d.before, label: d.ids.length > 1 ? 'move nodes' : 'move node' });
    if (d.kind === 'wire' && !d.moved) { if (d.detached) selectEdge(d.detached.id, e.shiftKey); return; }
    if (d.kind === 'wire') finishWire(d, e.clientX, e.clientY);
  };
  const cancelDrag = () => {
    const d = drag;
    if (d?.kind === 'node' && d.moved) { setWf(d.before); wfRef.current = d.before; }
    if (d?.kind === 'marquee') setSelNodes(d.base);
    setDrag(null); setHot(null); pointer.current = null;
  };
  // auto-pan while a node, a wire or a marquee is dragged near the stage edge (FR-8)
  const moveRef = useRef(applyMove);
  moveRef.current = applyMove;
  useEffect(() => {
    if (drag?.kind !== 'node' && drag?.kind !== 'wire' && drag?.kind !== 'marquee') return;
    let raf = 0;
    const tick = () => {
      const p = pointer.current; const el = stageEl;
      if (p && el) {
        const r = el.getBoundingClientRect();
        const push = (d: number) => (d < EDGE_EDGE ? Math.round(AUTO_PAN * (1 - Math.max(0, d) / EDGE_EDGE)) : 0);
        const dx = push(p.x - r.left) - push(r.right - p.x); const dy = push(p.y - r.top) - push(r.bottom - p.y);
        if (dx || dy) { updateView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })); moveRef.current(p.x, p.y); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.kind, stageEl, updateView]);
  const onStageDbl = (e: React.MouseEvent) => {
    if (!wf) return;
    // pointer capture retargets the click to the stage, so look at what is really under the pointer
    const t = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement;
    const head = t.closest<HTMLElement>('.ae-o-wf-head');
    const nodeId = head?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (nodeId && !t.closest('input, button')) { if (locked) return; const n = wf.nodes.find((x) => x.id === nodeId); if (n) setRenamingNode({ id: n.id, value: n.title }); return; }
    if (t.closest('.ae-o-wf-node, .ae-o-wf-hit, .ae-o-wf-edge-x, .ae-o-wf-sheet, .ae-o-wf-zoom, .ui-toasts, .ae-o-wf-start, .ae-o-wf-banner, .ae-o-wf-legend, .ae-o-wf-empty-act')) return;
    openPalette(e.clientX, e.clientY);
  };
  /** Right-click on the canvas or a node (FR-23, §6). */
  const onStageMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.ae-o-wf-sheet, .ae-o-wf-hit, input, textarea')) return;
    if (!shown) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    setPalette(null);
    const nodeEl = t.closest<HTMLElement>('[data-node-id]');
    if (nodeEl?.dataset.nodeId) {
      const id = nodeEl.dataset.nodeId; const n = shown.nodes.find((x) => x.id === id); if (!n) return;
      const ids = selNodes.includes(id) ? selNodes : [id];
      if (!selNodes.includes(id)) { setSelEdges([]); setSelNodes([id]); }
      const items: MenuItem[] = locked ? [{ label: 'Fit to view', onSelect: () => fit(ids) }] : [
        { label: ids.length > 1 ? `Duplicate ${ids.length} nodes` : 'Duplicate', hint: 'Cmd/Ctrl+D', onSelect: () => duplicate(ids) },
        { label: 'Rename', hint: 'or double-click the title', onSelect: () => setRenamingNode({ id, value: n.title }) },
        { label: 'Run from here…', hint: 'this node and everything after it', disabled: running, onSelect: () => void openGate('from', id) },
        { label: 'Disconnect all', onSelect: () => disconnectAll(id) },
        { label: ids.length > 1 ? `Delete ${ids.length} nodes` : 'Delete', hint: 'Delete', danger: true, onSelect: () => deleteNodes(ids) },
      ];
      setMenu({ at, label: n.title, items });
      return;
    }
    if (locked) return;
    const wpt = toWorld(at.x, at.y);
    setMenu({ at, label: 'Canvas', items: [
      { label: 'Add node here…', hint: 'or double-click', onSelect: () => openPalette(at.x, at.y) },
      { label: 'Paste', hint: 'Cmd/Ctrl+V', disabled: !clip.current, onSelect: () => paste(wpt) },
      { label: 'Select all', hint: 'Cmd/Ctrl+A', disabled: !shown.nodes.length, onSelect: selectAll },
      { label: 'Tidy', hint: 'lay out left to right', disabled: shown.nodes.length < 2, onSelect: doTidy },
      { label: 'Fit to view', hint: 'F', disabled: !shown.nodes.length, onSelect: () => fit() },
    ] });
  };

  /* ── wheel (FR-4, FR-5): the only wheel handler, native and non-passive ── */
  const engaged = () => !!rootEl && !!document.activeElement && rootEl.contains(document.activeElement);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    // Ctrl/Cmd+wheel (and pinch) zooms the canvas anywhere in the stage, the sheet included, so the browser never page-zooms
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022)); return; }
    if ((e.target as Element).closest?.('.ae-o-wf-sheet, .ae-o-wf-start')) return; // these scroll themselves
    if (!full && !engaged()) {
      // docked and not clicked into: the console page scrolls, the canvas stays put
      if (!hintShown.current) { hintShown.current = true; setHint(true); setTimeout(() => setHint(false), 2000); }
      return;
    }
    e.preventDefault();
    const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    updateView((v) => ({ ...v, x: v.x - e.deltaX * m, y: v.y - e.deltaY * m }));
  };
  useEffect(() => {
    if (!stageEl) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    stageEl.addEventListener('wheel', h, { passive: false });
    return () => stageEl.removeEventListener('wheel', h);
  }, [stageEl]);
  useEffect(() => {
    if (!rootEl) return;
    const out = () => setTimeout(() => { if (!engaged()) hintShown.current = false; }, 0);
    rootEl.addEventListener('focusout', out);
    return () => rootEl.removeEventListener('focusout', out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootEl]);

  /* ── keyboard (§6): one listener, bound once, reading the latest state through a ref ── */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return; // the shared Escape stack owns it
    if (gate || shortcuts || dialogUp) return; // a dialog is up
    const a = document.activeElement;
    const inside = !!rootEl && ((!!a && rootEl.contains(a)) || (full && (!a || a === document.body)));
    if (!inside || typing(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ' && !mod) { spaceRef.current = true; if (!(e.target as HTMLElement)?.closest?.('button')) e.preventDefault(); return; }
    if (e.shiftKey && !mod && (e.key === 'F' || e.code === 'KeyF')) { e.preventDefault(); toggleFull(); return; }
    if (e.key === '?') { e.preventDefault(); setShortcuts(true); return; }
    if (!wf) return;
    if (mod && k === 'k') { e.preventDefault(); e.stopImmediatePropagation(); openPaletteCentre(); return; } // the builder's palette, not the app's, while the builder has focus
    if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 'redo' : 'undo'); return; }
    if (mod && k === 'y') { e.preventDefault(); travel('redo'); return; }
    if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
    if (mod && k === 'c') { if (selNodes.length) { e.preventDefault(); copySel(); } return; }
    if (mod && k === 'v') { e.preventDefault(); paste(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicate(selNodes); return; }
    if (mod && k === 's') { e.preventDefault(); void saveVersion(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); if (!readOnly && !running) void openGate('all'); return; }
    if (mod || e.altKey) return;
    if (e.key.startsWith('Arrow') && selNodes.length) {
      e.preventDefault();
      const s = e.shiftKey ? 11 : 1;
      nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
      return;
    }
    if (e.key === '/') { e.preventDefault(); openPaletteCentre(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selNodes.length || selEdges.length) { e.preventDefault(); deleteSelection(); } }
    else if (e.key === 'Enter') { if (sel) { e.preventDefault(); rootEl?.querySelector<HTMLElement>('.ae-o-wf-sheet input, .ae-o-wf-sheet textarea, .ae-o-wf-sheet select, .ae-o-wf-sheet button')?.focus(); } }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fit(selNodes); }
    else if (e.key === '0') { e.preventDefault(); zoomTo(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCentre(1.2); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCentre(1 / 1.2); }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => { if (e.key === ' ') spaceRef.current = false; if (e.key === 'Alt') altRef.current = false; };
    const blur = () => { spaceRef.current = false; altRef.current = false; };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  /* ── Escape (X1): the builder is one layer that closes its innermost part per press ── */
  const sel = selNodes.length === 1 && !selEdges.length ? shown?.nodes.find((n) => n.id === selNodes[0]) ?? null : null;
  const dialogUp = confirmDelete || confirmStop || !!discard || !!lightbox; // X1 dialogs: they own Escape, focus and Tab
  const anyLayer = full || !!palette || !!menu || drag?.kind === 'wire' || drag?.kind === 'marquee' || dialogUp || coach !== null || !!versions || !!preview || !!renamingNode || renaming !== null || selNodes.length > 0 || selEdges.length > 0;
  // off while a dialog is up: the dialog's own layer (pushed first, as a child) must stay on top
  useEscapeLayer(anyLayer && !gate && !shortcuts && !dialogUp, `wf-builder-${uid}`, () => {
    if (menu) setMenu(null);
    else if (palette) { setPalette(null); stageEl?.focus({ preventScroll: true }); }
    else if (drag) cancelDrag();
    else if (renamingNode) setRenamingNode(null);
    else if (renaming !== null) setRenaming(null);
    else if (coach !== null) endCoach();
    else if (preview) setPreview(null);
    else if (versions) setVersions(null);
    else if (selNodes.length || selEdges.length) clearSel();
    else if (full) toggleFull();
  });
  useEscapeLayer(shortcuts, `wf-keys-${uid}`, () => setShortcuts(false));

  /* ── docked height (FR-1, FR-2) ── */
  const maxH = () => Math.max(H_MIN, window.innerHeight - 160);
  const curH = () => stageEl?.getBoundingClientRect().height ?? 420;
  const setHeight = (h: number | null) => { const v = h == null ? null : Math.round(Math.min(maxH(), Math.max(H_MIN, h))); setStageH(v); writeLocal(H_KEY, v == null ? '' : String(v)); };
  const grip = useRef<{ sy: number; h: number } | null>(null);

  /* ── edges ── */
  const edgeHover = (id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (id) setHoverEdge(id); else hoverTimer.current = setTimeout(() => setHoverEdge(null), 160);
  };
  const selectEdge = (id: string, add: boolean) => { setSelNodes([]); setSelEdges((s) => (add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id])); stageEl?.focus({ preventScroll: true, focusVisible: false } as FocusOptions); };
  const edgeMenu = (e: React.MouseEvent, edge: WorkflowEdge) => {
    e.preventDefault(); e.stopPropagation();
    if (!shown) return;
    selectEdge(edge.id, false);
    const t = edgeType(shown, edge);
    const at = { x: e.clientX, y: e.clientY };
    const items: MenuItem[] = [
      { label: 'Delete link', danger: true, onSelect: () => deleteEdges([edge.id]) },
      { label: 'Insert node here…', hint: t ? `a node that takes and gives ${t}` : undefined, onSelect: () => openPalette(at.x, at.y, { title: `Insert into ${shown.nodes.find((n) => n.id === edge.from)?.title ?? ''} → ${edge.toPort}`, ctx: t ? { needsInputType: t, needsOutputType: t } : undefined, insert: edge }) },
      { label: 'Select both ends', onSelect: () => { setSelEdges([]); setSelNodes([edge.from, edge.to]); } },
    ];
    setPalette(null);
    setMenu({ at, label: 'Link', items: locked ? items.slice(2) : items });
  };
  /** The "×" on a linked input port: one link goes at once, several list for a pick (FR-14). */
  const portX = (e: React.MouseEvent, n: WorkflowNode, port: string) => {
    e.stopPropagation();
    if (!wf || locked) return;
    const linked = wf.edges.filter((x) => x.to === n.id && x.toPort === port);
    if (linked.length <= 1) { deleteEdges(linked.map((x) => x.id)); return; }
    const title = (id: string) => wf.nodes.find((x) => x.id === id)?.title ?? 'node';
    setMenu({ at: { x: e.clientX, y: e.clientY }, label: `Links into ${port}`, items: [
      ...linked.map((x) => ({ label: `Remove ${title(x.from)} · ${x.fromPort}`, onSelect: () => deleteEdges([x.id]) })),
      { label: `Remove all ${linked.length}`, danger: true, onSelect: () => deleteEdges(linked.map((x) => x.id)) },
    ] });
  };

  /* ── derived ── */
  const assetFor = (id: string | null) => (id ? campaign?.assets.find((a) => a.id === id) ?? null : null);
  const running = !preview && Object.values(status).some((s) => s === 'running' || s === 'ready');
  const scopeIds = wf?.runScope ? new Set(wf.runScope) : null;
  const scoped = (shown?.nodes ?? []).filter((n) => !scopeIds || scopeIds.has(n.id));
  const doneCount = scoped.filter((n) => status[n.id] === 'done').length;
  const failedCount = scoped.filter((n) => status[n.id] === 'failed').length;
  const allDoneCount = (shown?.nodes ?? []).filter((n) => status[n.id] === 'done').length;
  const allFailedCount = (shown?.nodes ?? []).filter((n) => status[n.id] === 'failed').length;
  const waitingArcads = scoped.filter((n) => status[n.id] === 'running' && isPaid(n)).length;
  const allDone = !!wf && wf.nodes.length > 0 && wf.nodes.every((n) => status[n.id] === 'done');
  const inbound = useMemo(() => { const m = new Map<string, WorkflowEdge[]>(); for (const e of shown?.edges ?? []) { const k = `${e.to}|${e.toPort}`; m.set(k, [...(m.get(k) ?? []), e]); } return m; }, [shown?.edges]);
  const wiring = drag?.kind === 'wire' && drag.moved ? drag : null;
  const hiddenEdge = (wiring?.moved ? wiring.detached?.id : null) ?? palette?.connect?.detached?.id ?? null;
  const hotVerdict = hot ? verdicts.get(hot) : undefined;
  const replacing = hotVerdict?.kind === 'replace' ? hotVerdict.removeEdgeId : null;
  const portalRoot = (rootEl?.closest('.ae-octane') ?? (typeof document !== 'undefined' ? document.body : null)) as Element | null;
  const errors = preview ? [] : blockingProblems(problems);
  const visibleProblems = useMemo(() => (preview ? [] : problems), [preview, problems]);
  const toFix = visibleProblems.filter((p) => p.level !== 'info');
  const problemsByNode = useMemo(() => { const m = new Map<string, GraphProblem[]>(); for (const p of visibleProblems) if (p.nodeId) m.set(p.nodeId, [...(m.get(p.nodeId) ?? []), p]); return m; }, [visibleProblems]);
  const paidNodes = (shown?.nodes ?? []).filter(isPaid).length;
  const needsArcads = !engineDry && !health.arcads.configured && paidNodes > 0;
  /** Q-WF-4 default: the LLM node stays addable and says why it will fail at run (a dry run only echoes, so it never needs Claude) */
  const claudeMissing = !engineDry && !readOnly && health.claude?.present === false;
  const lastDelivery = wf?.deliveries?.at(-1) ?? null;

  const statusText = (() => {
    if (!campaignId) return 'Open a campaign to build a workflow';
    if (!shown) return list.length ? 'Pick a workflow' : 'Pick a starting graph below';
    // 1. selection (FR-52, FR-12)
    if (selEdges.length === 1) {
      const e = shown.edges.find((x) => x.id === selEdges[0]);
      const a = e && shown.nodes.find((n) => n.id === e.from); const b = e && shown.nodes.find((n) => n.id === e.to);
      if (e && a && b) { const lbl = NODE_SPECS[a.type].label; return `${a.title}${a.title !== lbl ? ` (${lbl})` : ''} → ${b.title} · ${e.toPort}. Delete to remove.`; }
    }
    if (selEdges.length > 1) return `${selEdges.length} links selected. Delete to remove.`;
    if (selNodes.length > 1) return `${selNodes.length} nodes selected. Drag to move, Delete to remove, Cmd/Ctrl+C to copy.`;
    if (sel) {
      const spec = NODE_SPECS[sel.type];
      const linked = spec.inputs.filter((p) => shown.edges.some((e) => e.to === sel.id && e.toPort === p.name)).length;
      const missing = spec.inputs.filter((p) => p.required && !shown.edges.some((e) => e.to === sel.id && e.toPort === p.name)).length;
      return `${spec.label}${spec.inputs.length ? ` · ${linked} input${linked === 1 ? '' : 's'} linked` : ''}${missing ? `, ${missing} required missing` : ''}${isPaid(sel) ? ' · paid' : ' · local'}`;
    }
    if (preview) return `Viewing v${preview.n} · ${plural(shown.nodes.length, 'node')}`;
    // 2. running, 3. after a run, 4. the graph
    if (running) return `Running · ${doneCount} of ${scoped.length} done${waitingArcads ? ` · ${waitingArcads} waiting on Arcads` : ''}`;
    if (wf?.runStartedAt) return `Last run ${hhmm(wf.runStartedAt)} · ${allDoneCount} of ${shown.nodes.length} done${allFailedCount ? `, ${allFailedCount} failed` : ''}${lastDelivery?.assetIds.length ? ` · ${plural(lastDelivery.assetIds.length, 'final')}` : ''}`;
    return `${plural(shown.nodes.length, 'node')} · ${plural(shown.edges.length, 'link')} · ${paidNodes} paid`;
  })();

  const saveLabel = locked || !wf ? null : saveState === 'pending' || saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'error' : null;
  const problemMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const lvl = { error: 'Must fix before Run', warn: 'Worth a look', info: 'Note' } as const;
    const order = ['error', 'warn', 'info'];
    const sorted = [...visibleProblems].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    setMenu({ at: { x: r.left, y: r.bottom + 6 }, label: 'Problems', wide: true, items: sorted.map((p, i) => ({ section: i === 0 || sorted[i - 1].level !== p.level ? lvl[p.level] : undefined, label: p.message, danger: p.level === 'error', hint: p.nodeId ? 'Show the node' : undefined, onSelect: () => { if (p.nodeId) { setSelEdges([]); setSelNodes([p.nodeId]); fit([p.nodeId]); } } })) });
  };
  const switcherMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = list.map((w, i) => ({ section: i === 0 ? 'Workflows in this campaign' : undefined, label: w.name, checked: w.id === wf?.id, hint: `${plural(w.nodes.length, 'node')} · updated ${ago(w.updatedAt)}`, onSelect: () => switchTo(w.id) }));
    if (!readOnly) {
      items.push({ section: 'New', label: 'Blank canvas', onSelect: () => void create() });
      for (const t of templates) items.push({ label: `From template: ${t.name}`, hint: t.needsScript ? 'needs an approved script' : `${plural(t.paidRequests, 'paid request')} per run`, disabled: t.needsScript, onSelect: () => void create(t.id) });
      if (wf) {
        items.push({ section: 'This workflow', label: 'Rename', onSelect: () => setRenaming(wf.name) });
        items.push({ label: 'Duplicate', onSelect: () => void duplicateWorkflow() });
        items.push({ label: 'Version history', onSelect: () => void openVersions() });
        items.push({ label: 'Delete…', danger: true, disabled: running, hint: running ? 'Stop or wait for the run to finish' : undefined, onSelect: () => setConfirmDelete(true) });
      }
    } else if (wf) items.push({ section: 'This workflow', label: 'Version history', onSelect: () => void openVersions() });
    setMenu({ at: { x: r.left, y: r.bottom + 6 }, label: 'Workflows', items, wide: true });
  };
  const overflowMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ at: { x: r.right - 240, y: r.bottom + 6 }, label: 'More', items: [
      { label: 'Save version', hint: 'Cmd/Ctrl+S', disabled: !wf || locked, onSelect: () => void saveVersion() },
      { label: 'Version history', disabled: !wf, onSelect: () => void openVersions() },
      { label: 'Tidy layout', disabled: !wf || locked || (wf?.nodes.length ?? 0) < 2, onSelect: doTidy },
      { label: 'Keyboard shortcuts', hint: '?', onSelect: () => setShortcuts(true) },
      ...(readOnly ? [] : [{ label: 'Delete workflow…', danger: true, disabled: !wf || running || busy !== null, hint: running ? 'Stop or wait for the run to finish' : undefined, onSelect: () => setConfirmDelete(true) }]),
    ] });
  };
  const scopeMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const failedAny = (wf?.nodes ?? []).some((n) => n.error);
    const one = selNodes.length === 1 ? wf?.nodes.find((n) => n.id === selNodes[0]) : null;
    setMenu({ at: { x: r.right - 240, y: r.bottom + 6 }, label: 'Run scope', items: [
      { label: 'Run all', hint: 'every node', onSelect: () => void openGate('all') },
      { label: 'Run failed only', hint: failedAny ? 'what failed and what waits on it' : 'nothing has failed', disabled: !failedAny, onSelect: () => void openGate('failed') },
      { label: one ? `Run from ${one.title}` : 'Run from selected node', hint: one ? 'it and everything after it' : 'select one node first', disabled: !one, onSelect: () => { if (one) void openGate('from', one.id); } },
    ] });
  };
  const runBlocked = !wf ? 'No workflow' : !wf.nodes.length ? 'Add a node first' : null;
  const onRunClick = (e: React.MouseEvent) => {
    if (running) { setConfirmStop(true); return; }
    if (errors.length) { problemMenu(e); return; }
    if (needsArcads) { onConnect?.(); return; }
    void openGate('all');
  };
  const runTitle = running ? 'Stop the run. Requests Arcads already accepted stay charged.' : runBlocked ?? (errors.length ? `Fix ${plural(errors.length, 'problem')} first` : needsArcads ? 'Connect Arcads to run paid nodes' : 'Run: shows what it will cost first (Cmd/Ctrl+Enter)');
  const runLabel = busy === 'run' ? 'Starting' : busy === 'stop' ? 'Stopping' : running ? 'Stop' : errors.length ? `Fix ${errors.length} first` : needsArcads ? 'Connect Arcads' : allDone ? 'Run again' : 'Run';
  const showLabels = view.k >= 0.8;
  const gateErrors = gate?.plan ? blockingProblems(gate.plan.problems) : [];

  const builder = (
    // `expanded` while the builder holds an Escape layer: the console's own Escape guard (MotionConsole) looks for it, so one Esc never closes both
    <div ref={setRootEl} className={`ae-o-graph wf${full ? ' full' : ''}${anyLayer ? ' expanded' : ''}`}>
      <div className="ae-o-wf-bar">
        {renaming !== null && wf ? (
          <span className="ae-o-pill dark ae-o-wf-rename" style={{ gap: 6 }}>
            <Layers className="h-3.5 w-3.5 text-[var(--o-muted)]" strokeWidth={1.8} />
            <OInput autoFocus value={renaming} maxLength={80} aria-label="Workflow name" onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(renaming); } }} onBlur={() => rename(renaming)} />
          </span>
        ) : (
          <OBtn kind="pill" cls="ae-o-pill dark ae-o-wf-switch"  style={{ gap: 6 }} onClick={switcherMenu} disabled={!campaignId} aria-haspopup="menu" title={wf ? 'Switch, create, rename, duplicate or delete workflows' : 'Workflows'}>
            <Layers className="h-3.5 w-3.5 text-[var(--o-muted)]" strokeWidth={1.8} />
            <span className="nm">{wf ? wf.name : list.length ? 'Pick a workflow' : 'No workflow'}</span>
            <ChevronDown className="h-3 w-3 text-[var(--o-muted)]" strokeWidth={2} />
          </OBtn>
        )}
        {sample && <span className="ae-o-wf-badge" title="The sample is fictional and read only">Sample</span>}
        {wf && !readOnly && <OBtn kind="pill" cls="ae-o-pill"  style={{ gap: 6 }} onClick={openPaletteCentre} disabled={locked} title="Add a node at the centre of the view (Cmd/Ctrl+K or /)"><SquarePlus className="h-3.5 w-3.5" strokeWidth={2} /> Add node</OBtn>}
        {wf && !readOnly && (
          <span className="ae-o-wf-hist" role="group" aria-label="History">
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={() => travel('undo')} disabled={locked || !hist.current.canUndo} title={hist.current.undoLabel ? `Undo: ${hist.current.undoLabel} (Cmd/Ctrl+Z)` : 'Nothing to undo'} aria-label={hist.current.undoLabel ? `Undo ${hist.current.undoLabel}` : 'Undo'}><Undo2 className="h-4 w-4" strokeWidth={1.8} /></OBtn>
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={() => travel('redo')} disabled={locked || !hist.current.canRedo} title={hist.current.redoLabel ? `Redo: ${hist.current.redoLabel} (Cmd/Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label={hist.current.redoLabel ? `Redo ${hist.current.redoLabel}` : 'Redo'}><Redo2 className="h-4 w-4" strokeWidth={1.8} /></OBtn>
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={doTidy} disabled={locked || wf.nodes.length < 2} title="Tidy: lay the nodes out left to right" aria-label="Tidy the layout"><LayoutGrid className="h-4 w-4" strokeWidth={1.8} /></OBtn>
          </span>
        )}
        <span className="ae-o-wf-problems" role="status"><span data-sel={selEdges.length || selNodes.length ? '' : undefined}>{statusText}</span></span>
        {toFix.length > 0 && <OBtn kind="row" cls="ae-o-wf-chip" keep="ae-o-wf-chip"  data-level={errors.length ? 'error' : 'warn'} onClick={problemMenu} aria-haspopup="menu" title={toFix.map((p) => p.message).join('\n')}>{toFix.length} to fix</OBtn>}
        {saveLabel && (saveLabel === 'error'
          ? <span className="ae-o-wf-save" data-state="error" role="alert">Couldn&apos;t save · <OBtn kind="row" onClick={retry}>Retry</OBtn></span>
          : <span className="ae-o-wf-save" data-state={saveState} role="status">{saveLabel}</span>)}
        <span className="ml-auto flex items-center gap-2">
          {wf?.runStartedAt && !readOnly && !running && <OBtn kind="icon-sm" cls="ae-o-icon sm"  title="Clear run results: removes status rings and previews so the canvas shows the design only. Delivered assets stay in the campaign." aria-label="Clear run results" onClick={reset} disabled={busy !== null}><RotateCcw className="h-4 w-4" strokeWidth={1.8} /></OBtn>}
          {wf && <OBtn kind="icon-sm" cls="ae-o-icon sm"  title="Keyboard shortcuts and tips (?)" aria-label="Keyboard shortcuts" onClick={() => setShortcuts(true)}><CircleHelp className="h-4 w-4" strokeWidth={1.8} /></OBtn>}
          {wf && <OBtn kind="icon-sm" cls="ae-o-icon sm"  title="More: save version, history, delete" aria-label="More" aria-haspopup="menu" onClick={overflowMenu}><MoreHorizontal className="h-4 w-4" strokeWidth={1.8} /></OBtn>}
          <OBtn kind="pill" cls="ae-o-pill"  style={{ gap: 6 }} aria-pressed={full} title={full ? 'Back to the console (Esc or Shift+F)' : 'Fill the screen with the builder (Shift+F)'} onClick={toggleFull}>{full ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />} {full ? 'Exit full screen' : 'Full screen'}</OBtn>
          {!readOnly && (
            <span className="ae-o-wf-run">
              <OBtn kind="primary" cls="ae-o-generate" data-run-button  style={{ height: 32, fontSize: 13 }} data-busy={busy === 'run' || busy === 'stop'} data-stop={running || undefined} data-blocked={errors.length > 0 || undefined} disabled={!!runBlocked || !!preview || (busy !== null && busy !== 'new')} title={runTitle} aria-label={runTitle} onClick={onRunClick}>{running ? <Square className="h-3 w-3" strokeWidth={2.4} /> : <i />} {runLabel}</OBtn>
              {!running && <OBtn kind="row" cls="ae-o-wf-caret" keep="ae-o-wf-caret"  aria-label="Run scope: all, failed only, from a node" aria-haspopup="menu" title="Run all, failed only, or from the selected node" disabled={!!runBlocked || !!preview || busy !== null || errors.length > 0 || needsArcads} onClick={scopeMenu}><ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} /></OBtn>}
            </span>
          )}
        </span>
      </div>

      {conflict && (
        <div className="ae-o-wf-banner" role="alert">
          <span>This workflow changed in another tab.</span>
          <OBtn kind="pill" cls="ae-o-pill"  onClick={reloadTheirs}>Reload it</OBtn>
          <OBtn kind="pill" cls="ae-o-pill"  onClick={keepMine}>Keep mine</OBtn>
        </div>
      )}
      {preview && (
        <div className="ae-o-wf-banner" role="status">
          <span>Viewing v{preview.n} · read only</span>
          {!readOnly && <OBtn kind="pill" cls="ae-o-pill"  onClick={() => void restoreVersion(preview)}>Restore</OBtn>}
          <OBtn kind="pill" cls="ae-o-pill"  onClick={() => setPreview(null)}>Close</OBtn>
        </div>
      )}

      <div
        ref={setStageEl}
        className="ae-o-wf-stage"
        role="application"
        aria-label="Workflow canvas"
        tabIndex={0}
        data-g-exempt={g ? 'Workflow canvas: an application surface (pan, zoom, wire), its buttons are kit buttons' : undefined}
        style={!full && stageH ? { height: stageH } : undefined}
        data-panning={drag?.kind === 'pan'}
        data-wiring={!!wiring}
        data-space={spaceRef.current || undefined}
        data-drop={hotVerdict ? DROP[hotVerdict.kind] : undefined}
        data-labels={showLabels || undefined}
        data-glyphs={view.k >= 1 || undefined}
        data-preview={preview ? '' : undefined}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={() => cancelDrag()}
        onDoubleClick={onStageDbl}
        onContextMenu={onStageMenu}
      >
        {!campaignId && <div className="ae-o-wf-empty"><div>Open a campaign to build a workflow.{onChooseCampaign && <div className="chips"><OBtn kind="pill" cls="ae-o-pill ae-o-wf-empty-act"  onClick={onChooseCampaign}>{chooseLabel}</OBtn></div>}</div></div>}
        {campaignId && !wf && !readOnly && listLoaded && list.length === 0 && templates.length > 0 && <StartCard templates={templates} approvedScript={approvedScript} busy={busy === 'new'} onPick={(t) => void create(t)} onScripter={onScripter} />}
        {campaignId && !wf && readOnly && <div className="ae-o-wf-empty"><div>This campaign has no workflow.</div></div>}
        {wf && shown && shown.nodes.length === 0 && !locked && <EmptyCanvas onAdd={quickAdd} />}
        <div className="ae-o-wf-world" data-animate={animate || undefined} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          {shown && (
            <svg className="ae-o-wf-wires" width={1} height={1} aria-hidden>
              {shown.edges.map((e) => {
                if (e.id === hiddenEdge) return null;
                const a = shown.nodes.find((n) => n.id === e.from); const b = shown.nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const t = NODE_SPECS[a.type].outputs.find((p) => p.name === e.fromPort)?.type ?? 'text';
                return <path key={e.id} d={wirePath(portPos(a, e.fromPort, 'out'), portPos(b, e.toPort, 'in'))} className={`ae-o-wf-wire ${t}`} data-hover={hoverEdge === e.id || undefined} data-selected={selEdges.includes(e.id) || undefined} data-replacing={replacing === e.id || undefined} />;
              })}
              {wiring && (() => { const a = shown.nodes.find((n) => n.id === wiring.from); return a ? <path d={wirePath(portPos(a, wiring.port, 'out'), { x: wiring.x, y: wiring.y })} className={`ae-o-wf-wire temp ${wiring.type}`} /> : null; })()}
              {!wiring && palette?.connect && (() => { const a = shown.nodes.find((n) => n.id === palette.connect!.from); return a ? <path d={wirePath(portPos(a, palette.connect.port, 'out'), { x: palette.wx, y: palette.wy })} className={`ae-o-wf-wire temp ${palette.connect.type}`} /> : null; })()}
            </svg>
          )}
          {shown?.nodes.map((n) => {
            const spec = NODE_SPECS[n.type]; const st = preview ? 'idle' : status[n.id] ?? 'idle'; const asset = preview ? null : assetFor(n.outputAssetId);
            const isSel = selNodes.includes(n.id);
            const endOfSel = selEdges.some((id) => { const e = shown.edges.find((x) => x.id === id); return e && (e.from === n.id || e.to === n.id); });
            const np = problemsByNode.get(n.id) ?? [];
            const level = np.some((p) => p.level === 'error') ? 'error' : np.some((p) => p.level === 'warn') ? 'warn' : undefined;
            const rows = Math.max(spec.inputs.length, spec.outputs.length);
            const finals = n.type === 'deliver' && lastDelivery && !preview ? lastDelivery.assetIds.map((id) => assetFor(id)).filter((x): x is NonNullable<typeof x> => !!x) : [];
            return (
              <div key={n.id} data-node-id={n.id} className="ae-o-wf-node" data-missing-type={n.type === 'missing' || undefined} data-selected={isSel} data-status={st} data-problem={level} role="group" aria-label={`${n.title}, ${spec.label}, ${st}${np.length ? `, ${plural(np.length, 'problem')}` : ''}`} style={{ left: n.x, top: n.y, ['--node' as string]: `var(${spec.tint})`, minHeight: 46 + 14 + rows * PORT_GAP }}>
                <div className="ae-o-wf-head">
                  <span className="ae-o-node-icon">{NODE_ICON[n.type]}</span>
                  {renamingNode?.id === n.id ? (
                    <OInput cls="ae-o-wf-title-edit"  autoFocus value={renamingNode.value} maxLength={60} aria-label="Node title" onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setRenamingNode({ id: n.id, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                      onBlur={() => { const v = renamingNode.value.trim(); setRenamingNode(null); if (v && v !== n.title) patchNode(n.id, { title: v }, undefined, 'rename node'); }} />
                  ) : <b title="Double-click to rename">{n.title || spec.label}</b>}
                  {np.length > 0 && <span className="ae-o-wf-pbadge" data-level={level} title={np.map((p) => p.message).join('\n')} aria-label={`${plural(np.length, 'problem')}: ${np.map((p) => p.message).join('; ')}`}>{np.length}</span>}
                  <span className="ae-o-wf-ring" data-status={st} title={st} />
                </div>
                <div className="ae-o-wf-body" style={{ paddingTop: rows ? rows * PORT_GAP + 2 : undefined }}>
                  <NodeSummary n={n} campaign={campaign} claudeMissing={claudeMissing} />
                  {asset && (asset.path ? <div className="ae-o-wf-body">{asset.kind === 'video' && !asset.thumbnailPath && engineDry
                    ? <div className="out ae-o-arrive">dry placeholder</div>
                    : <OBtn kind="row" cls="out ae-o-arrive ae-o-wf-preview" keep="out ae-o-arrive ae-o-wf-preview"  title="Open the preview" aria-label={`Open ${n.title}'s output`} onClick={() => setLightbox({ kind: asset.kind === 'video' ? 'video' : 'image', path: asset.path!, label: `${n.title} · ${asset.model}` })}>{asset.kind === 'video' ? (asset.thumbnailPath ? <img src={asset.thumbnailPath} alt="" /> : <video src={asset.path} muted />) : <img src={asset.path} alt="" />}</OBtn>}</div> : null)}
                  {finals.length > 0 && (
                    <div className="ae-o-wf-finals" aria-label={plural(finals.length, 'final output')}>
                      {finals.slice(0, 4).map((a) => (a.path
                        ? <OBtn kind="row" key={a.id} title={`${a.model} · ${hhmm(a.at)}. Open the preview`} aria-label={`Open the final ${a.kind} from ${a.model}`} onClick={() => setLightbox({ kind: a.kind === 'video' ? 'video' : 'image', path: a.path!, label: `Final · ${a.model} · ${hhmm(a.at)}` })}>{a.thumbnailPath || a.kind === 'image' ? <img src={a.thumbnailPath ?? a.path} alt="" /> : <i>{a.kind}</i>}</OBtn>
                        : <span key={a.id} title={`${a.model} · ${hhmm(a.at)}`}><i>{a.kind}</i></span>))}
                      {finals.length > 4 && <span className="more">+{finals.length - 4}</span>}
                    </div>
                  )}
                  {n.error && <div className="err">{n.error}</div>}
                  <div className="ae-o-wf-cost">{n.type === 'missing' ? 'not runnable' : isPaid(n) ? <><CircleDollarSign className="h-3 w-3" strokeWidth={2} />paid</> : 'local'}</div>
                </div>
                <div className="ae-o-wf-ports in">{spec.inputs.map((p) => {
                  const key = `${n.id}|${p.name}`; const links = inbound.get(key) ?? [];
                  const v = wiring ? verdicts.get(key) : undefined;
                  const from = links.map((x) => shown.nodes.find((m) => m.id === x.from)?.title).filter(Boolean).join(', ');
                  const endSel = endOfSel && links.some((x) => selEdges.includes(x.id));
                  return (
                    <div key={p.name} className="ae-o-wf-port" data-in-port={key} data-type={p.type} data-required={!!p.required} data-missing={(p.required && !links.length) || undefined} data-linked={links.length > 0 || undefined} data-drop={v ? DROP[v.kind] : undefined} data-hot={hot === key} data-end={endSel || undefined}>
                      {links.length > 0 && !locked && !wiring && <OBtn kind="row" cls="ae-o-wf-port-x" keep="ae-o-wf-port-x"  aria-label={`Remove the link${links.length > 1 ? 's' : ''} into ${n.title} ${p.name}`} title={links.length > 1 ? `Remove a link into ${p.name}` : `Remove the link into ${p.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => portX(e, n, p.name)}><X className="h-2.5 w-2.5" strokeWidth={2.4} /></OBtn>}
                      <i title={`${p.name} · ${p.type}${p.required ? ', required' : ''}${p.many ? ', takes several' : ''}${from ? ` · linked from ${from}. Drag to move the link.` : ''}`} />
                      <span>{p.name}</span>
                    </div>
                  );
                })}</div>
                <div className="ae-o-wf-ports out">{spec.outputs.map((p) => {
                  const endSel = selEdges.some((id) => { const e = shown.edges.find((x) => x.id === id); return e && e.from === n.id && e.fromPort === p.name; });
                  return (<div key={p.name} className="ae-o-wf-port" data-out-port={`${n.id}|${p.name}`} data-type={p.type} data-source={wiring && wiring.from === n.id && wiring.port === p.name ? '' : undefined} data-end={endSel || undefined}><i title={`${p.name} · ${p.type}. Drag to link it to an input.`} /><span>{p.name}</span></div>);
                })}</div>
              </div>
            );
          })}
          {shown && !wiring && (
            <svg className="ae-o-wf-hits" width={1} height={1}>
              {shown.edges.map((e) => {
                if (e.id === hiddenEdge) return null;
                const a = shown.nodes.find((n) => n.id === e.from); const b = shown.nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const pa = portPos(a, e.fromPort, 'out'); const pb = portPos(b, e.toPort, 'in');
                // stop 8px short of each ring so the ports stay pressable (pick up, new wire)
                return (
                  <path key={e.id} className="ae-o-wf-hit" data-edge-id={e.id} d={wirePath({ x: pa.x + 8, y: pa.y }, { x: pb.x - 8, y: pb.y })}
                    onPointerEnter={() => edgeHover(e.id)} onPointerLeave={() => edgeHover(null)}
                    onClick={(ev) => selectEdge(e.id, ev.shiftKey)}
                    onDoubleClick={(ev) => { ev.stopPropagation(); deleteEdges([e.id]); }}
                    onContextMenu={(ev) => edgeMenu(ev, e)}>
                    <title>{`${a.title}.${e.fromPort} → ${b.title}.${e.toPort}`}</title>
                  </path>
                );
              })}
            </svg>
          )}
          {shown && !wiring && !locked && [...new Set([hoverEdge, ...selEdges].filter((x): x is string => !!x))].map((id) => {
            const e = shown.edges.find((x) => x.id === id); if (!e || e.id === hiddenEdge) return null;
            const a = shown.nodes.find((n) => n.id === e.from); const b = shown.nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            const m = wireMid(portPos(a, e.fromPort, 'out'), portPos(b, e.toPort, 'in'), 18 / view.k);
            return <OBtn kind="row" cls="ae-o-wf-edge-x" keep="ae-o-wf-edge-x" key={id}  style={{ left: m.x, top: m.y, transform: `translate(-50%, -50%) scale(${1 / view.k})` }} aria-label={`Remove the link ${a.title} to ${b.title}`} title="Remove this link" onPointerEnter={() => edgeHover(id)} onPointerLeave={() => edgeHover(null)} onPointerDown={(ev) => ev.stopPropagation()} onClick={() => deleteEdges([id])}><X className="h-3 w-3" strokeWidth={2.4} /></OBtn>;
          })}
          {drag?.kind === 'marquee' && <div className="ae-o-wf-marquee" aria-hidden style={{ left: Math.min(drag.x1, drag.x2), top: Math.min(drag.y1, drag.y2), width: Math.abs(drag.x2 - drag.x1), height: Math.abs(drag.y2 - drag.y1) }} />}
        </div>

        {hint && <div className="ae-o-wf-hint" role="status">Click to scroll the canvas</div>}

        {shown && (
          <div className="ae-o-wf-zoom" role="toolbar" aria-label="Zoom">
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={() => zoomCentre(1 / 1.2)} disabled={view.k <= K_MIN + 0.001} title="Zoom out (−)" aria-label="Zoom out"><Minus className="h-3.5 w-3.5" strokeWidth={2} /></OBtn>
            <OBtn kind="row" cls="readout" keep="readout"  onClick={() => zoomTo(1)} title="Reset to 100% (0)" aria-label={`Zoom ${Math.round(view.k * 100)}%. Reset to 100%`}>{Math.round(view.k * 100)}%</OBtn>
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={() => zoomCentre(1.2)} disabled={view.k >= K_MAX - 0.001} title="Zoom in (+)" aria-label="Zoom in"><Plus className="h-3.5 w-3.5" strokeWidth={2} /></OBtn>
            <OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={() => fit(selNodes)} disabled={!shown.nodes.length} title={selNodes.length ? 'Fit the selection (F)' : 'Fit the whole workflow (F)'} aria-label="Fit to view"><Scan className="h-3.5 w-3.5" strokeWidth={2} /></OBtn>
          </div>
        )}
        {shown && shown.nodes.length > 0 && (
          <div className="ae-o-wf-legend" data-open={legend || undefined}>
            <OBtn kind="row" onClick={() => setLegend((v) => !v)} aria-expanded={legend} title="What the port colours mean">Ports</OBtn>
            {legend && <ul>{(['text', 'image', 'video', 'audio'] as const).map((t) => <li key={t} data-type={t}><i />{t}</li>)}<li data-type="text" data-missing><i />required, not linked</li></ul>}
          </div>
        )}

        {versions && wf && (
          <VersionsPanel versions={versions.list} loading={versions.loading} previewing={preview?.n ?? null} readOnly={readOnly}
            onPreview={(v) => { setSelNodes([]); setSelEdges([]); setPreview((p) => (p?.n === v.n ? null : v)); }}
            onRestore={(v) => void restoreVersion(v)} onSave={() => void saveVersion()} onClose={() => { setVersions(null); setPreview(null); }} />
        )}
        {!versions && sel && shown && (
          <NodeSheet key={sel.id} n={sel} wf={shown} status={preview ? 'idle' : status[sel.id] ?? 'idle'} problems={problemsByNode.get(sel.id) ?? []} campaign={campaign} health={health} dry={engineDry} readOnly={locked} consoleControls={consoleControls} runs={runs}
            onChange={(p) => patchSettings(sel.id, p)} onNode={(p) => patchNode(sel.id, p, `node:${sel.id}:${Object.keys(p).join(',')}`, 'rename node')} onClose={() => setSelNodes([])} onRemove={() => deleteNodes([sel.id])} onFeed={(port, type) => feedPort(sel, port, type)} />
        )}
        <ToastStack items={toasts} anchor onDismiss={dismiss} />
      </div>
      {!full && (
        <div
          className="ae-o-wf-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the builder"
          data-g-exempt={g ? 'Builder resize grip: a separator, not a control role the kit draws' : undefined}
          aria-valuemin={H_MIN}
          aria-valuenow={stageH ?? undefined}
          tabIndex={0}
          title="Drag to resize. Double-click for the largest size, again for the default."
          onPointerDown={(e) => { e.preventDefault(); grip.current = { sy: e.clientY, h: curH() }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }}
          onPointerMove={(e) => { const g = grip.current; if (g) setHeight(g.h + (e.clientY - g.sy)); }}
          onPointerUp={(e) => { grip.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
          onDoubleClick={() => setHeight(curH() < maxH() - 2 ? maxH() : null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setHeight(curH() + (e.key === 'ArrowDown' ? 24 : -24)); }
            else if (e.key === 'Home') { e.preventDefault(); setHeight(H_MIN); }
            else if (e.key === 'End') { e.preventDefault(); setHeight(maxH()); }
          }}
        ><i /></div>
      )}
      {palette && portalRoot && (
        <Palette at={palette.at} title={palette.title} ctx={palette.ctx} recent={recentTypes} needsArcads={!health.arcads.configured && !engineDry} needsClaude={claudeMissing} container={portalRoot} onPick={pick} onClose={() => setPalette(null)} />
      )}
      {menu && portalRoot && <ContextMenu at={menu.at} label={menu.label} items={menu.items} wide={menu.wide} container={portalRoot} onClose={() => setMenu(null)} />}
      {coach !== null && portalRoot && !palette && !menu && !gate && <Coach step={coach} scope={rootEl} container={portalRoot} onNext={() => (coach + 1 >= COACH_STEPS.length ? endCoach() : setCoach(coach + 1))} onSkip={endCoach} />}
      {shortcuts && portalRoot && <Shortcuts container={portalRoot} dry={engineDry} onClose={() => setShortcuts(false)} onTips={() => { writeLocal(COACH_KEY, ''); setShortcuts(false); setCoach(0); }} />}
      {gate && wf && portalRoot && (
        <SpendGate
          title={gate.scope === 'all' ? 'Run workflow' : gate.scope === 'failed' ? 'Run failed only' : `Run from ${wf.nodes.find((n) => n.id === gate.nodeId)?.title ?? 'node'}`}
          dry={gate.plan?.dry ?? engineDry}
          lines={(gate.plan?.paid ?? []).map((p) => ({
            key: p.nodeId,
            label: <>{p.title}{p.model ? <span className="m"> · {p.model}</span> : null}</>,
            detail: [p.detail, p.enhance ? '+8 credits for enhancement' : ''].filter(Boolean).join(' · ') || undefined,
            note: p.lastCharged ? `last charged ${fmtCredits(p.lastCharged.credits)} credits on ${p.lastCharged.model} (history, not a quote)` : undefined,
          }))}
          balance={health.arcads.balance?.creditsRemaining ?? null}
          sessionSpent={health.arcads.sessionSpent}
          sessionCap={health.arcads.sessionCap}
          capAsk={gate.capAsk}
          blocked={gate.error ?? (gate.plan ? gate.plan.blocked ?? (gateErrors.length ? `Fix ${plural(gateErrors.length, 'problem')} first: ${gateErrors[0].message}` : null) : 'Reading the plan…')}
          busy={busy === 'run'}
          confirmLabel={(gate.plan?.dry ?? engineDry) ? 'Run dry' : `Run${(gate.plan?.paid.length ?? 0) > 1 ? ` ×${gate.plan?.paid.length}` : ''}`}
          container={portalRoot}
          onConfirm={(o) => void run(o)}
          onCancel={() => setGate(null)}
        >
          {gate.plan && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--o-muted)]">
              <li>{plural(gate.plan.local.length, 'local step')} (text, script, files, Claude, enhance, Deliver): no Arcads charge</li>
              {gate.plan.paid.some((p) => p.delivered) && <li className="ae-o-spend-warn">{plural(gate.plan.paid.filter((p) => p.delivered).length, 'node')} already delivered will be charged again. Run failed only re-sends just what failed.</li>}
            </ul>
          )}
        </SpendGate>
      )}
      {/* X1 dialogs, portalled to the console root: the builder sits under an animated (transformed) ancestor, which would trap a fixed overlay */}
      {confirmDelete && wf && portalRoot && (
        <ConfirmDialog title={`Delete \u201c${wf.name}\u201d?`} container={portalRoot} danger confirmLabel="Delete" onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}
          body={<>Its {plural(wf.nodes.length, 'node')} and {plural(wf.edges.length, 'link')} are removed. Assets it already delivered stay in the campaign.</>} />
      )}
      {confirmStop && wf && portalRoot && (
        <ConfirmDialog title="Stop this run?" container={portalRoot} danger cancelLabel="Keep running" confirmLabel="Stop" onCancel={() => setConfirmStop(false)} onConfirm={() => void stop()}
          body={<>Nothing new is sent to Arcads. Requests already sent to Arcads keep running and stay charged; {BRAND.name} stops tracking them, and their results stay in your Arcads library. Nodes that haven&apos;t finished are marked stopped; Run failed only picks them up again.</>} />
      )}
      {discard && wf && portalRoot && (
        <ConfirmDialog title="Discard unsaved changes?" container={portalRoot} danger cancelLabel="Keep editing" confirmLabel="Discard" onCancel={() => setDiscard(null)} onConfirm={discardAndGo}
          body={<>Your last edits to &ldquo;{wf.name}&rdquo; couldn&apos;t be saved. Keep editing to retry the save, or discard them and go on. The server keeps the last version it saved.</>} />
      )}
      {lightbox && portalRoot && <Lightbox asset={lightbox} container={portalRoot} onClose={() => setLightbox(null)} />}
    </div>
  );

  if (!full) return builder;
  return (
    <>
      {/* keeps the console's layout while the builder is lifted out */}
      <div aria-hidden style={{ height: dockedH.current ?? undefined }} />
      {createPortal(<div className="ae-octane ae-o-wf-full" role="dialog" aria-modal="true" aria-label="Workflow builder, full screen">{builder}</div>, document.body)}
    </>
  );
}
/* ───────────────────────────── node summaries ───────────────────────────── */

function NodeSummary({ n, campaign, claudeMissing = false }: { n: WorkflowNode; campaign: Campaign | null; claudeMissing?: boolean }) {
  const s = n.settings as Record<string, unknown>;
  switch (n.type) {
    case 'text': return <div className="excerpt">{String(s.text || '') || 'Empty. Click to write.'}</div>;
    case 'script': { const sc = campaign?.scripts.find((x) => x.id === s.scriptId); const v = sc?.versions.find((x) => x.n === sc.approvedVersion) ?? sc?.versions.at(-1); const beat = typeof s.beat === 'number' ? v?.beats[s.beat] : null; return <div className="excerpt">{v ? (beat ? `${beat.name}: ${beat.spoken}` : v.fullScript) : 'Pick a script.'}</div>; }
    case 'media': return <div>{String(s.path || '') ? `${s.kind}: ${String(s.path).split('/').pop()}` : 'No file yet.'}</div>;
    case 'asset': return <div>{s.assetId ? `Campaign asset ${String(s.assetId).slice(0, 12)}` : s.arcadsAssetId ? `Library ${String(s.arcadsAssetId).slice(0, 8)}` : 'Pick an asset.'}</div>;
    case 'llm': return <div className="excerpt">{claudeMissing && <span className="ae-o-wf-needs-note">Claude not available on this host<br /></span>}{String(s.instruction || '')}{n.outputText ? <><br /><span style={{ color: 'var(--o-text)' }}>{n.outputText.slice(0, 120)}</span></> : null}</div>;
    case 'enhance': return <div>Arcads rewrites the prompt before the consumer runs (+8 credits there).</div>;
    case 'video': return <div>{String(s.model ?? 'seedance-2.0')} · {String(s.duration ?? 8)}s · {String(s.aspectRatio ?? '9:16')}{s.resolution ? ` · ${String(s.resolution)}` : ''}</div>;
    case 'image': return <div>{String(s.model)} · {String(s.aspectRatio)}</div>;
    case 'talkingActor': case 'audioDriven': case 'omnihuman': return <div>{s.situationId ? `Scene ${String(s.situationId).slice(0, 8)}` : 'No scene picked'}{s.voiceId ? ' · voice set' : ' · voice matched'}</div>;
    case 'veo31': return <div>Veo 3.1 · {String(s.resolution)} · {String(s.aspectRatio)}</div>;
    case 'videoEdit': return <div>Omni Flash{s.aspectRatio ? ` · ${String(s.aspectRatio)}` : ''}{s.duration ? ` · ${String(s.duration)}s` : ''}</div>;
    case 'broll': return <div>{String(s.duration)}s · {String(s.aspectRatio)}</div>;
    case 'scene': return <div>{String(s.aspectRatio)}{s.contextPrompt ? ' · with context' : ''}</div>;
    case 'music': return <div>{String(s.model)} · {String(s.duration)}s{s.instrumentalOnly ? ' · instrumental' : ''}</div>;
    case 'preset': return <div>{String(s.presetType)}{s.situationId ? ` · ${String(s.situationId).slice(0, 8)}` : ' · no template'}</div>;
    case 'deliver': return <div>Collects the final outputs of this workflow.</div>;
    case 'missing': return <div>Was a {String(s.originalType ?? 'unknown')} node. That type no longer exists: remove it or replace it.</div>;
    default: return null;
  }
}

/* ───────────────────────────── settings sheet ───────────────────────────── */

type SheetProps = { n: WorkflowNode; wf: Workflow; status: NodeStatus; problems: GraphProblem[]; campaign: Campaign | null; health: HealthSnapshot; dry: boolean; readOnly: boolean; consoleControls: ConsoleControls; runs: ResolvedRun[]; onChange: (p: Record<string, unknown>) => void; onNode: (p: Partial<WorkflowNode>) => void; onClose: () => void; onRemove: () => void; onFeed: (port: string, type: PortType) => void };

function NodeSheet({ n, wf, status, problems, campaign, health, dry, readOnly, consoleControls, runs, onChange, onNode, onClose, onRemove, onFeed }: SheetProps) {
  const s = n.settings as Record<string, unknown>;
  const spec = NODE_SPECS[n.type];
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [templates, setTemplates] = useState<ArcadsSituation[]>([]);
  const [library, setLibrary] = useState<AssetResponse[]>([]);
  const [q, setQ] = useState('');
  const needsCatalog = n.type === 'talkingActor' || n.type === 'audioDriven' || n.type === 'omnihuman';
  useEffect(() => { if (needsCatalog) api.catalog().then(setCatalog).catch(() => {}); }, [needsCatalog]);
  useEffect(() => { if (n.type === 'preset') api.presetTemplates(String(s.presetType ?? 'gestures')).then((r) => setTemplates(r.templates)).catch(() => {}); }, [n.type, s.presetType]);
  useEffect(() => { if (n.type === 'asset' && health.arcads.configured) api.library({ q: q || undefined }).then((r) => setLibrary(r.items)).catch(() => {}); }, [n.type, q, health.arcads.configured]);
  const run = runs.find((r) => r.id === n.runId);
  const asset = n.outputAssetId ? campaign?.assets.find((a) => a.id === n.outputAssetId) : null;
  const str = (k: string, d = '') => String(s[k] ?? d);
  const num = (k: string, d: number) => Number(s[k] ?? d);
  const vm = (s.model as string) in MODEL_RULES ? (s.model as keyof typeof MODEL_RULES) : 'seedance-2.0';
  const rule = MODEL_RULES[vm]; const dr = DURATION_RULES[vm];
  const situations = (catalog?.actors ?? []).flatMap((a) => a.situations.map((sit) => ({ ...sit, actor: a })));

  return (
    <div className="ae-o-wf-sheet" onPointerDown={(e) => e.stopPropagation()}>
      <h4><span className="ae-o-node-icon" style={{ width: 22, height: 22 }}>{NODE_ICON[n.type]}</span><OInput cls="ae-o-text min-w-0 flex-1" keep="min-w-0 flex-1" value={n.title} maxLength={60} onChange={(e) => onNode({ title: e.target.value })}  aria-label="Node title" disabled={readOnly} /><span className="ae-o-wf-ring" data-status={status} /><OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={onClose} title="Close" aria-label="Close the settings"><X className="h-4 w-4" strokeWidth={2} /></OBtn></h4>
      <div className="hint">{spec.hint}.</div>
      {n.type === 'llm' && !dry && !readOnly && health.claude?.present === false && <div className="hint ae-o-wf-needs-note">Claude not available on this host: this node fails at run until Claude Code is installed here.</div>}
      {/* what this node needs (FR-53): each input, its type, and where it comes from */}
      {spec.inputs.length > 0 && (
        <table className="ae-o-wf-needs"><tbody>
          {spec.inputs.map((p) => {
            const src = wf.edges.filter((e) => e.to === n.id && e.toPort === p.name).map((e) => wf.nodes.find((x) => x.id === e.from)?.title).filter(Boolean);
            return (
              <tr key={p.name} data-type={p.type}>
                <td><i aria-hidden />{p.name}{p.required && <em title="required">*</em>}</td>
                <td>{p.type}{p.many ? ', several' : ''}</td>
                <td>{src.length ? `from ${src.join(', ')}` : readOnly ? 'not linked' : <OBtn kind="row" onClick={() => onFeed(p.name, p.type)} title={`Add a node that gives ${p.type} and link it here`}>not linked</OBtn>}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      {problems.length > 0 && <ul className="ae-o-wf-sheet-problems">{problems.map((p, i) => <li key={i} data-level={p.level}>{p.message}</li>)}</ul>}
      {/* read only (the sample, a version preview): every control below is disabled, the sheet still reads */}
      <fieldset disabled={readOnly} className="ae-o-wf-fields">

      {n.type === 'text' && <TextAreaRow label="Text" value={str('text')} placeholder="A prompt, a script, or any text" rows={6} onChange={(v) => onChange({ text: v })} />}
      {n.type === 'script' && (<>
        <SelectRow label="Script" value={str('scriptId', '')} options={['', ...(campaign?.scripts ?? []).map((x) => x.id)]} labels={Object.fromEntries([['', 'pick'], ...(campaign?.scripts ?? []).map((x) => [x.id, (campaign?.angles.find((a) => a.id === x.angleId)?.title ?? x.id).slice(0, 28)])])} onChange={(v) => onChange({ scriptId: v || null, beat: null })} />
        {(() => { const sc = campaign?.scripts.find((x) => x.id === s.scriptId); const v = sc?.versions.find((x) => x.n === sc.approvedVersion) ?? sc?.versions.at(-1); return v ? <SelectRow label="Part" value={typeof s.beat === 'number' ? String(s.beat) : 'all'} options={['all', ...v.beats.map((_, i) => String(i))]} labels={Object.fromEntries([['all', 'whole script'], ...v.beats.map((b, i) => [String(i), `${b.name} · ${b.seconds}s`])])} onChange={(x) => onChange({ beat: x === 'all' ? null : Number(x) })} /> : null; })()}
      </>)}
      {n.type === 'media' && (<>
        <SelectRow label="Kind" value={str('kind', 'image')} options={['image', 'video', 'audio'] as const} onChange={(v) => onChange({ kind: v })} />
        <TextRow label="Path" value={str('path')} placeholder="/absolute/path/file" onChange={(v) => onChange({ path: v })} />
        <div className="hint">A local file on this machine, uploaded fresh for every request that uses it.</div>
      </>)}
      {n.type === 'asset' && (<>
        <SelectRow label="Kind" value={str('kind', 'video')} options={['video', 'image'] as const} onChange={(v) => onChange({ kind: v })} />
        <div className="hint">This campaign</div>
        <div className="tile">{(campaign?.assets ?? []).filter((a) => a.path).slice(-9).reverse().map((a) => (<OBtn kind="row" key={a.id} data-on={s.assetId === a.id} onClick={() => onChange({ assetId: a.id, arcadsAssetId: null, kind: a.kind })} title={`${a.model} · ${a.at}`}>{a.thumbnailPath || a.kind === 'image' ? <img src={a.thumbnailPath ?? a.path!} alt="" /> : null}<span>{a.model}</span></OBtn>))}</div>
        {health.arcads.configured && (<><div className="hint">Arcads library</div><OInput cls="ae-o-text w-full" keep="w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts and scripts"  /><div className="tile">{library.slice(0, 12).map((a) => (<OBtn kind="row" key={a.id} data-on={s.arcadsAssetId === a.id} onClick={() => onChange({ arcadsAssetId: a.id, assetId: null, kind: /image|photo|seedream|banana|soul/.test(a.type) ? 'image' : 'video' })} title={a.type}>{a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" /> : null}<span>{a.type}</span></OBtn>))}</div></>)}
      </>)}
      {n.type === 'llm' && <TextAreaRow label="Instruction" value={str('instruction')} placeholder="What Claude should do with the input" rows={4} onChange={(v) => onChange({ instruction: v })} />}
      {n.type === 'video' && (<>
        <SelectRow bound label="Model" value={vm} options={VIDEO_MODELS} onChange={(v) => onChange({ model: v, resolution: MODEL_RULES[v].resolutions[0] ?? s.resolution, aspectRatio: MODEL_RULES[v].aspects.includes((s.aspectRatio as never) ?? '9:16') ? s.aspectRatio : MODEL_RULES[v].aspects[0] })} />
        {dr.kind === 'range' && <SliderRow bound label="Duration" value={Math.min(dr.max, Math.max(dr.min, num('duration', dr.min)))} min={dr.min} max={dr.max} readout={`${num('duration', dr.min)}s`} onChange={(v) => onChange({ duration: v })} />}
        {dr.kind === 'enum' && <SelectRow bound label="Duration" value={String(num('duration', dr.values[0]))} options={dr.values.map(String)} suffix="s" onChange={(v) => onChange({ duration: Number(v) })} />}
        <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={rule.aspects} onChange={(v) => onChange({ aspectRatio: v })} />
        {rule.resolutions.length > 0 && <SelectRow bound label="Resolution" value={rule.resolutions.includes(str('resolution', '720p') as never) ? str('resolution', '720p') : rule.resolutions[0]} options={rule.resolutions} onChange={(v) => onChange({ resolution: v })} />}
        {rule.audioToggle && <CheckRow bound label="Audio" on={s.audioEnabled !== false} onChange={(v) => onChange({ audioEnabled: v })} />}
        <CheckRow bound label="Enhance prompt" on={!!s.enhance} muted hint="+8 credits" onChange={(v) => onChange({ enhance: v })} />
        <SelectRow bound label="Bitrate" value={str('bitrateMode', 'standard')} options={['standard', 'high'] as const} onChange={(v) => onChange({ bitrateMode: v })} />
        <div className="hint">With a prompt input connected, that text is the prompt. Without one, the prompt composes from the console&apos;s look controls copied here.</div>
        <OBtn kind="pill" cls="ae-o-pill"  onClick={() => onChange({ ...consoleControls, model: vm })} disabled={readOnly}>Copy the console&apos;s controls into this node</OBtn>
      </>)}
      {n.type === 'image' && (<>
        <SelectRow bound label="Model" value={str('model', 'nano-banana-2')} options={IMAGE_MODELS} onChange={(v) => onChange({ model: v })} />
        <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={ASPECT6} onChange={(v) => onChange({ aspectRatio: v })} />
        {s.model === 'soul' && <SliderRow bound label="Generations" value={num('nbGenerations', 1)} min={1} max={4} readout={`×${num('nbGenerations', 1)}`} onChange={(v) => onChange({ nbGenerations: v })} />}
        <CheckRow bound label="Enhance prompt" on={!!s.enhance} muted hint="+8 credits" onChange={(v) => onChange({ enhance: v })} />
      </>)}
      {needsCatalog && (<>
        {n.type === 'talkingActor' && <SelectRow bound label="Model" value={str('model', 'arcads_1.0')} options={['arcads_1.0', 'audio_driven', 'omnihuman'] as const} onChange={(v) => onChange({ model: v })} />}
        <div className="hint">Scene (the actor and setting)</div>
        {!catalog ? <div className="hint">Loading the catalog</div> : situations.length === 0 ? <div className="hint">{catalog.detail}</div> : (
          <div className="tile">{situations.slice(0, 30).map((sit) => (<OBtn kind="row" key={sit.id} data-on={s.situationId === sit.id} onClick={() => onChange({ situationId: sit.id, voiceId: null })} title={`${sit.actor.name} · ${sit.tags.join(', ')}`}>{sit.imageUrl ? <img src={sit.imageUrl} alt="" /> : null}<span>{sit.actor.name}</span></OBtn>))}</div>
        )}
        <SelectRow bound label="Voice" value={str('voiceId', '')} options={['', ...(catalog?.voices ?? []).map((v) => v.id)]} labels={Object.fromEntries([['', 'match the actor'], ...(catalog?.voices ?? []).map((v) => [v.id, `${v.name} · ${[v.gender, v.age].filter(Boolean).join(' ')}`])])} onChange={(v) => onChange({ voiceId: v || null })} />
      </>)}
      {n.type === 'veo31' && (<>
        <SelectRow bound label="Resolution" value={str('resolution', '720p')} options={['360p', '480p', '720p', '1080p', '4K'] as const} onChange={(v) => onChange({ resolution: v })} />
        <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={['16:9', '9:16'] as const} onChange={(v) => onChange({ aspectRatio: v })} />
        <div className="hint">A start frame replaces reference images. An end frame needs a start frame.</div>
      </>)}
      {n.type === 'videoEdit' && (<>
        <SelectRow bound label="Aspect" value={str('aspectRatio', 'auto') || 'auto'} options={['auto', '16:9', '9:16'] as const} onChange={(v) => onChange({ aspectRatio: v === 'auto' ? null : v })} />
        <SliderRow bound label="Duration" value={num('duration', 0)} min={0} max={10} readout={num('duration', 0) ? `${num('duration', 0)}s` : 'auto'} onChange={(v) => onChange({ duration: v || null })} />
        <div className="hint">Connect the video to edit on videos. With no video, Omni Flash generates from the prompt.</div>
      </>)}
      {n.type === 'broll' && (<>
        <SelectRow bound label="Duration" value={String(num('duration', 5))} options={['5', '10'] as const} suffix="s" onChange={(v) => onChange({ duration: Number(v) })} />
        <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={ASPECT6} onChange={(v) => onChange({ aspectRatio: v })} />
      </>)}
      {n.type === 'scene' && (<>
        <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={ASPECT6} onChange={(v) => onChange({ aspectRatio: v })} />
        <TextAreaRow label="Context prompt" value={str('contextPrompt')} placeholder="The previous scene, for continuity" rows={3} onChange={(v) => onChange({ contextPrompt: v })} />
        <TextAreaRow label="Context script" value={str('contextScript')} placeholder="What was said before" rows={2} onChange={(v) => onChange({ contextScript: v })} />
      </>)}
      {n.type === 'music' && (<>
        <SelectRow bound label="Model" value={str('model', 'elevenlabs')} options={['elevenlabs', 'suno_v6'] as const} onChange={(v) => onChange({ model: v })} />
        <SliderRow bound label="Length" value={num('duration', 15)} min={3} max={120} readout={`${num('duration', 15)}s`} onChange={(v) => onChange({ duration: v })} />
        <CheckRow bound label="Instrumental" on={s.instrumentalOnly !== false} onChange={(v) => onChange({ instrumentalOnly: v })} />
        {s.model === 'suno_v6' && !s.instrumentalOnly && <TextAreaRow label="Lyrics" value={str('lyrics')} placeholder="[Verse] …" rows={3} onChange={(v) => onChange({ lyrics: v })} />}
      </>)}
      {n.type === 'preset' && (<>
        <SelectRow bound label="Preset" value={str('presetType', 'gestures')} options={['camera-movement', 'gestures', 'showyourapp', 'unboxing-pov', 'gameplay-ad'] as const} onChange={(v) => onChange({ presetType: v, situationId: null })} />
        {(s.presetType === 'camera-movement' || s.presetType === 'gestures') && <SelectRow bound label="Aspect" value={str('aspectRatio', '9:16')} options={ASPECT6} onChange={(v) => onChange({ aspectRatio: v })} />}
        {s.presetType === 'camera-movement' && <SliderRow bound label="Strength" value={Math.round(num('strength', 0.5) * 10)} min={0} max={10} readout={num('strength', 0.5).toFixed(1)} onChange={(v) => onChange({ strength: v / 10 })} />}
        <div className="hint">Template</div>
        <div className="tile">{templates.slice(0, 30).map((t) => (<OBtn kind="row" key={t.id} data-on={s.situationId === t.id} onClick={() => onChange({ situationId: t.id })} title={t.tags.join(', ')}>{t.imageUrl ? <img src={t.imageUrl} alt="" /> : null}<span>{t.tags[0] ?? t.id.slice(0, 8)}</span></OBtn>))}{templates.length === 0 && <div className="hint" style={{ gridColumn: '1 / -1' }}>{health.arcads.configured ? 'Loading templates' : 'Connect Arcads to list templates'}</div>}</div>
        <div className="hint">{s.presetType === 'gameplay-ad' ? 'Connect the gameplay video on videos.' : 'Connect the avatar, app screenshot or product image on images.'}</div>
      </>)}
      {n.type === 'deliver' && <div className="hint">The assets linked here are this workflow&apos;s final outputs. Each run records them, and they are tagged final in the campaign. Every paid node also files its own asset in the campaign as it delivers.</div>}

      {(run || asset || n.outputText) && (<div className="hint" style={{ marginTop: 6 }}>
        {run && <div>Run {run.status}{run.arcads?.lastStatus ? ` · Arcads says ${run.arcads.lastStatus}` : ''}{run.arcads?.creditsCharged != null ? ` · ${run.arcads.creditsCharged} credits` : ''}{run.error ? ` · ${run.error}` : ''}</div>}
        {asset?.path && <div className="out" style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', background: 'var(--o-stage)' }}>{asset.kind === 'video' ? (dry ? <div style={{ padding: 16, textAlign: 'center' }}>dry placeholder delivered</div> : <video src={asset.path} controls style={{ width: '100%' }} />) : <img src={asset.path} alt="" style={{ width: '100%' }} />}</div>}
        {n.outputText && n.type !== 'text' && <div style={{ marginTop: 6, color: 'var(--o-text)' }}>{n.outputText.slice(0, 400)}</div>}
      </div>)}

      </fieldset>
      <div className="mt-auto flex justify-between pt-2">
        {!readOnly ? <OBtn kind="pill" cls="ae-o-pill"  onClick={onRemove}><Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Remove</OBtn> : <span />}
        <span className="hint" style={{ alignSelf: 'center' }}>{n.type === 'missing' ? 'not runnable' : spec.local ? 'runs locally' : 'charged by Arcads on run'}</span>
      </div>
    </div>
  );
}
