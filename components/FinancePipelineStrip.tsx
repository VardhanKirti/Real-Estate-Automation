'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHead } from '@/components/terminal';
import { PipelineChart, type PipelineStage } from '@/components/PipelineChart';
import { formatCompact, formatFull, formatUsdCompact } from '@/lib/format-number';
import type { IncomeCategory } from '@/lib/finances';

/**
 * Homepage finance widget — the same Pipeline design as /brand-deals' hero
 * and /finances' own hero (components/PipelineChart.tsx), compact, with real
 * income-by-processor categories standing in for deal stages. Static by
 * design — a snapshot, not a live ticker.
 *
 * Hovering or focusing a column lights it; clicking opens
 * /finances?category=<key> with the same column lit there (S10 FR-12). The
 * period label comes from the caller: YTD for the demo books in Filming
 * mode, MTD for the live processor pulls, the same rule /finances uses.
 *
 * The caller (Home6Console) computes `categories` server-side from the same
 * real processor accounts /finances reads and passes null when nothing is
 * configured — this component never fabricates a chart, it only renders
 * one it was actually handed.
 */

const usd = (n: number) => `$${formatFull(Math.round(n))}`;

export function FinancePipelineStrip({ categories, period }: { categories: IncomeCategory[]; period: 'MTD' | 'YTD' }) {
  const router = useRouter();
  const total = categories.reduce((sum, c) => sum + c.usd, 0);
  const stages: PipelineStage[] = categories.map((c) => ({
    key: c.key,
    label: c.label,
    value: c.usd,
    usd: c.usd,
    note: `${total > 0 ? Math.round((c.usd / total) * 100) : 0}% of ${period} revenue`,
  }));
  const [active, setActive] = useState(() => stages.reduce((bestIdx, s, i) => (s.value > stages[bestIdx].value ? i : bestIdx), 0));

  return (
    <div className="glass-panel h6-strip min-w-0 p-4">
      <SectionHead label="Finances" count={`${usd(total)} ${period}`} link="Open" href="/finances" />
      <PipelineChart
        stages={stages}
        active={active}
        responsive
        onHover={(_, i) => setActive(i)}
        onSelect={(s) => router.push(s.key ? `/finances?category=${encodeURIComponent(s.key)}` : '/finances')}
        formatValue={(v) => formatFull(v)}
        compactValue={formatCompact}
        compactUsd={formatUsdCompact}
        numeralSize={22}
        svgHeight={100}
        showAxis={false}
        contentClassName="pt-1"
      />
    </div>
  );
}
