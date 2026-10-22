'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import type { Campaign } from '@/lib/creative-engine/schemas';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import type { Catalog, CatalogActor } from '@/lib/arcads/catalog';
import { api, ApiError, type HealthSnapshot } from '@/components/creative-engine/api';
import { ErrorLine, Field, Progress } from '@/components/creative-engine/primitives';
import { Btn, Chip, DownloadLink, Select, SetupLink, TileButton } from '@/components/creative-engine/skin';
import { Empty } from '@/components/creative-engine/skin-dash';
import { fmtCredits } from '@/lib/creative-engine/format';

/** UGC studio on paper: actor grid, voice list, approved script, cost card, delivered videos. */
export function UgcStudio({ campaign, health, readOnly = false, onCampaign, onRuns, onConnect, onScripter, catalogOverride = null, highlightAssetId }: { onScripter?: () => void; highlightAssetId?: string; catalogOverride?: (Catalog & { setupHref: string }) | null; campaign: Campaign | null; health: HealthSnapshot; readOnly?: boolean; onCampaign: (c: Campaign) => void; onRuns: (r: ResolvedRun[]) => void; onConnect: () => void }) {
  const [catalog, setCatalog] = useState<(Catalog & { setupHref: string }) | null>(null);
  const [gender, setGender] = useState<'all' | 'female' | 'male'>('all');
  const [actor, setActor] = useState<CatalogActor | null>(null);
  const [situationId, setSituationId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capAsk, setCapAsk] = useState<string | null>(null);
  // §3.1.7: a paid submit is two clicks; the first names the cost source.
  const [confirming, setConfirming] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = async (refresh = false) => {
    // S04 B25: the sample preview never touches the network; it has its own fictional catalog.
    if (catalogOverride) {
      setCatalog(catalogOverride);
      if (!productId && catalogOverride.products[0]) setProductId(catalogOverride.products[0].id);
      return;
    }
    try {
      const c = await api.catalog(refresh);
      setCatalog(c);
      if (!productId && c.products[0]) setProductId(c.products[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the catalog.');
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const approved = (campaign?.scripts ?? []).filter((s) => s.approvedVersion !== null);
  const script = approved.find((s) => s.id === scriptId) ?? approved[0] ?? null;
  const version = script?.versions.find((v) => v.n === script.approvedVersion) ?? null;
  const angle = campaign?.angles.find((a) => a.id === script?.angleId);
  const ugcAssets = (campaign?.assets ?? []).filter((a) => campaign?.generations.find((g) => g.id === a.generationId)?.kind === 'ugc');
  // S07 F15: a delivered UGC run opens here with its video shown and ringed, even if older than the last three.
  const recent = ugcAssets.slice(-3).reverse();
  const highlighted = highlightAssetId ? ugcAssets.find((a) => a.id === highlightAssetId) : undefined;
  const delivered = highlighted && !recent.includes(highlighted) ? [highlighted, ...recent] : recent;
  const deliveredRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightAssetId) return;
    deliveredRef.current?.querySelector(`[data-asset-id='${CSS.escape(highlightAssetId)}']`)?.scrollIntoView({ block: 'center' });
  }, [highlightAssetId, catalog]);

  if (!health.arcads.configured) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-[17px] font-light">Arcads is not connected.</p>
        <p className="ae-cap max-w-md">Actors, voices and video generation need the Arcads key. Nothing here is shown as working until it is.</p>
        <div className="flex items-center gap-2"><Btn tone="ink" onClick={onConnect}>Connect Arcads</Btn><SetupLink href={health.arcads.setupHref} hint="ARCADS_BASIC_AUTH" /></div>
      </div>
    );
  }

  const preview = (url: string) => { if (!url) return; audio.current?.pause(); audio.current = new Audio(url); void audio.current.play().catch(() => {}); };

  const submit = async (override = false) => {
    if (!campaign || !script || !situationId || readOnly) return;
    setBusy(true); setError(null); setCapAsk(null); setConfirming(false);
    try {
      const res = await api.ugc({ campaignId: campaign.id, scriptId: script.id, situationId, voiceId, productId, override });
      setNotice(`Submitted as run ${res.runId}. The video lands below when Arcads finishes; this page checks every 5 seconds.`);
      onRuns((await api.runs(campaign.id)).runs);
      onCampaign((await api.campaign(campaign.id)).campaign);
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'cap') setCapAsk(err.message);
      else setError(err instanceof Error ? err.message : 'Submit failed.');
    } finally {
      setBusy(false);
    }
  };

  const actors = (catalog?.actors ?? []).filter((a) => gender === 'all' || a.gender.toLowerCase() === gender);
  const voices = (catalog?.voices ?? []).filter((v) => gender === 'all' || (v.gender ?? '').toLowerCase() === gender);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_300px]">
      <section>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-light">Actor</span>
          <span className="flex items-center gap-1.5">
            {(['all', 'female', 'male'] as const).map((g) => (<Chip key={g} active={gender === g} onClick={() => setGender(g)}>{g[0].toUpperCase() + g.slice(1)}</Chip>))}
            <Btn size="sm" onClick={() => load(true)} disabled={!!catalogOverride} title={catalogOverride ? 'Sample data: the catalog is fictional and offline' : 'Refresh the catalog'} aria-label="Refresh the catalog"><RefreshCw className="h-3 w-3" strokeWidth={1.8} /></Btn>
          </span>
        </div>
        {!catalog ? <Progress text="Loading actors" /> : catalog.state === 'error' ? <ErrorLine text={catalog.detail} /> : actors.length === 0 ? <Empty line1="No actors returned." line2={catalog.detail} /> : (
          <div className="mt-3 grid max-h-[52vh] grid-cols-3 gap-3 overflow-y-auto pr-1">
            {actors.map((a) => (
              <TileButton key={a.id} onClick={() => { setActor(a); setSituationId(a.situations[0]?.id ?? null); }} aria-pressed={actor?.id === a.id} className="ae-card-2 overflow-hidden text-left" gClassName="!p-0 flex-col" style={actor?.id === a.id ? { boxShadow: '0 0 0 1.5px var(--p-ink) inset, var(--p-shadow-sm)' } : undefined}>
                <ActorImage url={a.imageUrl} name={a.name} />
                <div className="px-3 py-2 text-[12.5px]">{a.name}<span className="ae-faint ml-1">{a.situations.length} scene{a.situations.length === 1 ? '' : 's'}</span></div>
              </TileButton>
            ))}
          </div>
        )}
        {actor && actor.situations.length > 1 && (
          <div className="mt-3">
            <div className="ae-cap mb-1.5">Scenes for {actor.name}</div>
            <div className="flex flex-wrap gap-1.5">{actor.situations.map((s) => (<Chip key={s.id} active={situationId === s.id} onClick={() => setSituationId(s.id)}>{s.tags.slice(0, 2).join(', ') || s.id.slice(0, 6)}</Chip>))}</div>
          </div>
        )}
      </section>

      <section>
        <span className="text-[15px] font-light">Voice</span>
        <div className="mt-3 max-h-[26vh] space-y-2 overflow-y-auto pr-1">
          <TileButton onClick={() => setVoiceId(null)} aria-pressed={voiceId === null} className="ae-card-2 flex w-full items-center justify-between px-4 py-3 text-left" gClassName="!px-4 !py-3" style={voiceId === null ? { boxShadow: '0 0 0 1.5px var(--p-ink) inset, var(--p-shadow-sm)' } : undefined}><span className="text-[13px]">Match the actor</span><span className="ae-faint">recommended</span></TileButton>
          {voices.map((v) => (
            <div key={v.id} className="ae-card-2 flex items-center gap-2 px-4 py-3" style={voiceId === v.id ? { boxShadow: '0 0 0 1.5px var(--p-ink) inset, var(--p-shadow-sm)' } : undefined}>
              <TileButton onClick={() => setVoiceId(v.id)} aria-pressed={voiceId === v.id} className="min-w-0 flex-1 text-left" gClassName="ce-g-tile-flat !p-0 flex-col !items-start"><span className="text-[13px]">{v.name}</span><span className="ae-faint block truncate">{[v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(', ')}</span></TileButton>
              {v.audioUrl && <Btn size="sm" onClick={() => preview(v.audioUrl)} title="Preview" aria-label={`Preview ${v.name}`}><Play className="h-3 w-3" strokeWidth={1.8} /></Btn>}
            </div>
          ))}
        </div>
        <div className="mt-5 text-[15px] font-light">Script</div>
        {approved.length === 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-2"><p className="ae-cap">No approved script yet. Approve a version in the Ad scripter first.</p>{onScripter && <Btn size="sm" onClick={onScripter}>Open the Ad scripter</Btn>}</div>
        ) : (
          <div className="mt-2">
            <div className="flex flex-wrap gap-1.5">{approved.map((s) => (<Chip key={s.id} active={script?.id === s.id} onClick={() => setScriptId(s.id)} title={campaign?.angles.find((a) => a.id === s.angleId)?.title ?? s.id}>{clip(campaign?.angles.find((a) => a.id === s.angleId)?.title ?? s.id, 26)}</Chip>))}</div>
            {version && <p className="ae-card-2 mt-2 max-h-[20vh] overflow-y-auto p-4 text-[14px] font-light leading-snug">{version.fullScript}</p>}
            {version && <div className="ae-faint mt-1">{version.wordCount} words, about {Math.ceil(version.wordCount / 2.5)} seconds · {angle?.title}</div>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="ae-card-2 p-5">
          <div className="text-[15px] font-light">Before you generate</div>
          {catalog && catalog.products.length > 0 && (
            <div className="mt-3"><Field label="Arcads product"><Select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>{catalog.products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</Select></Field></div>
          )}
          <div className="mt-3 space-y-1 text-[12.5px]">
            <div className="flex justify-between"><span className="text-[var(--p-muted)]">Balance</span><span>{health.dry ? 'dry run' : health.arcads.balance?.creditsRemaining != null ? `${fmtCredits(health.arcads.balance.creditsRemaining)} credits` : 'not read yet'}</span></div>
            <div className="flex justify-between"><span className="text-[var(--p-muted)]">This session</span><span>{fmtCredits(health.arcads.sessionSpent)} of {fmtCredits(health.arcads.sessionCap)} cap</span></div>
            <div className="flex justify-between"><span className="text-[var(--p-muted)]">Path</span><span>{health.arcads.ugcPath === 'v2' ? 'talking actors v2' : 'script chain v1'}</span></div>
          </div>
          <p className="ae-faint mt-3 leading-snug">Arcads charges when you submit. A content-check rejection is not refunded.</p>
          <Btn tone="ink" onClick={() => setConfirming(true)} disabled={busy || !script || !situationId || !campaign || readOnly || confirming} title={readOnly ? 'Sample data: actions are off' : !script ? 'Approve a script first' : !situationId ? 'Pick an actor first' : 'Asks before it spends'} className="mt-4 w-full" cClassName="ae-sending" data-busy={busy} busy={busy}>{busy ? 'Sending to Arcads' : 'Generate the video'}</Btn>
          {confirming && !busy && (
            <div className="ae-confirm text-[12.5px]" role="group" aria-label="Confirm the spend">
              <span className="min-w-0 flex-1">{health.dry ? 'Dry run: a placeholder is delivered, nothing is charged.' : 'Spends Arcads credits on one UGC video, charged on submit.'}</span>
              <Btn size="sm" tone="ink" onClick={() => void submit(false)} autoFocus>Generate</Btn>
              <Btn size="sm" onClick={() => setConfirming(false)}>Cancel</Btn>
            </div>
          )}
          {capAsk && (
            <div className="ae-card-3 ae-shake mt-2 p-3 text-[12.5px]">
              <div>{capAsk}</div>
              <div className="mt-2 flex gap-2"><Btn size="sm" tone="ink" onClick={() => submit(true)}>Pass the cap once</Btn><Btn size="sm" onClick={() => setCapAsk(null)}>Cancel</Btn></div>
            </div>
          )}
          {notice && <p className="ae-cap ae-toast mt-2">{notice}</p>}
          {error && <div className="ae-shake"><ErrorLine text={error} /></div>}
        </div>
        <div>
          <div className="ae-cap mb-2">Delivered</div>
          {ugcAssets.length === 0 ? <p className="ae-faint">Nothing delivered yet.</p> : (
            <div ref={deliveredRef} className="space-y-2">
              {delivered.map((a) => (
                <div key={a.id} className="ae-card-2 p-3" data-asset-id={a.id} data-highlight={a.id === highlightAssetId || undefined}>
                  {a.path && !readOnly && !health.dry ? <video src={a.path} controls className="ae-arrive w-full rounded-[12px] bg-black" /> : <div className="ae-arrive rounded-[12px] bg-[var(--p-card)] px-3 py-6 text-center text-[11.5px] text-[var(--p-muted)]">{readOnly ? 'Sample asset' : health.dry && a.path ? `Dry run placeholder delivered: ${a.path.split('/').pop()}` : 'File missing'}</div>}
                  <div className="ae-faint mt-2 flex justify-between"><span>{a.model} · {a.creditsCharged != null ? `${fmtCredits(a.creditsCharged)} ${a.creditsCharged === 1 ? 'credit' : 'credits'}` : 'charge not read'}</span>{a.path && <DownloadLink href={a.path} className="text-[var(--p-ink)]">Download</DownloadLink>}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** S04 B35: an actor tile never renders blank; a missing or broken image shows the initial. */
function ActorImage({ url, name }: { url?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="aspect-[3/4] bg-[var(--p-card)]">
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-[20px] font-light text-[var(--p-dim)]" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
      )}
    </div>
  );
}
