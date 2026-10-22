'use client';

/**
 * The AdPilot command deck under the GladOS style (glados-ui SPEC S03 §4.5,
 * F22 to F30; X5). Same data and the same URL state as the Classic deck
 * (`?campaign=`), every widget a kit part: the status line is one GTag, the
 * floaters are GCards, the rail is a GSegmented, spend is GDriverBars (no
 * hatch, C8), delivery is one alpha GDotMatrix row per campaign, ROAS is a
 * GRingGauge, Results drops Leads and Bookings (the floaters show them), and
 * Audience is GShareBars. The globe stays the page hero on the plain ground,
 * coloured by the accent (C30) through the scoped .ap-g tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import type { Campaign, DailyPoint } from '@/lib/adpilot';
import {
  aggregateAudience, aggregateCampaigns, aggregateDaily, aggregateGeo, alignDaily, campaignMetrics, isStale, periodDays, relativeAgo, type CampaignMetrics,
} from '@/lib/adpilot';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { patchUrlParams, prefersReducedMotion } from '@/components/adpilot/url';
import { cityBreakdown, cityKey, type CityBreakdown } from '@/lib/adpilot-globe';
import { angleBetween } from '@/components/adpilot/projection';
import { pushEscape } from '@/lib/escape-stack';
import {
  GButton, GCard, GDelta, GDotMatrix, GDriverBars, GEmpty, GList, GRingGauge, GRow, GSearch, GSectionHeader, GSegmented, GShareBar, GTag,
} from '@/components/g';

const Globe = dynamic(() => import('@/components/adpilot/Globe').then((m) => m.Globe), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full" />,
});

const nf = new Intl.NumberFormat('en-US');
const money = (v: number) => `$${nf.format(Math.round(v))}`;
const money2 = (v: number | null) => (v === null ? null : `$${v.toFixed(2)}`);
const pct = (v: number | null) => (v === null ? null : `${(v * 100).toFixed(2)}%`);

const RAIL_FILTER_THRESHOLD = 10;
const WIDE_DECK = 960;
/** Pins closer than this on the sphere are "also here" on the City card (S11 §8 edge 1). */
const NEARBY_RAD = 0.026;

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Last 7 days against the 7 before; null under 14 days or a zero base. */
function week(daily: DailyPoint[], pick: (d: DailyPoint) => number): { cur: number; prev: number } | null {
  if (daily.length < 14) return null;
  const cur = daily.slice(-7).reduce((s, d) => s + pick(d), 0);
  const prev = daily.slice(-14, -7).reduce((s, d) => s + pick(d), 0);
  return prev > 0 ? { cur, prev } : null;
}

