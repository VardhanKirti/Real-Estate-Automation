import { layoutBrainNodes, polar, type BrainCluster } from '@/lib/brain-viz';

/**
 * The Optimal Engine knowledge core — three data rings around a health gauge.
 * Pure SVG (animations are CSS in globals.css), so it renders on the server.
 * `compact` hides cluster labels + ring callouts for the Home mini card.
 *
 * Version, Supabase page count and Supabase state come from the provider or
 * are omitted (GladOS UI H33): no remembered numbers.
 */
export function BrainViz({
  clusters,
  health,
  supabasePages = null,
  supabaseState = null,
  version = null,
  compact = false,
}: {
  clusters: BrainCluster[];
  health: number | null;
  /** from `gbrain stats`; null when it did not answer */
  supabasePages?: number | null;
  /** 'Live' | 'Paused' | 'Unknown', from lib/brain-layers.ts supabaseState */
  supabaseState?: string | null;
  /** from `engine doctor`; null when it reports none */
  version?: string | null;
  compact?: boolean;
}) {
  const { nodes, labels } = layoutBrainNodes(clusters);
  const totalPages = clusters.reduce((sum, c) => sum + c.pages, 0);
  const arcR = 76;
  const C = 2 * Math.PI * arcR;
  const healthArc = ((health ?? 0) / 100) * C;

  // Supabase outer dots — a sampled view of the remote page count
  const outer: { x: number; y: number }[] = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * 360 + (i % 5) * 1.7;
    const r = 206 + ((i * 11) % 9) - 4;
    const [x, y] = polar(260, 260, r, a);
    outer.push({ x, y });
  }

  return (
    <svg viewBox="0 0 520 520" role="img" aria-label="Optimal Engine knowledge core">
      <defs>
        <radialGradient id="coreGrad">
          <stop offset="0%" stopColor="var(--brain-1)" stopOpacity="0.22" />
          <stop offset="70%" stopColor="var(--brain-1)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--brain-1)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brain-2)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--brain-2)" stopOpacity="0.13" />
        </linearGradient>
        <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brain-1)" />
          <stop offset="55%" stopColor="var(--brain-2)" />
          <stop offset="100%" stopColor="var(--brain-3)" />
        </linearGradient>
      </defs>

      {/* radar sweep */}
      <g className="brain-sweep">
        <path d="M260 260 L260 40 A220 220 0 0 1 369 69 Z" fill="url(#sweepGrad)" />
      </g>

      {/* outer ring — supabase (paused) */}
      <g className="brain-ring r3">
        <circle cx="260" cy="260" r="210" fill="none" stroke="var(--border-strong)" strokeDasharray="2 7" strokeWidth="1" />
        {outer.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.6" fill="var(--text-3)" opacity="0.55" />
        ))}
      </g>

      {/* middle ring — zeroentropy embeddings */}
      <g className="brain-ring r2">
        <circle cx="260" cy="260" r="158" fill="none" stroke="var(--border-strong)" strokeWidth="1" opacity="0.8" />
        {Array.from({ length: 8 }, (_, i) => {
          const [x, y] = polar(260, 260, 158, i * 45);
          return (
            <rect
              key={i}
              x={x - 2.6}
              y={y - 2.6}
              width="5.2"
              height="5.2"
              transform={`rotate(45 ${x} ${y})`}
              fill="var(--brain-2)"
              opacity="0.85"
            />
          );
        })}
      </g>

      {/* inner ring — brain-store pages */}
      <g className="brain-ring r1">
        <circle cx="260" cy="260" r="108" fill="none" stroke="var(--brain-1)" strokeOpacity="0.3" strokeWidth="1" />
        {nodes.map((n, i) => (
          <g key={i}>
            <line x1="260" y1="260" x2={n.x} y2={n.y} stroke="var(--brain-1)" strokeWidth="0.5" opacity="0.18" />
            <circle cx={n.x} cy={n.y} r="3.4" fill="var(--brain-1)" />
            <circle cx={n.x} cy={n.y} r="6.5" fill="none" stroke="var(--brain-1)" strokeWidth="0.6" opacity="0.3" />
          </g>
        ))}
      </g>

      {/* static cluster labels */}
      {!compact &&
        labels.map((l, i) => {
          const [x, y] = polar(260, 260, 134, l.angle);
          const norm = ((l.angle % 360) + 360) % 360;
          const anchor = norm < 88 || norm > 272 ? 'start' : Math.abs(norm - 180) < 88 ? 'end' : 'middle';
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontFamily="var(--font-sans)"
              fontSize="9.5"
              fill="var(--text-3)"
            >
              {l.label} · {l.pages}
            </text>
          );
        })}

      {/* core glow + health gauge */}
      <circle cx="260" cy="260" r="120" fill="url(#coreGrad)" />
      <g className="brain-core-pulse">
        <circle cx="260" cy="260" r={arcR} fill="none" stroke="var(--border)" strokeWidth="5" />
        {health != null && (
          <circle
            cx="260"
            cy="260"
            r={arcR}
            fill="none"
            stroke="url(#arcGrad)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${healthArc} ${C}`}
            transform="rotate(-90 260 260)"
          />
        )}
        <circle cx="260" cy="260" r="58" fill="var(--surface)" stroke="var(--brain-1)" strokeOpacity="0.35" strokeWidth="1" />
        <text x="260" y="252" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="30" fontWeight="400" fill="var(--text)">
          {health ?? '—'}
        </text>
        <text x="260" y="272" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="9" fill="var(--text-3)">
          Health / 100
        </text>
        {version && (
          <text x="260" y="288" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.5" fill="var(--brain-2)">
            engine {/^v/i.test(version) ? version : `v${version}`}
          </text>
        )}
      </g>

      {/* ring callouts */}
      {!compact && (
        <g fontFamily="var(--font-sans)" fontSize="9.5">
          <text x="260" y="146" textAnchor="middle" fill="var(--brain-1)">
            Brain-store · {totalPages} pages
          </text>
          <text x="260" y="96" textAnchor="middle" fill="var(--brain-2)">
            ZeroEntropy · embeddings
          </text>
          <text x="260" y="44" textAnchor="middle" fill="var(--text-3)">
            Supabase · {supabasePages != null ? `${supabasePages} pages` : 'counts unavailable'}
            {supabaseState ? ` · ${supabaseState.toLowerCase()}` : ''}
          </text>
        </g>
      )}
    </svg>
  );
}
