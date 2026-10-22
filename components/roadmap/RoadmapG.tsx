'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { GBar, GButton, GCard, GEmpty, GHeroCard, GPage, GSectionHeader, GSegmented, GTag } from '@/components/g';
import { openWizard } from '@/lib/wizard-dock';
import type { Phase, RoadmapItem, RoadmapStatus } from '@/lib/schemas';

/**
 * /roadmap under the GladOS style (glados-ui SPEC S04 §4.8, X5). Same tables;
 * kit presentation: the current phase is the one hero (F-R2, Q-WRK-4 default:
 * the phase whose ordinal matches the first quarter that still has open
 * work), quarter headers carry a progress bar (F-R3), items say Done once
 * (pill and muted title, no strike or fade) and do not lift because they do
 * not open anything (F-R4, AC04.31), an empty install says so with an Ask
 * the Wizard action (F-R5, AC04.32), and All / Open persists as `?show=open`
 * (F-R6, AC04.33).
 */
const STATUS: Record<RoadmapStatus, { label: string; tone: 'accent' | 'warn' | 'outline' | 'ok' }> = {
  now: { label: 'Now', tone: 'accent' },
  next: { label: 'Next', tone: 'warn' },
  later: { label: 'Later', tone: 'outline' },
  done: { label: 'Done', tone: 'ok' },
};

export type RoadmapQuarter = { quarter: string; items: RoadmapItem[] };

function Item({ item, department }: { item: RoadmapItem; department: string | null }) {
  const [more, setMore] = useState(false);
  const long = item.description.length > 160;
  const s = STATUS[item.status];
  return (
    <GCard p={16} as="article" className="wg-rm-item" aria-label={item.title}>
      <div className="wg-rm-item-head">
        <span className="wg-rm-title" data-done={item.status === 'done' || undefined}>
          {item.title}
        </span>
        <GTag tone={s.tone}>{s.label}</GTag>
      </div>
      {item.description && (
        <p className="wg-rm-desc" data-clamp={long && !more ? '' : undefined}>
          {item.description}
        </p>
      )}
      {(long || department) && (
        <div className="wg-rm-foot">
          {department && <span className="wg-cap">{department}</span>}
          {long && (
            <GButton size="compact" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? 'Less' : 'More'}
            </GButton>
          )}
        </div>
      )}
    </GCard>
  );
}

export function RoadmapG({ phases, quarters, departments, openOnly }: { phases: Phase[]; quarters: RoadmapQuarter[]; departments: Record<string, string>; openOnly: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const all = quarters.flatMap((q) => q.items);
  const done = all.filter((i) => i.status === 'done').length;
  const firstOpen = quarters.findIndex((q) => q.items.some((i) => i.status !== 'done'));
  const sorted = [...phases].sort((a, b) => a.number - b.number);
  const current = sorted.length === 0 ? null : firstOpen < 0 ? null : sorted[Math.min(firstOpen, sorted.length - 1)];
  const shown = quarters.map((q) => ({ ...q, visible: openOnly ? q.items.filter((i) => i.status !== 'done') : q.items }));

  if (phases.length === 0 && all.length === 0) {
    return (
      <GPage className="wg-page">
        <GSectionHeader size="page" title="Roadmap" caption="Build plan" />
        <GEmpty
          title="No roadmap yet"
          body="Phases and quarter items live in the roadmap tables; the Wizard can draft them."
          action={{ label: 'Ask the Wizard', onClick: () => openWizard({ text: 'Draft a roadmap: phases and quarter items for ', source: 'roadmap-empty' }) }}
        />
      </GPage>
    );
  }

  return (
    <GPage className="wg-page">
      <GSectionHeader
        size="page"
        title="Roadmap"
        caption={`Build plan · ${done}/${all.length} shipped`}
        action={
          all.length > 0 ? (
            <GSegmented
              label="Show"
              value={openOnly ? 'open' : 'all'}
              onChange={(v) => router.replace(v === 'open' ? `${pathname}?show=open` : pathname, { scroll: false })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
              ]}
            />
          ) : undefined
        }
      />

      {sorted.length > 0 && (
        <section className="wg-rm-sec">
          <GSectionHeader size={22} title={`Phases · ${sorted.length}`} />
          <div className="wg-rm-phases">
            {sorted.map((p) => {
              const label = `Phase ${String(p.number).padStart(2, '0')}`;
              if (current?.id === p.id) {
                return (
                  <GHeroCard
                    key={p.id}
                    variant="a"
                    size="sm"
                    caption={`${label} · current`}
                    value={String(p.number).padStart(2, '0')}
                    label={`Current phase: ${label}, ${p.title}`}
                    status={p.title}
                    title="The phase whose ordinal matches the first quarter with open work."
                    className="wg-rm-hero"
                  />
                );
              }
              return (
                <GCard key={p.id} as="article" className="wg-rm-phase" aria-label={`${label}: ${p.title}`}>
                  <span className="wg-cap">{label}</span>
                  <span className="wg-rm-phase-title">{p.title}</span>
                  <ul className="wg-rm-list">
                    {p.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </GCard>
              );
            })}
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="wg-rm-sec">
          <GSectionHeader size={22} title="Quarter by quarter" />
          <div className="wg-rm-quarters">
            {shown.map(({ quarter, items, visible }) => {
              const d = items.filter((i) => i.status === 'done').length;
              return (
                <section key={quarter} className="wg-rm-q" aria-label={quarter}>
                  <div className="wg-rm-q-head">
                    <span className="wg-rm-q-name">{quarter.replace('-', ' ')}</span>
                    <span className="wg-cap">
                      {d}/{items.length} done
                    </span>
                  </div>
                  <GBar label={`${quarter}: ${d} of ${items.length} items done`} value={d} max={Math.max(1, items.length)} />
                  {visible.length === 0 ? (
                    <p className="wg-cap">Everything here is done.</p>
                  ) : (
                    visible.map((i) => <Item key={i.id} item={i} department={i.departmentId ? departments[i.departmentId] ?? null : null} />)
                  )}
                </section>
              );
            })}
          </div>
        </section>
      )}
    </GPage>
  );
}
