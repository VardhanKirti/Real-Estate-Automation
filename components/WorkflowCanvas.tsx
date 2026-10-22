'use client';

/**
 * The workflows page: a node canvas over the real workflows table.
 *
 * Renders the static frame and hands it to the editor engine on mount
 * (components/workflow-canvas/engine.ts). All persistence goes through the
 * routes under /api/workflows and /api/brand-deals/rules, so a save here is
 * a save in the database with a version row, and an edit to a rule-bound
 * field is a write to the daemon's rules.json on the mini.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { WorkflowInput } from '@/app/api/workflows/shared';
import type { AgentRun, BrandDealRules, Workflow } from '@/lib/schemas';
import { mountWorkflowEditor, type EditorApi, type RulesState } from './workflow-canvas/engine';
import './workflow-canvas/canvas.css';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `${res.status} ${res.statusText}`);
  return body;
}

const api: EditorApi = {
  save: (id, input) => call(`/api/workflows/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  create: (input: WorkflowInput) => call('/api/workflows', { method: 'POST', body: JSON.stringify(input) }),
  remove: (id) => call(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined),
  listVersions: (id) => call<{ versions: never[] }>(`/api/workflows/${encodeURIComponent(id)}/versions`).then((r) => r.versions),
  restoreVersion: (id, versionId) => call(`/api/workflows/${encodeURIComponent(id)}/versions/restore`, { method: 'POST', body: JSON.stringify({ versionId }) }),
  saveRules: (patch: Partial<BrandDealRules>, note: string) => call('/api/brand-deals/rules', { method: 'PUT', body: JSON.stringify({ rules: patch, note }) }),
  listRuleVersions: () => call('/api/brand-deals/rules'),
  restoreRuleVersion: (versionId) => call('/api/brand-deals/rules/restore', { method: 'POST', body: JSON.stringify({ versionId }) }),
  runAgent: (agentId) => call<{ run: AgentRun }>(`/api/agents/${encodeURIComponent(agentId)}/run`, { method: 'POST' }).then((r) => r.run),
  draft: (prompt) => call('/api/workflows/draft', { method: 'POST', body: JSON.stringify({ prompt }) }),
};

export function WorkflowCanvas(props: {
  workflows: Workflow[];
  agents: { id: string; name: string; status: string }[];
  people: string[];
  runs: AgentRun[];
  rules: RulesState;
  setupHref: string;
  initialId: string | null;
  /** `g`: the GladOS skin (glados-ui SPEC S04 §4.4): kit control classes on the engine's DOM, tokens re-pointed in CSS. */
  skin?: 'g';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const editor = mountWorkflowEditor(ref.current, { ...props, api });
    return () => editor.destroy();
    // the page passes fresh props on every navigation; the engine owns state after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="wfc" ref={ref} data-skin={props.skin}>
      <header className="topbar">
        <div className="topbar-left">
          <button className="tb-btn tb-icon" id="btnNewWorkflow" title="New workflow" />
          <div className="title-block">
            <div className="title-row">
              <h1 className="wf-title" id="wfTitle" contentEditable suppressContentEditableWarning spellCheck={false} />
              <span className="wf-subtitle muted" id="wfSubtitle" />
            </div>
            <button className="crumb" id="wfCrumb" />
          </div>
          <nav className="tabs" id="tabs">
            <button className="tab is-active" data-tab="editor">Editor</button>
            <button className="tab" data-tab="executions">Executions</button>
            <button className="tab" data-tab="tests">Tests</button>
          </nav>
        </div>
        <div className="topbar-right">
          <button className="tb-btn tb-primary" id="btnSave">Saved</button>
          <button className="tb-btn tb-icon" id="btnHistory" title="Version history" />
          <button className="tb-btn tb-icon" id="btnMore" title="More" />
        </div>
      </header>

      <section className="view view-editor is-active" id="viewEditor">
        <div className="canvas" id="canvas" tabIndex={0}>
          <div className="world" id="world">
            <div className="grid" />
            <div className="grid grid-glow" id="gridGlow" />
            <div className="grid-ambient" id="gridAmbient" />
            <svg className="edges" id="edges" />
            <div className="edge-labels" id="edgeLabels" />
            <div className="nodes" id="nodes" />
            <svg className="edges edges-temp" id="edgesTemp" />
          </div>
          <div className="drop-hint" id="dropHint">Drop to add</div>
        </div>

        <div className="hud hud-tl">
          <div className="minimap" id="minimap">
            <canvas id="minimapCanvas" width={180} height={104} />
            <div className="minimap-view" id="minimapView" />
          </div>
          <div className="hud-row">
            <button className="hud-btn" data-action="fit" title="Fit view (F)" />
            <button className="hud-btn" data-action="zoom-in" title="Zoom in (+)" />
            <button className="hud-btn" data-action="zoom-out" title="Zoom out (−)" />
            <button className="hud-btn" data-action="undo" title="Undo (⌘Z)" />
          </div>
        </div>

        <div className="dock dock-chat is-hidden" id="dockChat">
          <div className="chat-head">
            <span className="chat-title">Draft with Claude</span>
            <span className="chat-id mono" id="chatId" />
          </div>
          <div className="chat-log" id="chatLog" />
          <form className="chat-form" id="chatForm">
            <input className="chat-input" id="chatInput" placeholder="Describe the workflow you want…" autoComplete="off" />
            <button className="chat-send" type="submit" title="Send" />
          </form>
        </div>

        <div className="dock dock-bar" id="dockBar">
          <button className="bar-btn bar-run" id="btnTest">Test workflow</button>
          <button className="bar-btn" id="btnChat">Show chat</button>
          <span className="bar-sep" />
          <div className="bar-timer" id="barTimer">
            <span className="mono" id="timerText">00:00</span>
            <button className="timer-btn" id="btnPause" title="Pause" />
          </div>
        </div>

        <div className="dock dock-logs is-hidden" id="dockLogs">
          <div className="logs-head">
            <span id="logsTitle">Run log</span>
            <div className="lh">
              <button className="logs-toggle" id="btnLogs" title="Expand" />
              <button className="logs-toggle" id="btnLogsClose" title="Close" />
            </div>
          </div>
          <div className="logs-body" id="logsBody" />
        </div>

        <div className="dock dock-ratio is-collapsed" id="dockRatio">
          <button className="ratio-mini" id="ratioMini" title="Human to agent ratio · click to pin open">
            Human <span className="ratio-arrow" id="ratioArrowMini" /> Agent <span className="mono" id="ratioMiniPct">0%</span>
          </button>
          <button className="ratio-collapse" id="btnRatioCollapse" title="Collapse" />
          <div className="ratio-head">
            <div className="ratio-title">
              Human <span className="ratio-arrow" id="ratioArrow" /> Agent ratio
            </div>
            <div className="ratio-stat">
              <span className="ratio-bars"><i /><i /><i /></span>
              <span id="ratioStat">Human hours: 0h/wk</span>
            </div>
          </div>
          <div className="ratio-track" id="ratioTrack">
            <canvas className="ratio-grid" id="ratioGrid" />
            <div className="ratio-line" id="ratioLine" />
            <div className="ratio-marker" id="ratioMarker" title="Drag to set a target ratio · double-click to reset" />
          </div>
          <div className="ratio-ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
        </div>

        <button className="pill-set" id="btnSettings" title="Settings for the selection" />
        <button className="pill-add" id="btnPanelToggle" title="What happens next? (⌘K)" />
        <aside className="panel" id="panel" />
      </section>

      <section className="view view-library" id="viewLibrary">
        <div className="lib-wrap">
          <div className="lib-grid" id="libGrid" />
        </div>
      </section>

      <section className="view view-list" id="viewExecutions">
        <div className="list-wrap">
          <div className="list-head">
            <div>
              <h2>Executions</h2>
              <p className="muted" id="execSummary" />
            </div>
            <div className="list-actions">
              <button className="tb-btn" data-exec-filter="all">All</button>
              <button className="tb-btn" data-exec-filter="success">Ok</button>
              <button className="tb-btn" data-exec-filter="failed">Failed</button>
            </div>
          </div>
          <div className="table" id="execTable" />
        </div>
      </section>

      <section className="view view-list" id="viewTests">
        <div className="list-wrap">
          <div className="list-head">
            <div>
              <h2>Tests</h2>
              <p className="muted" id="testSummary" />
            </div>
          </div>
          <div className="table" id="testTable" />
        </div>
      </section>

      {props.skin === 'g' && (
        <p className="wfc-g-narrow" role="note">
          Edit workflows on a larger screen. Pan and zoom work here.
        </p>
      )}
      <div className="modal-root" id="modalRoot" />
      <div className="menu-root" id="menuRoot" />
      <div className="toasts" id="toasts" />
      <div className="drag-ghost" id="dragGhost" />
    </div>
  );
}
