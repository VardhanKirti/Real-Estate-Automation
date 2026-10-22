'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Search, X } from 'lucide-react';
import type { Angle, Campaign, Depth, PoolAd } from '@/lib/creative-engine/schemas';
import { DEPTH_BUDGET } from '@/lib/creative-engine/schemas';
import { api, type CampaignSummary, type HealthSnapshot } from '@/components/creative-engine/api';
import { ErrorLine, Progress, ago } from '@/components/creative-engine/primitives';
import { Btn, CheckMark, Chip, Input, SetupLink, ThumbButton, useG } from '@/components/creative-engine/skin';
import { Badge, Drivers, Empty, ProofGauge, Tag } from '@/components/creative-engine/skin-dash';
import { GCheck } from '@/components/g';
import { Drawer } from '@/components/creative-engine/Widget';
import { brandInitials } from '@/lib/creative-engine/format';
import type { ProductOption } from '@/lib/creative-engine/products';

/**
 * Creative generator on paper: one large pill search bar, quiet option
 * chips, a research trace as tags, and angle cards that read like the
 * reference's snapshot cards (proof thumbnails, a ruler, driver bars),
 * selected by a lime check. Phases show a plain sentence, never a percent.
 */

type Phase = { kind: 'idle' } | { kind: 'researching' } | { kind: 'angling' } | { kind: 'error'; message: string };

/** Where the sheet opens (S07 F3, §7.5): the concept input, the research summary, the angle grid or one angle. */
export type GeneratorFocus = 'concept' | 'research' | 'angles' | { angleId: string };

