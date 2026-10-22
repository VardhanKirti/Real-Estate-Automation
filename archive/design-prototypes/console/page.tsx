import localFont from 'next/font/local';
import {
  Activity,
  Check,
  ChevronsUpDown,
  CircleDollarSign,
  ClipboardList,
  FlaskConical,
  Gauge,
  GitBranch,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { OPERATOR_NAME } from '@/lib/operator';

// Style demo for docs/DESIGN-CONSOLE.md (UI Example 5). Everything here is
// scoped: Geist loads only on this route and the c5-* CSS never leaks into
// the app themes. Approve/skip/run numbers are layout sample data.
const geist = localFont({
  src: '../../fonts/Geist[wght].ttf',
  weight: '100 900',
  variable: '--font-c5',
});

// Deterministic stacked-bar series — three traffic humps like a real day of
// agent runs. Seeded so server and client always agree.
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(47);
const BARS = Array.from({ length: 56 }, (_, i) => {
  const hump = Math.max(
    Math.exp(-((i - 7) ** 2) / 26),
    Math.exp(-((i - 19) ** 2) / 20) * 1.05,
    Math.exp(-((i - 33) ** 2) / 30) * 0.92,
    Math.exp(-((i - 47) ** 2) / 12) * 0.98,
  );
  const total = 14 + 172 * hump * (0.72 + rnd() * 0.5);
  const a = total * (0.3 + rnd() * 0.08); // blue — completion
  const b = total * (0.28 + rnd() * 0.1); // ice — cache write, widest band on tall bars
  const c = total * (0.19 + rnd() * 0.06); // violet — prompt
  const d = Math.max(2.5, total - a - b - c); // orchid — tool tokens
  return [a, b, c, d].map((v) => Math.max(2, Math.round(v)));
});

const RAMP = ['#6E96F2', '#D9E4FB', '#6656E3', '#BD5FE8'];

const NAV = [
  { icon: Activity, label: 'Agent Runs', active: true },
  { icon: GitBranch, label: 'Live Traces' },
  { icon: ClipboardList, label: 'Approvals' },
  { icon: TriangleAlert, label: 'Errors' },
  { icon: Gauge, label: 'Dashboards' },
  { icon: FlaskConical, label: 'Evaluations' },
  { icon: CircleDollarSign, label: 'Cost & Usage' },
];

const KPIS = [
  { dot: '#6E96F2', label: 'Total runs', value: '12,847', suffix: '', delta: '+ 8.2% vs prev 24h' },
  { dot: 'var(--ok)', label: 'Success rate', value: '94.3', suffix: '%', delta: '+ 1.4 pts' },
  { dot: '#6656E3', label: 'P95 latency', value: '3.9', suffix: 's', delta: '+ 0.6s slower' },
  { dot: '#F04E52', label: 'Error rate', value: '731', suffix: '', delta: '+ 12% vs prev 24h' },
];

type Row = {
  id: string;
  agent: string;
  status: 'Awaiting' | 'Succeeded' | 'Failed';
  tools: number;
  latency: number;
  tokens: string;
  cost: string;
  started: string;
  approval: 'manual' | 'auto' | 'approved';
};
const ROWS: Row[] = [
  { id: 'run_8f3a1c', agent: 'Approval Bot', status: 'Awaiting', tools: 7, latency: 70, tokens: '18.4k', cost: '$0.041', started: '2m ago', approval: 'manual' },
  { id: 'run_2b91e7', agent: 'Deal Scanner', status: 'Awaiting', tools: 12, latency: 70, tokens: '18.4k', cost: '$0.041', started: '2m ago', approval: 'approved' },
  { id: 'run_5c2e9d', agent: 'Inbound Watcher', status: 'Awaiting', tools: 3, latency: 60, tokens: '10.2k', cost: '$0.035', started: '1h ago', approval: 'manual' },
  { id: 'run_9d41b0', agent: 'gsend Sender', status: 'Succeeded', tools: 4, latency: 45, tokens: '6.8k', cost: '$0.019', started: '2h ago', approval: 'auto' },
  { id: 'run_3d5f8e', agent: 'Daily Briefing', status: 'Succeeded', tools: 10, latency: 90, tokens: '25.1k', cost: '$0.050', started: '3d ago', approval: 'auto' },
  { id: 'run_3c92f8', agent: 'Deal Alerts', status: 'Awaiting', tools: 8, latency: 50, tokens: '10.1k', cost: '$0.052', started: '1m ago', approval: 'manual' },
  { id: 'run_4d93g9', agent: 'the media lead Briefing', status: 'Failed', tools: 15, latency: 85, tokens: '20.0k', cost: '$0.038', started: '30s ago', approval: 'auto' },
  { id: 'run_7a20c4', agent: 'Attio CRM Pulse', status: 'Succeeded', tools: 5, latency: 40, tokens: '4.2k', cost: '$0.012', started: '4h ago', approval: 'auto' },
];

const STATUS_DOT: Record<Row['status'], string> = {
  Awaiting: '#F2B33D',
  Succeeded: 'var(--ok)',
  Failed: '#F04E52',
};

function ToolBars({ n }: { n: number }) {
  const hs = [7, 11, 9, 13, 10];
  return (
    <span className="c5-toolbars">
      {hs.map((h, i) => (
        <span key={i} style={{ height: h, background: i % 2 ? '#6656E3' : '#6E96F2' }} />
      ))}
      <span className="c5-toolcount">{n}</span>
    </span>
  );
}

export default function ConsoleDemoPage() {
  return (
    <div className={`${geist.variable} c5-root`}>
      <div className="c5-note">
        Design style 5 · &ldquo;Console&rdquo; · Geist · rules in docs/DESIGN-CONSOLE.md — layout demo with sample run metrics
      </div>

      <div className="c5-frame">
        {/* ——— sidebar ——— */}
        <aside className="c5-side">
          <div className="c5-profile">
            <span className="c5-avatar">BG</span>
            <span className="c5-profile-text">
              <span className="c5-profile-name">{OPERATOR_NAME}</span>
              <span className="c5-profile-sub">Pro+</span>
            </span>
            <MoreHorizontal size={16} strokeWidth={1.5} className="c5-dim" />
          </div>
          <nav className="c5-nav">
            {NAV.map(({ icon: Icon, label, active }) => (
              <span key={label} className={active ? 'c5-nav-item c5-nav-active' : 'c5-nav-item'}>
                <Icon size={16} strokeWidth={1.5} />
                {label}
              </span>
            ))}
          </nav>
        </aside>

        {/* ——— main ——— */}
        <div className="c5-main">
          <header className="c5-head">
            <div>
              <h1 className="c5-title">Agent Runs</h1>
              <p className="c5-sub">Real-time monitoring across all agents · glados</p>
            </div>
            <div className="c5-head-actions">
              <span className="c5-seg">
                <button className="c5-btn c5-seg-l" type="button">
                  <span className="c5-dot" style={{ background: 'var(--ok)' }} />
                  Active
                </button>
                <button className="c5-btn c5-seg-r" type="button">Disconnect</button>
              </span>
              <button className="c5-btn" type="button">
                <Plus size={15} strokeWidth={1.7} />
                New alert
              </button>
            </div>
          </header>

          <div className="c5-grid">
            {KPIS.map((k) => (
              <div key={k.label} className="c5-card c5-kpi">
                <div className="c5-card-top">
                  <span className="c5-dot" style={{ background: k.dot }} />
                  <span className="c5-label">{k.label}</span>
                  <MoreHorizontal size={16} strokeWidth={1.5} className="c5-dim c5-push" />
                </div>
                <div className="c5-num">
                  {k.value}
                  {k.suffix && <span className="c5-num-suffix">{k.suffix}</span>}
                </div>
                <div className="c5-delta">{k.delta}</div>
              </div>
            ))}

            {/* chart card */}
            <div className="c5-card c5-chart-card">
              <div className="c5-card-top">
                <span className="c5-chart-title">Total LLMs Cost</span>
                <MoreHorizontal size={16} strokeWidth={1.5} className="c5-dim c5-push" />
              </div>
              <div className="c5-chart">
                <div className="c5-yaxis">
                  {['$60', '$45', '$30', '$15', '$0'].map((y) => (
                    <span key={y}>{y}</span>
                  ))}
                </div>
                <div className="c5-bars">
                  {BARS.map((segs, i) => (
                    <div key={i} className="c5-bar">
                      {segs.map((h, j) => (
                        <span key={j} style={{ height: h, background: RAMP[j] }} />
                      ))}
                    </div>
                  ))}
                  {/* static tooltip — part of the style spec */}
                  <div className="c5-tooltip">
                    <div className="c5-tooltip-title">18.00</div>
                    {[
                      ['Completion', '$280', RAMP[0]],
                      ['Prompt (cache write)', '$170', RAMP[1]],
                      ['Prompt', '$170', RAMP[2]],
                      ['Tool tokens', '$3.11', RAMP[3]],
                    ].map(([label, value, color]) => (
                      <div key={label} className="c5-tooltip-row">
                        <span className="c5-swatch" style={{ background: color }} />
                        <span className="c5-label">{label}</span>
                        <span className="c5-tooltip-val">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="c5-xaxis">
                {['09.00', '12.00', '15.00', '18.00', '20.00', '21.00'].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <div className="c5-legend">
                <span className="c5-label">Total</span>
                <span className="c5-legend-total">$12,900</span>
                <span className="c5-swatch" style={{ background: RAMP[0] }} />
                <span className="c5-label">Completion</span>
                <span className="c5-legend-val">$280</span>
                <span className="c5-swatch" style={{ background: RAMP[1] }} />
                <span className="c5-label">Prompt (cache write)</span>
                <span className="c5-legend-val">$170</span>
                <MoreHorizontal size={16} strokeWidth={1.5} className="c5-dim c5-push" />
              </div>
            </div>
          </div>

          {/* ——— run feed ——— */}
          <div className="c5-feedhead">
            <span className="c5-feedtitle">Run feed</span>
            <span className="c5-count">12,847 runs</span>
            <span className="c5-push c5-feed-actions">
              <span className="c5-input">
                <Search size={15} strokeWidth={1.7} />
                <span className="c5-placeholder">Search</span>
              </span>
              <button className="c5-btn c5-iconbtn" type="button" aria-label="Filters">
                <SlidersHorizontal size={15} strokeWidth={1.7} />
              </button>
              <button className="c5-btn" type="button">
                <Upload size={15} strokeWidth={1.7} />
                Export Data
              </button>
            </span>
          </div>

          <table className="c5-table">
            <thead>
              <tr>
                <th className="c5-th-check"><span className="c5-check" /></th>
                <th>Run ID</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Tools</th>
                <th>Latency</th>
                <th>
                  <span className="c5-th-sort">Tokens <ChevronsUpDown size={12} strokeWidth={1.6} /></span>
                </th>
                <th className="c5-th-num">Cost</th>
                <th>Started</th>
                <th>
                  <span className="c5-th-sort">Approval <ChevronsUpDown size={12} strokeWidth={1.6} /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.id}>
                  <td className="c5-th-check"><span className="c5-check" /></td>
                  <td className="c5-cell-id">{r.id}</td>
                  <td className="c5-cell-agent">{r.agent}</td>
                  <td>
                    <span className="c5-status">
                      <span className="c5-dot" style={{ background: STATUS_DOT[r.status] }} />
                      {r.status}
                    </span>
                  </td>
                  <td><ToolBars n={r.tools} /></td>
                  <td>
                    <span className="c5-latency">
                      <span className="c5-track"><span style={{ width: `${r.latency}%` }} /></span>
                      {r.latency}%
                    </span>
                  </td>
                  <td className="c5-cell-num">{r.tokens}</td>
                  <td className="c5-cell-num c5-th-num">{r.cost}</td>
                  <td className="c5-cell-dim">{r.started}</td>
                  <td>
                    {r.approval === 'auto' ? (
                      <span className="c5-cell-dim">Auto</span>
                    ) : (
                      <span className="c5-approval">
                        <button className="c5-sq" type="button" aria-label="Reject">
                          <X size={14} strokeWidth={1.8} />
                        </button>
                        <button
                          className={r.approval === 'approved' ? 'c5-sq c5-sq-ok' : 'c5-sq c5-sq-approve'}
                          type="button"
                          aria-label="Approve"
                        >
                          <Check size={14} strokeWidth={1.8} />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .c5-root { font-family: var(--font-c5), -apple-system, sans-serif; margin: -28px -32px -64px; padding: 24px 28px 48px; background: #0B0B0C; min-height: 100vh; color: #F4F4F5; font-variant-numeric: tabular-nums; }
        .c5-root * { box-sizing: border-box; }
        .c5-note { font-size: 12px; color: #66666E; margin-bottom: 16px; }
        .c5-frame { display: flex; border: 1px solid #1E1E21; border-radius: 14px; overflow: hidden; background: #0B0B0C; }
        .c5-dim { color: #66666E; }
        .c5-push { margin-left: auto; }
        .c5-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
        .c5-label { font-size: 13px; color: #9A9AA3; }
        .c5-swatch { width: 13px; height: 13px; border-radius: 4px; display: inline-block; flex: none; }

        /* sidebar */
        .c5-side { width: 236px; flex: none; border-right: 1px solid #1E1E21; padding: 18px 12px; }
        .c5-profile { display: flex; align-items: center; gap: 10px; padding: 0 8px 18px; }
        .c5-avatar { width: 34px; height: 34px; border-radius: 50%; background: #2A2A30; color: #C9C9CF; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 500; flex: none; }
        .c5-profile-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .c5-profile-name { font-size: 13.5px; font-weight: 500; }
        .c5-profile-sub { font-size: 11.5px; color: #66666E; }
        .c5-nav { display: flex; flex-direction: column; gap: 2px; }
        .c5-nav-item { display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 8px; font-size: 13.5px; color: #9A9AA3; cursor: default; transition: background 120ms ease, color 120ms ease; }
        .c5-nav-item svg { color: #66666E; transition: color 120ms ease; }
        .c5-nav-item:hover { background: #151517; color: #F4F4F5; }
        .c5-nav-item:hover svg { color: #9A9AA3; }
        .c5-nav-active, .c5-nav-active:hover { background: color-mix(in oklab, #6656E3 16%, transparent); color: #F4F4F5; }
        .c5-nav-active svg, .c5-nav-active:hover svg { color: #A99EF2; }

        /* main */
        .c5-main { flex: 1; min-width: 0; padding: 22px 24px 28px; }
        .c5-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
        .c5-title { font-size: 20px; font-weight: 500; margin: 0; }
        .c5-sub { font-size: 13px; color: #9A9AA3; margin: 3px 0 0; }
        .c5-head-actions { margin-left: auto; display: flex; gap: 10px; }
        .c5-btn { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; background: #1C1C1F; border: 1px solid #2A2A2E; border-radius: 9px; color: #F4F4F5; font-size: 13px; font-weight: 450; font-family: inherit; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
        .c5-btn:hover { background: #232327; border-color: #38383E; }
        .c5-btn svg { color: #9A9AA3; }
        .c5-iconbtn { padding: 0 10px; }
        .c5-seg { display: inline-flex; }
        .c5-seg-l { border-radius: 9px 0 0 9px; }
        .c5-seg-r { border-radius: 0 9px 9px 0; border-left: none; }

        /* cards */
        .c5-grid { display: grid; grid-template-columns: minmax(220px, 3fr) minmax(220px, 3fr) 7fr; grid-auto-rows: auto; gap: 14px; margin-bottom: 26px; }
        .c5-card { background: #151517; border: 1px solid #242428; border-radius: 12px; padding: 18px 20px; transition: transform 150ms ease, border-color 150ms ease; }
        .c5-card:hover { transform: translateY(-1px); border-color: #333338; }
        .c5-card-top { display: flex; align-items: center; gap: 9px; }
        .c5-kpi { min-height: 150px; display: flex; flex-direction: column; }
        .c5-num { font-size: 34px; font-weight: 400; letter-spacing: -0.01em; margin-top: 14px; }
        .c5-num-suffix { font-size: 19px; color: #9A9AA3; margin-left: 2px; }
        .c5-delta { font-size: 12.5px; color: #9A9AA3; margin-top: auto; padding-top: 14px; }
        .c5-chart-card { grid-column: 3; grid-row: 1 / span 2; display: flex; flex-direction: column; }
        .c5-chart-title { font-size: 14.5px; font-weight: 500; }
        .c5-chart { display: flex; gap: 12px; flex: 1; margin-top: 16px; min-height: 210px; }
        .c5-yaxis { display: flex; flex-direction: column; justify-content: space-between; font-size: 12px; color: #66666E; padding-bottom: 2px; }
        .c5-bars { position: relative; flex: 1; display: flex; align-items: flex-end; gap: 4px; }
        .c5-bar { flex: 1; display: flex; flex-direction: column-reverse; gap: 2px; }
        .c5-bar span { display: block; border-radius: 1.5px; }
        .c5-tooltip { position: absolute; left: 42%; top: -6px; background: #1F1F23; border: 1px solid #2E2E33; border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.55); min-width: 240px; z-index: 2; }
        .c5-tooltip-title { font-size: 14px; margin-bottom: 9px; }
        .c5-tooltip-row { display: flex; align-items: center; gap: 9px; padding: 3px 0; }
        .c5-tooltip-val { margin-left: auto; font-size: 13px; }
        .c5-xaxis { display: flex; justify-content: space-between; font-size: 12px; color: #66666E; margin: 10px 0 0 34px; }
        .c5-legend { display: flex; align-items: center; gap: 9px; margin-top: 16px; padding-top: 14px; border-top: 1px solid #1E1E21; }
        .c5-legend .c5-swatch { margin-left: 14px; }
        .c5-legend-total, .c5-legend-val { font-size: 13px; }

        /* run feed */
        .c5-feedhead { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .c5-feedtitle { font-size: 16px; font-weight: 500; }
        .c5-count { font-size: 11.5px; color: #9A9AA3; background: #1C1C1F; border: 1px solid #2A2A2E; border-radius: 6px; padding: 3px 8px; }
        .c5-feed-actions { display: flex; gap: 10px; align-items: center; }
        .c5-input { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; min-width: 190px; background: #1C1C1F; border: 1px solid #2A2A2E; border-radius: 9px; }
        .c5-input svg { color: #66666E; }
        .c5-placeholder { font-size: 13px; color: #66666E; }

        .c5-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .c5-table th { text-align: left; font-weight: 400; font-size: 12.5px; color: #9A9AA3; padding: 10px 12px; border-bottom: 1px solid #1E1E21; white-space: nowrap; }
        .c5-th-sort { display: inline-flex; align-items: center; gap: 4px; }
        .c5-th-num { text-align: right; }
        .c5-table td { padding: 0 12px; height: 46px; border-bottom: 1px solid #1E1E21; white-space: nowrap; }
        .c5-table tbody tr { transition: background 120ms ease; }
        .c5-table tbody tr:hover { background: #17171A; }
        .c5-th-check { width: 36px; }
        .c5-check { width: 16px; height: 16px; border: 1px solid #38383E; border-radius: 5px; display: inline-block; }
        .c5-cell-id { color: #9A9AA3; }
        .c5-cell-agent { font-weight: 450; }
        .c5-cell-num { font-variant-numeric: tabular-nums; }
        .c5-cell-dim { color: #9A9AA3; }
        .c5-status { display: inline-flex; align-items: center; gap: 8px; }
        .c5-toolbars { display: inline-flex; align-items: flex-end; gap: 2px; }
        .c5-toolbars > span:not(.c5-toolcount) { width: 3px; border-radius: 1px; }
        .c5-toolcount { font-size: 13px; margin-left: 7px; align-self: center; }
        .c5-latency { display: inline-flex; align-items: center; gap: 9px; color: #F4F4F5; }
        .c5-track { width: 64px; height: 4px; border-radius: 2px; background: #2A2A2E; overflow: hidden; display: inline-block; }
        .c5-track span { display: block; height: 100%; border-radius: 2px; background: #6E96F2; }
        .c5-approval { display: inline-flex; gap: 7px; }
        .c5-sq { width: 30px; height: 30px; border-radius: 7px; background: #1C1C1F; border: 1px solid #2A2A2E; color: #C9C9CF; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 120ms ease, border-color 120ms ease, color 120ms ease; }
        .c5-sq:hover { background: #232327; border-color: #38383E; }
        .c5-sq-approve:hover { background: var(--agent-badge); border-color: var(--agent-badge); color: #fff; }
        .c5-sq-ok, .c5-sq-ok:hover { background: var(--agent-badge); border-color: var(--agent-badge); color: #fff; }

        @media (max-width: 1100px) {
          .c5-grid { grid-template-columns: 1fr 1fr; }
          .c5-chart-card { grid-column: 1 / -1; grid-row: auto; }
          .c5-side { display: none; }
        }
      `}</style>
    </div>
  );
}
