'use client';

import { useState, type ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { GButton, GCard, GDriverBars, GEmpty, GErrorLine, GHeroCard, GList, GProgress, GRadar, GRow, GRuler, GSearch, GSectionHeader, GSheet, GTag, GVizStage, type GTagTone } from '@/components/g';
import type { VizColor } from '@/components/g/viz-shared';
import { GBrainRadialLazy } from '@/components/GBrainRadialLazy';
import { BrainDock } from '@/components/BrainDock';
import { useBrainQuery } from '@/components/BrainQuery';
import type { ObservatoryData } from '@/lib/gbrain-observatory';
import type { PillarAxis } from '@/lib/pillar-radar';
import type { StorageLayer } from '@/lib/brain-layers';

/**
 * /brain under the GladOS style (SPEC S05 F05.10 to F05.17). The radial keeps
 * every interaction inside a GVizStage; the Doctor is the page's one hero and
 * opens the checks and hybrid search; Pillar health is a GRadar; storage is a
 * list with honest values (H33); the folder bars are the one Pipeline stage
 * with real data. Explanations live in About.
 */

type DoctorCheck = { name: string; status: string; message: string };
export type DoctorLite = { connected: boolean; healthScore: number | null; detail: string; checks: DoctorCheck[] };

const CHECK_TONE: Record<string, GTagTone> = { ok: 'ok', warn: 'warn', error: 'err' };

export function RadialStage({ data }: { data: ObservatoryData }) {
  const [fs, setFs] = useState(false);
  return (
    <GVizStage
      label="Optimal Engine radial"
      height="max(560px, calc(100vh - 180px))"
      fullscreen={fs}
      onFullscreenChange={setFs}
      className="kg-radial"
      hudTopLeft={
        <>
          <span className="kg-hud-title">Optimal Engine · radial</span>
          <span className="kg-cap">{data.statusLine}</span>
        </>
      }
      hudTopRight={data.mounted ? <span className="kg-cap" title="Embedded chunks across the brain-store">{data.totalChunks.toLocaleString('en-US')} chunks</span> : undefined}
      bottomCenter={data.mounted ? <BrainDock g /> : undefined}
    >
      {data.mounted ? (
        <GBrainRadialLazy data={data} g fullscreen={fs} />
      ) : (
        <div className="kg-stage-empty">
          <GEmpty kind="unconfigured" title="No brain-store mounted" body="The radial draws the brain-store's folders and pages once it is mounted." setupHref="/setup" setupHint="expected at ~/knowledge/brain-store (or GBRAIN_STORE)" />
        </div>
      )}
    </GVizStage>
  );
}

function HybridSearch({ fallbackActive }: { fallbackActive: boolean }) {
  const { q, setQ, state, run } = useBrainQuery();
  return (
    <div className="kg-stack-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="kg-query"
      >
        <GSearch value={q} onValueChange={setQ} size="md" placeholder="Query the second brain" aria-label="Query the second brain" />
        <GButton type="submit" variant="ink" busy={state.phase === 'busy'} disabled={!q.trim()} disabledReason="Type a question first">
          Search
        </GButton>
      </form>
      {state.phase === 'busy' && <GProgress text="Querying: hybrid (local + ZeroEntropy)…" />}
      {state.phase === 'error' && <GErrorLine align="left">Query failed: {state.message}</GErrorLine>}
      {state.phase === 'done' && (
        <>
          <p className="kg-cap">
            {state.hits.length} hits for “{state.query}”{fallbackActive ? ' · local fallback (Supabase paused)' : ''}
          </p>
          {state.hits.length === 0 ? (
            <GEmpty inline title="Nothing matched" body="Try a broader phrase." />
          ) : (
            <GList divided label="Results">
              {state.hits.map((h) => (
                <GRow key={h.title} title={h.title} meta={h.snippet} trailing={<span className="kg-cap">{h.source}</span>} />
              ))}
            </GList>
          )}
        </>
      )}
    </div>
  );
}

/** Doctor hero (F05.14): health, warnings and last run; opens checks and hybrid search. */
export function DoctorHero({ doctor, lastRun, fallbackActive }: { doctor: DoctorLite; lastRun: string | null; fallbackActive: boolean }) {
  const [open, setOpen] = useState(false);
  const warnings = doctor.checks.filter((c) => c.status !== 'ok');
  const status = doctor.connected
    ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} · ${lastRun ? `last run ${lastRun}` : 'no agent runs yet'}`
    : 'CLI unreachable';
  return (
    <>
      <GHeroCard
        variant="a"
        caption="Doctor"
        value={doctor.connected ? doctor.healthScore : null}
        label={doctor.connected && doctor.healthScore != null ? `Health ${doctor.healthScore} of 100` : 'Health unknown'}
        title="Engine health score, 0 to 100. Opens the checks and hybrid search."
        status={status}
        strip={<GRuler value={doctor.connected ? doctor.healthScore : null} max={100} onHero label={`Health ${doctor.healthScore ?? 'unknown'} of 100`} />}
        onClick={() => setOpen(true)}
        className="kg-doctor"
      />
      <GSheet open={open} onClose={() => setOpen(false)} title="Doctor · search" caption={doctor.connected ? `${warnings.length} of ${doctor.checks.length} checks need attention` : 'Doctor offline'} width={720}>
        <div className="kg-stack">
          {!doctor.connected ? (
            <GEmpty kind="unconfigured" title="The engine CLI is unreachable" body={doctor.detail} setupHref="/setup" setupHint={doctor.detail} />
          ) : (
            <GList divided label="Doctor checks">
              {doctor.checks.map((c) => (
                <GRow
                  key={c.name}
                  title={<span className="kg-mono-inline" data-mono-ok="">{c.name}</span>}
                  meta={c.message}
                  trailing={<GTag tone={CHECK_TONE[c.status] ?? 'err'} dot size="xs">{c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Warning' : 'Error'}</GTag>}
                />
              ))}
            </GList>
          )}
          <section className="kg-stack-sm" aria-label="Hybrid search">
            <GSectionHeader size={22} title="Hybrid search" caption="Keyword and vector search over the brain, with a local fallback." />
            <HybridSearch fallbackActive={fallbackActive} />
            {fallbackActive && (
              <div className="kg-fallback">
                <Zap size={14} strokeWidth={1.7} aria-hidden="true" />
                <span className="kg-body">Supabase free tier is paused: hybrid queries fall back to local grep until revived.</span>
                <GButton variant="sm" href="/roadmap">
                  Roadmap
                </GButton>
              </div>
            )}
          </section>
        </div>
      </GSheet>
    </>
  );
}

const LAYERS: { id: keyof Pick<PillarAxis, 'score' | 'roster' | 'freshness' | 'sop'>; label: string; color: VizColor }[] = [
  { id: 'score', label: 'Overall', color: 'accent' },
  { id: 'roster', label: 'Roster', color: 'series-2' },
  { id: 'freshness', label: 'Run freshness', color: 'series-3' },
  { id: 'sop', label: 'SOP coverage', color: 'series-4' },
];

/** Pillar health (F05.15): the radar with its layers; the duplicated health footer is cut. */
export function PillarHealth({ axes }: { axes: PillarAxis[] }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <GCard as="section" p={24} className="kg-pillar" aria-labelledby="pillar-head">
      <GSectionHeader size={22} id="pillar-head" title="Pillar health" caption="Live roster, run freshness and SOP coverage per department" />
      {axes.length === 0 ? (
        <GEmpty inline title="No departments yet" />
      ) : (
        <GRadar
          label="Pillar health radar"
          axes={axes.map((a) => ({ id: a.id, label: a.label }))}
          layers={LAYERS.map((l) => ({ id: l.id, label: l.label, color: l.color, values: axes.map((a) => a[l.id]) }))}
          activeLayer={active}
          onLayer={setActive}
          size={320}
        />
      )}
    </GCard>
  );
}

const LAYER_TONE: Record<string, GTagTone> = { connected: 'ok', available: 'warn', error: 'err', off: 'neutral' };

export function StorageLayers({ layers }: { layers: StorageLayer[] }) {
  return (
    <GCard as="section" p={20} aria-labelledby="storage-head" className="kg-card-stack">
      <GSectionHeader size={22} id="storage-head" title="Storage layers" caption="Where the knowledge lives, from disk to database" />
      <GList divided label="Storage layers">
        {layers.map((l) => (
          <GRow
            key={l.name}
            leading={<span className="kg-dot" data-state={l.state} aria-hidden="true" />}
            title={l.name}
            meta={<span className="kg-trunc">{l.sub}</span>}
            trailing={<GTag tone={LAYER_TONE[l.state] ?? 'neutral'} size="xs">{l.val}</GTag>}
            hint={`${l.name}: ${l.val}`}
          />
        ))}
      </GList>
    </GCard>
  );
}

export function FolderBars({ folders, total }: { folders: { name: string; files: number }[]; total: number }) {
  const rows = [...folders].sort((a, b) => b.files - a.files).map((f) => ({ id: f.name, label: f.name, value: f.files, title: `${f.files} pages in ${f.name}/` }));
  return (
    <GCard as="section" p={20} aria-labelledby="folders-head" className="kg-card-stack">
      <GSectionHeader size={22} id="folders-head" title="Brain-store by folder" caption={`${total} pages on disk, plain markdown`} />
      <GDriverBars rows={rows} labelWidth={120} label="Pages per folder" />
    </GCard>
  );
}

export function BrainSection({ id, title, caption, children }: { id: string; title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <section className="kg-section" aria-labelledby={id}>
      <GSectionHeader size={22} id={id} title={title} caption={caption} />
      {children}
    </section>
  );
}