export function CreativeGenerator({ campaign, campaigns, health, readOnly = false, onCampaign, onSwitch, onContinue, fresh = false, products = [], onConnect, focus, proofOnly: proofOnlyProp = false, onProofOnly }: { fresh?: boolean; products?: ProductOption[]; onConnect?: () => void; campaign: Campaign | null; campaigns: CampaignSummary[]; health: HealthSnapshot; readOnly?: boolean; onCampaign: (c: Campaign) => void; onSwitch: (id: string) => void; onContinue: () => void; focus?: GeneratorFocus; proofOnly?: boolean; onProofOnly?: (on: boolean) => void }) {
  // `fresh` (New concept from the switcher) opens with empty fields, so Generate starts a new campaign.
  const seed = fresh ? null : campaign;
  const [text, setText] = useState(seed?.concept.text ?? '');
  const [product, setProduct] = useState(seed?.concept.product ?? '');
  const [audience, setAudience] = useState(seed?.concept.audience ?? '');
  const [goal, setGoal] = useState<Campaign['concept']['goal']>(seed?.concept.goal ?? 'unset');
  const [depth, setDepth] = useState<Depth>('standard');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [detail, setDetail] = useState<PoolAd | null>(null);
  const [adsWanted, setAdsWanted] = useState<number | null>(null);
  const conceptRef = useRef<HTMLInputElement>(null);
  const researchRef = useRef<HTMLDivElement>(null);
  const anglesRef = useRef<HTMLDivElement>(null);
  // "Proven only" is owned by the page when it passes onProofOnly (so the address bar carries it, ?proven=1).
  const [proofOnlyLocal, setProofOnlyLocal] = useState(proofOnlyProp);
  const proofOnly = onProofOnly ? proofOnlyProp : proofOnlyLocal;
  const setProofOnly = (on: boolean) => (onProofOnly ? onProofOnly(on) : setProofOnlyLocal(on));
  const listId = useId();

  // S07 F3: open where the clicked number lives.
  // Keyed by value: the parent passes a fresh object each render.
  const focusKey = typeof focus === 'object' ? `angle:${focus.angleId}` : focus ?? '';
  useEffect(() => {
    if (!focusKey) return;
    const angleId = focusKey.startsWith('angle:') ? focusKey.slice(6) : null;
    const el = focusKey === 'research' ? researchRef.current
      : focusKey === 'angles' ? anglesRef.current
      : angleId ? anglesRef.current?.querySelector<HTMLElement>(`[data-angle-id='${CSS.escape(angleId)}']`) ?? anglesRef.current
      : null;
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (angleId && el.dataset.angleId) el.focus({ preventScroll: true });
    } else conceptRef.current?.focus();
  }, [focusKey]);

  const foreplayOk = health.dry || health.foreplay.configured;
  const claudeOk = health.dry || health.claude.present;
  const isNewConcept = !campaign || campaign.concept.text.trim() !== text.trim();
  const busy = phase.kind === 'researching' || phase.kind === 'angling';

  // §3.1.7: research spends Foreplay credits, so a live run takes two steps: the first click names the cost.
  const [armed, setArmed] = useState(false);
  useEffect(() => { setArmed(false); }, [text, depth]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);
  const generate = async () => {
    const t = text.trim();
    if (t.length < 3 || busy || readOnly) return;
    if (!health.dry && !armed) { setArmed(true); return; }
    setArmed(false);
    setPhase({ kind: 'researching' });
    try {
      let c = campaign;
      if (isNewConcept) c = (await api.createCampaign({ text: t, product, audience, goal })).campaign;
      c = (await api.research(c!.id, depth)).campaign;
      onCampaign(c);
      setPhase({ kind: 'angling' });
      onCampaign((await api.angles(c.id)).campaign);
      setAdsWanted(null);
      setPhase({ kind: 'idle' });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Generation failed.' });
    }
  };

  const toggleAngle = async (a: Angle) => {
    if (!campaign || readOnly) return;
    const ids = campaign.angles.filter((x) => (x.id === a.id ? !x.selected : x.selected)).map((x) => x.id);
    try {
      onCampaign((await api.patchCampaign(campaign.id, { selectedAngleIds: ids, ...(adsWanted !== null ? { adsWanted } : {}) })).campaign);
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save the selection.' });
    }
  };

  const selected = campaign?.angles.filter((a) => a.selected) ?? [];
  const pool = campaign?.research?.pool ?? [];
  // "Proven only" (the Proven stat): angles whose proof ads are all still live past the campaign's minimum.
  const minDays = campaign?.research?.minDays ?? 21;
  const provenIds = new Set(pool.filter((a) => a.live && a.daysRunning >= minDays).map((a) => a.id));
  const shownAngles = (campaign?.angles ?? []).filter((a) => !proofOnly || (a.proofAdIds.length > 0 && a.proofAdIds.every((id) => provenIds.has(id))));
  // S03 FR-11: the help line shows only while the concept is empty and no campaign is loaded.
  const showHelp = !campaign && text.trim() === '';

  return (
    <div className="flex h-full flex-col">
      {/* search */}
      <div className="ae-card-2 p-3">
        <div className="flex items-center gap-3">
          <Search className="ml-3 h-[18px] w-[18px] shrink-0 text-[var(--p-muted)]" strokeWidth={1.6} />
          <Input ref={conceptRef} size="lg" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generate()} maxLength={300} placeholder="Describe the idea you want ads for" aria-label="Ad idea" aria-describedby={showHelp ? 'ae-concept-help' : undefined} className="!shadow-none !bg-transparent" />
          <Btn tone="ink" onClick={generate} disabled={busy || text.trim().length < 3 || !foreplayOk || readOnly} title={readOnly ? 'Sample data: actions are off' : !foreplayOk ? 'Research needs the Foreplay key' : busy ? 'Working on the last request' : text.trim().length < 3 ? 'Type an idea of at least 3 characters' : armed ? `Spends up to ${DEPTH_BUDGET[depth].maxCalls} Foreplay credits. Click again to run.` : health.dry ? 'Research the library and propose angles (dry run, nothing is charged)' : `Research the library and propose angles. Spends up to ${DEPTH_BUDGET[depth].maxCalls} Foreplay credits; asks first.`}>{busy ? 'Working' : armed ? `Spend up to ${DEPTH_BUDGET[depth].maxCalls} Foreplay credits. Run` : 'Generate'}</Btn>
        </div>
        {showHelp && (
          <p id="ae-concept-help" className="ae-cap mt-1.5 px-2">One sentence about the outcome your customer wants. The engine turns it into searches.</p>
        )}
        <div className="mt-2 grid gap-2 px-2 pb-1 sm:grid-cols-[1fr_1fr_auto]">
          <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder={products[0] ? `Product, for example ${products[0].label}` : 'Product'} aria-label="Product" list={products.length ? listId : undefined} />
          <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Who it is for" aria-label="Audience" />
          <div className="flex flex-wrap items-center gap-1.5">
            {(['unset', 'awareness', 'leads', 'sales', 'installs'] as const).map((g) => (<Chip key={g} active={goal === g} onClick={() => setGoal(g)}>{g === 'unset' ? 'Any goal' : g[0].toUpperCase() + g.slice(1)}</Chip>))}
          </div>
        </div>
        {products.length > 0 && <datalist id={listId}>{products.map((p) => (<option key={p.label} value={p.label}>{p.detail}</option>))}</datalist>}
        <ProductChips products={products} value={product} readOnly={readOnly} arcadsConfigured={health.arcads.configured} arcadsSetupHref={health.arcads.setupHref} onPick={(label) => { setProduct(label); conceptRef.current?.focus(); }} onConnect={onConnect} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['light', 'standard', 'deep'] as const).map((d) => (<Chip key={d} active={depth === d} onClick={() => setDepth(d)} title={`${DEPTH_BUDGET[d].probes} searches, ${DEPTH_BUDGET[d].duplicates} duplicate checks`}>{d[0].toUpperCase() + d.slice(1)} · up to {DEPTH_BUDGET[d].maxCalls} credits</Chip>))}
        <span className="ae-cap ml-auto">
          {/* S03 FR-18 / S04 B24: a Foreplay number only while Foreplay is configured; the Set up line below explains otherwise. */}
          {[health.dry ? 'Dry run, nothing is charged' : health.foreplay.configured ? (health.foreplay.remaining !== null ? `${health.foreplay.remaining.toLocaleString()} Foreplay credits left` : 'Foreplay usage unknown') : null, claudeOk ? null : 'Claude absent, keyword search only'].filter(Boolean).join(' · ')}
        </span>
      </div>
      {!foreplayOk && (
        <div className="mt-3 flex items-center gap-3 text-[12.5px] text-[var(--p-muted)]">Research needs the Foreplay key. <SetupLink href={health.foreplay.setupHref} hint="FOREPLAY_API_KEY" /></div>
      )}

      {campaigns.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="ae-cap mr-1">Campaigns</span>
          {campaigns.slice(0, 8).map((c) => (<Chip key={c.id} active={campaign?.id === c.id} onClick={() => { onSwitch(c.id); setText(c.concept.text); setProduct(c.concept.product); setAudience(c.concept.audience); setGoal(c.concept.goal); }}>{c.name.slice(0, 28)}</Chip>))}
        </div>
      )}

      {campaign?.research && phase.kind === 'idle' && (
        <div ref={researchRef} className="mt-4 scroll-mt-4">
          <div className="ae-cap">Searched {ago(campaign.research.ranAt)} · {campaign.research.apiCalls} credits · {campaign.research.pool.length} proven ads, {campaign.research.minDays}+ days live</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {campaign.research.probes.map((p) => (<span key={p.query} className="ae-tag" title={p.why}>“{p.query}”<b className="font-medium text-[var(--p-ink)]">{p.results}</b></span>))}
          </div>
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1">
        {phase.kind === 'researching' && <Progress text="Planning searches, reading the library, keeping only ads still running" />}
        {phase.kind === 'angling' && <Progress text="Proposing angles from the proven ads" />}
        {phase.kind === 'error' && (<div><ErrorLine text={phase.message} /><div className="text-center"><Btn size="sm" onClick={() => setPhase({ kind: 'idle' })}>Dismiss</Btn></div></div>)}
        {phase.kind === 'idle' && (!campaign || campaign.angles.length === 0) && (
          <Empty line1={campaign?.research ? 'Research is done, no angles yet.' : 'Describe an idea to research it.'} line2={campaign?.research ? 'Generate again to propose angles from the pooled ads.' : 'The engine decides what to search, the library answers, and longevity ranks the results. Every angle cites ads that are still running.'} />
        )}
        {phase.kind === 'idle' && campaign && campaign.angles.length > 0 && (
          <div ref={anglesRef} className="scroll-mt-4">
            {proofOnly && (
              <div className="mb-3 flex flex-wrap items-center gap-2" data-proof-filter>
                <Chip active onClick={() => setProofOnly(false)} title="Clear the filter and show every angle">Proven only <X className="h-3 w-3" strokeWidth={2} /></Chip>
                <span className="ae-cap">{shownAngles.length} of {campaign.angles.length} angles cite only ads live {minDays}+ days.</span>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {shownAngles.map((a) => (<AngleCard key={a.id} angle={a} pool={pool} readOnly={readOnly} onToggle={() => toggleAngle(a)} onOpenAd={setDetail} />))}
            </div>
            {shownAngles.length === 0 && <p className="ae-cap py-6 text-center">No angle cites only proven ads yet.</p>}
          </div>
        )}
      </div>

      {campaign && campaign.angles.length > 0 && (
        <div className="ae-gen-footer">
          <span className="text-[13.5px]">{selected.length} angle{selected.length === 1 ? '' : 's'} selected</span>
          <label className="ae-cap flex items-center gap-2">Ads wanted <Input type="number" min={0} max={50} value={adsWanted ?? campaign.adsWanted ?? selected.length} onChange={(e) => setAdsWanted(Number(e.target.value))} className="w-[64px] text-center" cClassName="!py-1" /></label>
          <Btn tone="ink" onClick={async () => { if (adsWanted !== null && !readOnly) onCampaign((await api.patchCampaign(campaign.id, { adsWanted })).campaign); onContinue(); }} disabled={selected.length === 0} disabledReason="Select at least one angle" className="ml-auto">Continue to scripts <ArrowRight className="h-4 w-4" strokeWidth={1.8} /></Btn>
        </div>
      )}

      {detail && <AdDetail ad={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const CHIP_MAX = 6;
const LABEL_MAX = 24;

/**
 * "Your products" (S03 FR-12): one chip per option, max six, +N shows the
 * rest. A chip fills Product and hands focus back to the concept; the
 * matching chip reads active. With no options the line says so and offers
 * the one way to get one: choose an Arcads product, or set Arcads up.
 */
function ProductChips({ products, value, readOnly, arcadsConfigured, arcadsSetupHref, onPick, onConnect }: { products: ProductOption[]; value: string; readOnly: boolean; arcadsConfigured: boolean; arcadsSetupHref: string; onPick: (label: string) => void; onConnect?: () => void }) {
  const [all, setAll] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  if (products.length === 0) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 px-2 pb-1" data-products="none">
        <span className="ae-cap">No products yet.</span>
        {arcadsConfigured ? (
          <Btn size="sm" onClick={onConnect} disabled={readOnly || !onConnect}>Choose an Arcads product</Btn>
        ) : (
          <SetupLink href={arcadsSetupHref} hint="ARCADS_BASIC_AUTH" label="Set up Arcads" />
        )}
      </div>
    );
  }
  const shown = all ? products : products.slice(0, CHIP_MAX);
  const extra = products.length - shown.length;
  const current = value.trim().toLowerCase();
  // Roving focus: Left/Right move between chips, like the goal chips.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const chips = Array.from(rowRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    chips[(i + (e.key === 'ArrowRight' ? 1 : -1) + chips.length) % chips.length]?.focus();
  };
  return (
    <div ref={rowRef} className="mt-2 flex flex-wrap items-center gap-1.5 px-2 pb-1" role="group" aria-label="Your products" data-products="populated" onKeyDown={onKey}>
      <span className="ae-cap mr-1">Your products</span>
      {shown.map((p) => (
        <Chip key={p.label} active={p.label.toLowerCase() === current} disabled={readOnly} onClick={() => onPick(p.label)} title={readOnly ? 'Sample data: the product is fixed' : `${p.label} · ${p.detail}`}>
          {p.label.length > LABEL_MAX ? `${p.label.slice(0, LABEL_MAX - 1)}…` : p.label}
        </Chip>
      ))}
      {extra > 0 && <Chip onClick={() => setAll(true)} title={`Show ${extra} more`}>+{extra}</Chip>}
    </div>
  );
}

function AngleCard({ angle, pool, onToggle, onOpenAd, readOnly = false }: { angle: Angle; pool: PoolAd[]; onToggle: () => void; onOpenAd: (ad: PoolAd) => void; readOnly?: boolean }) {
  const proof = angle.proofAdIds.map((id) => pool.find((a) => a.id === id)).filter((a): a is PoolAd => !!a);
  const stats = useMemo(() => {
    const days = proof.map((a) => a.daysRunning).sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median = days.length === 0 ? null : days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
    const known = proof.filter((a) => a.duplicates != null);
    const dups = known.length ? known.reduce((s, a) => s + (a.duplicates ?? 0), 0) : null;
    const sums = new Map<string, { t: number; n: number }>();
    for (const a of proof) for (const [k, v] of Object.entries(a.drivers)) { const c = sums.get(k) ?? { t: 0, n: 0 }; c.t += v; c.n += 1; sums.set(k, c); }
    return { median, dups, drivers: Object.fromEntries([...sums.entries()].map(([k, { t, n }]) => [k, Math.round((t / n) * 10) / 10])) };
  }, [proof]);

  const g = useG();
  // Classic: the whole card is the checkbox. Kit: the card is a surface and the GCheck in its corner is the
  // control (the card still toggles on a click, as a larger target); thumbnails stay their own buttons.
  const cardProps = readOnly ? { title: 'Sample data: selection is off' }
    : g ? { title: angle.selected ? 'Selected for scripts; click to drop it' : 'Select this angle for scripts', onClick: onToggle }
    : { role: 'checkbox', 'aria-checked': angle.selected, tabIndex: 0, title: angle.selected ? 'Selected for scripts; click to drop it' : 'Select this angle for scripts', onClick: onToggle, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } } };
  return (
    // In the sample the card is not a control (selection is off), so it does not pose as one; its proof thumbnails still open.
    <div {...cardProps} data-angle-id={angle.id} className={`ae-card-2 p-5 transition-shadow ${readOnly ? '' : 'cursor-pointer hover:shadow-[var(--p-shadow)]'}`} style={angle.selected ? { boxShadow: '0 0 0 1.5px var(--p-ink) inset, var(--p-shadow-sm)' } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {angle.confidence === 'strong' ? <Badge>Strong</Badge> : <Tag>Plausible</Tag>}
            <span className="ae-faint">{stats.dups !== null ? `${stats.dups} copies running` : 'copies not checked'}</span>
          </div>
          <div className="mt-2.5 text-[17px] font-light leading-tight">{angle.title}</div>
          <div className="ae-cap mt-1 line-clamp-2 text-[12.5px] leading-snug">{angle.thesis}</div>
        </div>
        {g && !readOnly ? (
          <span onClick={(e) => e.stopPropagation()}><GCheck checked={angle.selected} onCheckedChange={onToggle} aria-label={`Select ${angle.title} for scripts`} /></span>
        ) : (
          <CheckMark on={angle.selected} className="shrink-0">{angle.selected && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}</CheckMark>
        )}
      </div>
      {angle.hookPattern && <div className="mt-3 text-[13px]">{angle.hookPattern}</div>}
      <div className="mt-4 flex items-end gap-2">
        {proof.slice(0, 4).map((a) => (
          <ThumbButton key={a.id} onClick={(e) => { e.stopPropagation(); onOpenAd(a); }} title={`${a.brand}, ${a.daysRunning} days live`}>
            {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <span className="flex h-full w-full items-center justify-center text-[12px] text-[var(--p-muted)]" aria-label={a.brand}>{brandInitials(a.brand)}</span>}
            <b>{a.daysRunning}d</b>
          </ThumbButton>
        ))}
        <div className="ml-auto text-right">
          <div className="text-[22px] font-light leading-none">{stats.median ?? '—'}<span className="ae-cap ml-1">days</span></div>
          <div className="ae-faint">median, {proof.length} proof ad{proof.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div className="mt-3"><ProofGauge value={stats.median} max={90} ticks={30} /></div>
      <div className="mt-3"><Drivers drivers={stats.drivers} top={3} /></div>
    </div>
  );
}

function AdDetail({ ad, onClose }: { ad: PoolAd; onClose: () => void }) {
  return (
    <Drawer title={ad.brand} onClose={onClose}>
      <div className="ae-cap">{ad.format ?? 'ad'} · {ad.daysRunning} days {ad.live ? 'live' : 'paused'}{ad.duplicates != null ? ` · ${ad.duplicates} copies running` : ''}{ad.ctaType ? ` · ${ad.ctaType.toLowerCase().replaceAll('_', ' ')}` : ''}</div>
      {ad.video ? <video src={ad.video} controls className="mt-3 w-full rounded-[16px] bg-black" /> : ad.image || ad.thumbnail ? <img src={ad.image ?? ad.thumbnail ?? ''} alt="" className="mt-3 w-full rounded-[16px]" /> : null}
      {ad.hook && <p className="mt-4 text-[17px] font-light leading-snug">“{ad.hook}”</p>}
      <div className="mt-4"><Drivers drivers={ad.drivers} top={3} /></div>
      {ad.transcript.length > 0 && (
        <div className="mt-5 space-y-1.5 text-[12.5px]">
          <div className="ae-cap">Transcript</div>
          {ad.transcript.map((l, i) => (<div key={i} className="flex gap-3"><span className="w-[32px] shrink-0 tabular-nums text-[var(--p-dim)]">{Math.round(l.t)}s</span><span>{l.s}</span></div>))}
        </div>
      )}
      <div className="ae-faint mt-5">Found by {ad.probes.map((p) => `“${p}”`).join(', ') || 'the pool'}</div>
      {ad.linkUrl && <Btn size="sm" href={ad.linkUrl} external className="mt-3">Open landing page</Btn>}
    </Drawer>
  );
}