export function AdPilotDeckG({ campaigns, syncedAt, now, filming }: { campaigns: Campaign[]; syncedAt: string | null; now: number; filming: boolean }) {
  const params = useSearchParams();
  const urlCampaign = params.get('campaign');
  const known = urlCampaign !== null && campaigns.some((c) => c.id === urlCampaign);
  const selected = known ? (urlCampaign as string) : 'all';
  useEffect(() => {
    if (urlCampaign !== null && !known) patchUrlParams({ campaign: null });
  }, [urlCampaign, known]);
  const select = useCallback((id: string) => patchUrlParams({ campaign: id === 'all' ? null : id }), []);
  const toggle = useCallback((id: string) => select(selected === id ? 'all' : id), [select, selected]);

  const active = useMemo(() => (selected === 'all' ? campaigns : campaigns.filter((c) => c.id === selected)), [campaigns, selected]);
  const empty = campaigns.length === 0;
  const metrics = useMemo(() => (active.length === 1 ? campaignMetrics(active[0]) : aggregateCampaigns(active)), [active]);
  const geo = useMemo(() => aggregateGeo(active), [active]);

  const [cityFocus, setCityFocus] = useState<string | null>(null);
  const focusInGeo = cityFocus !== null && geo.some((g) => cityKey(g) === cityFocus);
  useEffect(() => {
    if (cityFocus !== null && !focusInGeo) setCityFocus(null);
  }, [cityFocus, focusInGeo]);
  const city = useMemo(() => {
    if (!cityFocus || !focusInGeo) return null;
    const [name, country] = cityFocus.split('|');
    return cityBreakdown(active, name, country);
  }, [active, cityFocus, focusInGeo]);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeCity = useCallback(() => {
    const inCard = !!cardRef.current && cardRef.current.contains(document.activeElement);
    setCityFocus(null);
    if (inCard) document.querySelector<HTMLElement>('[data-globe]')?.focus();
  }, []);
  useEffect(() => {
    if (!cityFocus) return;
    return pushEscape(() => closeCity(), { id: 'adpilot-city' });
  }, [cityFocus, closeCity]);
  useEffect(() => {
    if (!cityFocus) return;
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [cityFocus]);

  const selectedName = selected === 'all' ? null : campaigns.find((c) => c.id === selected)?.name ?? null;
  const audience = useMemo(() => (active.length === 1 ? active[0].audience : aggregateAudience(active)), [active]);
  const daily = useMemo(() => aggregateDaily(active), [active]);
  const days = useMemo(() => periodDays(active), [active]);
  const windowLabel = days ? `${days} day${days === 1 ? '' : 's'}` : null;

  const [deckRef, deckWidth] = useElementWidth<HTMLDivElement>();
  const [vw, setVw] = useState<number | null>(null);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const globeHeight = deckWidth === null || deckWidth >= WIDE_DECK || vw === null ? 560 : Math.max(320, Math.min(560, Math.round((vw * 0.6) / 40) * 40));

  const resultsRef = useRef<HTMLDivElement>(null);
  const showResults = () => resultsRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

  return (
    <div ref={deckRef} className="ap-g-deck">
      <Status campaigns={campaigns} syncedAt={syncedAt} now={now} filming={filming} />

      <div className="ap-g-stage">
        {!empty && (
          <div className="ap-g-floaters">
            <GCard p={20} onClick={showResults} className="ap-g-float" title="Show results breakdown" aria-label={`Total leads: ${nf.format(metrics.leads)}. Show results breakdown`}>
              <span className="soc-g-cap">{windowLabel ? `Total leads · ${windowLabel}` : 'Total leads'}</span>
              <span className="soc-g-num">{nf.format(metrics.leads)}</span>
            </GCard>
            <GCard p={20} onClick={showResults} className="ap-g-float" title="Show results breakdown" aria-label={`Booked calls: ${nf.format(metrics.bookings)}. Show results breakdown`}>
              <span className="soc-g-cap">Booked calls</span>
              <span className="soc-g-num">{nf.format(metrics.bookings)}</span>
            </GCard>
            {city && (
              <CityCardG
                city={city}
                nearby={geo.filter((g) => cityKey(g) !== city.key && angleBetween(g, city) < NEARBY_RAD)}
                selected={selected}
                onToggle={toggle}
                onClose={closeCity}
                cardRef={cardRef}
              />
            )}
          </div>
        )}
        <Globe
          geo={geo}
          height={globeHeight}
          focus={focusInGeo ? cityFocus : null}
          onFocus={setCityFocus}
          emptyLabel={selectedName ? `No lead locations for ${selectedName}` : 'No lead locations yet'}
        />
      </div>

      {empty ? (
        <GCard p={24}>
          <GEmpty kind="unconfigured" title="No ad account connected" body="Campaigns arrive automatically once a Meta ad account is connected. Nothing here is added by hand." setupHref={setupHrefFor('meta-ads')} setupHint="Connect a Meta ad account" />
        </GCard>
      ) : (
        <>
          <Rail campaigns={campaigns} selected={selected} onSelect={select} />
          <div className="ap-g-grid">
            <Spend campaigns={campaigns} active={active} metrics={metrics} daily={daily} selected={selected} windowLabel={windowLabel} onToggle={toggle} />
            <Delivery campaigns={campaigns} selected={selected} onToggle={toggle} />
            <GCard p={24} className="ap-g-card" aria-labelledby="ap-g-roas">
              <GSectionHeader id="ap-g-roas" size={22} title="ROAS" caption="Revenue against spend" />
              <div className="ap-g-roas">
                <GRingGauge value={metrics.roas} max={4} reference={1} scaleCaption="0 to 4x" label={`Return on ad spend${metrics.roas === null ? ' unknown' : ` ${metrics.roas.toFixed(2)}x`}`} size={140} />
                <span className="soc-g-cap">Revenue {money(metrics.revenue)} · spend {money(metrics.spend)}</span>
              </div>
            </GCard>
            <div ref={resultsRef} id="ap-results" className="ap-g-results-wrap">
              <GCard p={24} className="ap-g-card" aria-labelledby="ap-g-results">
                <GSectionHeader id="ap-g-results" size={22} title="Results" caption="Cost of each outcome" />
                <div className="ap-g-results">
                  {([
                    ['Cost / lead', money2(metrics.cpl), 'Spend divided by leads'],
                    ['Cost / booking', money2(metrics.costPerBooking), 'Spend divided by booked calls'],
                    ['Cost / result', money2(metrics.costPerResult), "Spend divided by the objective's results"],
                    ['CTR', pct(metrics.ctr), 'Clicks divided by impressions'],
                  ] as const).map(([label, value, title]) => (
                    <div key={label} className="soc-g-readout" title={title}>
                      <span className="soc-g-num">{value ?? '—'}</span>
                      <span className="soc-g-cap">{label}</span>
                    </div>
                  ))}
                </div>
              </GCard>
            </div>
            <AudienceG audience={audience} />
          </div>
        </>
      )}
    </div>
  );
}

function Status({ campaigns, syncedAt, now, filming }: { campaigns: Campaign[]; syncedAt: string | null; now: number; filming: boolean }) {
  const empty = campaigns.length === 0;
  const live = campaigns.filter((c) => c.status === 'active').length;
  const stale = isStale(syncedAt, now);
  const tone = empty || live === 0 ? 'neutral' : stale ? 'warn' : 'ok';
  return (
    <div className="ap-g-status">
      <GTag tone={tone} dot title={syncedAt ? `Last ad-account sync ${syncedAt}${stale ? ' (stale)' : ''}` : 'No ad-account sync yet'}>
        {empty ? 'No ad account connected' : `${live} active · synced ${syncedAt ? relativeAgo(syncedAt, now) : 'never'}`}
      </GTag>
      {empty && <GButton size="sm" href={setupHrefFor('meta-ads')} title="Connect a Meta ad account">Set up</GButton>}
      {filming && !empty && <GTag title="Staged Filming data, not a live ad account">Sample</GTag>}
    </div>
  );
}

function CityCardG({ city, nearby, selected, onToggle, onClose, cardRef }: {
  city: CityBreakdown; nearby: { city: string }[]; selected: string; onToggle: (id: string) => void; onClose: () => void; cardRef: RefObject<HTMLDivElement>;
}) {
  const rate = city.bookingRate === null ? '—' : `${(city.bookingRate * 100).toFixed(1)}%`;
  const share = city.share === null ? '—' : `${(city.share * 100).toFixed(1)}%`;
  const facts: [string, string, string][] = [
    ['Leads', nf.format(city.leads), 'Leads from this city in the current selection'],
    ['Booked', nf.format(city.bookings), 'Booked calls from this city in the current selection'],
    ['Booking rate', rate, 'Booked calls divided by leads'],
    ['Share', share, "This city's share of all leads in the current selection"],
  ];
  return (
    <div ref={cardRef} data-ap-floater role="region" aria-label={`City: ${city.city}, ${city.country}`} className="ap-g-city">
      <GCard p={20}>
        <div className="ap-g-city-head">
          <span>
            <span className="ap-g-city-name">{city.city}</span>
            <span className="soc-g-cap">{city.country}</span>
          </span>
          <GButton variant="icon" size="sm" aria-label="Close city card" title="Close (Esc)" onClick={onClose}><X size={13} strokeWidth={1.75} aria-hidden /></GButton>
        </div>
        <dl className="ap-g-facts">
          {facts.map(([label, value, title]) => (
            <div key={label} title={title}>
              <dt className="soc-g-cap">{label}</dt>
              <dd className="ap-g-fact">{value}</dd>
            </div>
          ))}
        </dl>
        {city.byCampaign.length > 0 && (
          <GList label="By campaign">
            {city.byCampaign.map((r) => (
              <GRow key={r.id} onClick={() => onToggle(r.id)} selected={selected === r.id} title={r.name} meta={`${nf.format(r.leads)} leads · ${nf.format(r.bookings)} booked`} hint={selected === r.id ? 'Show all campaigns' : `Show ${r.name}`} />
            ))}
          </GList>
        )}
        {nearby.length > 0 && <p className="soc-g-cap">Also here: {nearby.map((n) => n.city).join(', ')}</p>}
      </GCard>
    </div>
  );
}

function Rail({ campaigns, selected, onSelect }: { campaigns: Campaign[]; selected: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const ordered = [...campaigns]
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
    .filter((c) => !q || c.id === selected || c.name.toLowerCase().includes(q));
  const options = [
    { value: 'all', label: 'All campaigns' },
    ...ordered.map((c) => ({
      value: c.id,
      title: c.status === 'active' ? c.name : `${c.name} · paused`,
      label: <span className="ap-g-opt"><i data-live={c.status === 'active' || undefined} aria-hidden />{c.name}</span>,
    })),
  ];
  return (
    <div className="ap-g-rail">
      <GSegmented label="Campaigns" size="md" options={options} value={selected} onChange={onSelect} className="ap-g-seg" />
      {campaigns.length > RAIL_FILTER_THRESHOLD && (
        <GSearch size="md" value={filter} onValueChange={setFilter} aria-label="Filter campaigns" placeholder="Filter" className="ap-g-filter" />
      )}
    </div>
  );
}

function Spend({ campaigns, active, metrics, daily, selected, windowLabel, onToggle }: {
  campaigns: Campaign[]; active: Campaign[]; metrics: CampaignMetrics; daily: DailyPoint[]; selected: string; windowLabel: string | null; onToggle: (id: string) => void;
}) {
  const s = week(daily, (d) => d.spend);
  const l = week(daily, (d) => d.leads);
  return (
    <GCard p={24} className="ap-g-card ap-g-spend" aria-labelledby="ap-g-spend">
      <GSectionHeader id="ap-g-spend" size={22} title="Ad spend" caption={windowLabel ?? undefined} />
      <span className="ap-g-big" title="Spend over the selection's window">{money(metrics.spend)}</span>
      {(s || l) && (
        <span className="ap-g-deltas">
          {s && <span className="ap-g-delta"><GDelta cur={s.cur} prev={s.prev} money window="last 7 days against the 7 before" /> <span className="soc-g-cap">spend · 7d</span></span>}
          {l && <span className="ap-g-delta"><GDelta cur={l.cur} prev={l.prev} window="last 7 days against the 7 before" /> <span className="soc-g-cap">leads · 7d</span></span>}
        </span>
      )}
      <GDriverBars
        label="Spend by campaign"
        labelWidth={150}
        rows={campaigns.map((c) => ({
          id: c.id,
          label: c.name,
          value: c.spend,
          display: money(c.spend),
          tone: 'series-1' as const,
          selected: selected === c.id,
          title: selected === c.id ? `${c.name}: ${money(c.spend)}. Show all campaigns` : `${c.name}: ${money(c.spend)}. Show only this campaign`,
          onClick: () => onToggle(c.id),
        }))}
        className={selected !== 'all' && active.length === 1 ? 'ap-g-dimrows' : undefined}
      />
    </GCard>
  );
}

function Delivery({ campaigns, selected, onToggle }: { campaigns: Campaign[]; selected: string; onToggle: (id: string) => void }) {
  const withDaily = useMemo(() => campaigns.filter((c) => (c.daily?.length ?? 0) > 0), [campaigns]);
  const { dates, rows } = useMemo(() => alignDaily(withDaily), [withDaily]);
  const peakAll = rows.flatMap((r) => r.cells).reduce<DailyPoint>((b, d) => (d && d.spend > b.spend ? d : b), { date: '', spend: 0, leads: 0, bookings: 0 });
  return (
    <GCard p={24} className="ap-g-card ap-g-delivery" aria-labelledby="ap-g-delivery">
      <GSectionHeader id="ap-g-delivery" size={22} title="Delivery" caption={dates.length ? `Spend per day · ${dates[0].slice(5)} to ${dates[dates.length - 1].slice(5)}` : 'Spend per day'} />
      {rows.length === 0 ? (
        <GEmpty title="No daily delivery yet" body="Daily delivery arrives with the ad-account sync." />
      ) : (
        <div className="ap-g-rows">
          {rows.map(({ item: c, cells }) => {
            const peak = Math.max(...cells.map((d) => d?.spend ?? 0), 1);
            return (
              <div key={c.id} className="ap-g-drow" data-dim={selected !== 'all' && selected !== c.id ? '' : undefined}>
                <GList>
                  <GRow onClick={() => onToggle(c.id)} selected={selected === c.id} title={c.name} trailing={<span className="soc-g-cap">peak {money(peak)}/d</span>} hint={selected === c.id ? 'Show all campaigns' : `Show ${c.name}`} />
                </GList>
                <GDotMatrix
                  mode="alpha"
                  rows={1}
                  peakInk={false}
                  columns={cells.map((d, i) => ({
                    id: dates[i],
                    label: '',
                    value: d?.spend ?? 0,
                    cells: [d ? d.spend / peak : null],
                    title: d ? `${dates[i]} · ${money(d.spend)} · ${nf.format(d.leads)} lead${d.leads === 1 ? '' : 's'}` : `${dates[i]} · no delivery`,
                  }))}
                  label={`${c.name}: spend per day, ${dates.length} days, peak ${money(peak)} a day`}
                  className="ap-g-matrix"
                />
              </div>
            );
          })}
          {peakAll.date && <p className="soc-g-cap">Peak day {peakAll.date.slice(5)} · {money(peakAll.spend)}. Darker dots spent more of that campaign&apos;s peak.</p>}
        </div>
      )}
    </GCard>
  );
}

function AudienceG({ audience }: { audience: Campaign['audience'] }) {
  const groups: [string, Record<string, number>][] = [['Age', audience.age], ['Gender', audience.gender], ['Placements', audience.placements]];
  return (
    <GCard p={24} className="ap-g-card ap-g-audience" aria-labelledby="ap-g-aud">
      <GSectionHeader id="ap-g-aud" size={22} title="Audience" caption="Share of delivery" />
      <div className="ap-g-aud-rows">
        {groups.map(([title, data]) => {
          const entries = Object.entries(data);
          return (
            <div key={title} className="ap-g-aud">
              <span className="soc-g-sub">{title}</span>
              <GShareBar label={`${title} share`} segments={entries.map(([k, v], i) => ({ id: k, label: k, value: v, title: `${k}: ${v.toFixed(0)}%`, color: `series-${((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6}` as const }))} />
              <span className="ap-g-aud-keys">
                {entries.map(([k, v], i) => (
                  <span key={k} className="ap-g-aud-key"><i style={{ background: `var(--g-series-${(i % 6) + 1})` }} aria-hidden />{k} {v.toFixed(0)}%</span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </GCard>
  );
}
