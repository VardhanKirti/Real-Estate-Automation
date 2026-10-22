/**
 * /funnel — the pipeline dashboard. Data path: Attio ∪ GHL live when keyed,
 * else the local DB. A blank install renders honest and empty; ?sample=1
 * previews the page on a badged sample set.
 */
import { getDb } from '@/lib/data';
import { attentionQueue, splitFunnelJourneys } from '@/lib/funnel';
import { attioFunnelJourneys } from '@/lib/funnel-live';
import { ghlFunnelJourneys } from '@/lib/funnel-ghl';
import { skyescraperFunnelJourneys } from '@/lib/funnel-skyescraper';
import { mergeTrakyoTouches, trakyoTouches } from '@/lib/funnel-trakyo';
import { attioStatus } from '@/lib/connectors/attio';
import { ghlStatus } from '@/lib/connectors/ghl';
import { trakyoKey, trakyoStatus } from '@/lib/connectors/trakyo';
import { channelAnalytics, type ChannelsCard } from '@/lib/funnel-channels';
import { metaAdsStatus } from '@/lib/connectors/meta-ads';
import { cachedStatus } from '@/lib/connectors';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { FunnelStageSchema, FunnelVentureSchema } from '@/lib/schemas';
import { FunnelDashboard, type DashboardConnector, type DashboardProps } from '@/components/funnel/FunnelDashboard';
import { FunnelDashboardG } from '@/components/funnel/FunnelDashboardG';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import {
  COMPARES,
  GRAINS,
  LANES,
  PERIOD_IDS,
  VIEWS,
  oneOf,
  type Compare,
  type DashboardInitial,
  type Grain,
  type Lane,
  type Period,
  type View,
} from '@/components/funnel/state';
import { sampleFunnelJourneys } from '@/components/funnel/sample';
import { readVentures } from '@/lib/ventures-store';
import { filmingMode } from '@/lib/paths';

export const dynamic = 'force-dynamic';

export default async function FunnelDashboardPage({
  searchParams,
}: {
  searchParams?: {
    venture?: string;
    stage?: string;
    view?: string;
    period?: string;
    grain?: string;
    compare?: string;
    lane?: string;
    lead?: string;
    sample?: string;
  };
}) {
  const ventureParsed = FunnelVentureSchema.safeParse(searchParams?.venture);
  const venture = ventureParsed.success ? ventureParsed.data : undefined;
  const stageParsed = FunnelStageSchema.safeParse(searchParams?.stage);
  const initialStage = stageParsed.success ? stageParsed.data : undefined;
  const initial: DashboardInitial = {
    stage: initialStage,
    view: oneOf<View>(VIEWS, searchParams?.view),
    period: oneOf<Period>(PERIOD_IDS, searchParams?.period),
    grain: oneOf<Grain>(GRAINS, searchParams?.grain),
    compare: oneOf<Compare>(COMPARES, searchParams?.compare),
    lane: oneOf<Lane>(LANES, searchParams?.lane),
    lead: searchParams?.lead || undefined,
  };
  const now = new Date();

  // Every live read at once (perf, SPEC 4.1 a5): the two CRM pulls, Trakyo and the four source
  // chips. Each is a cached real result (lib/swr.ts) or, on a cold server, one real call.
  const [attioLive, ghlLive, skyescraperLive, trakyoEvents, [attio, ghl, trakyo, metaAds]] = await Promise.all([
    attioFunnelJourneys(now),
    ghlFunnelJourneys(now),
    skyescraperFunnelJourneys(now),
    trakyoTouches(),
    Promise.all([
      cachedStatus('attio', attioStatus),
      cachedStatus('ghl', ghlStatus),
      cachedStatus('trakyo', trakyoStatus),
      cachedStatus('meta-ads', metaAdsStatus),
    ]),
  ]);
  const liveJourneys = [...(attioLive?.journeys ?? []), ...(ghlLive?.journeys ?? []), ...(skyescraperLive?.journeys ?? [])];
  const isLive = liveJourneys.length > 0;
  const liveLabel = [
    attioLive && attioLive.journeys.length > 0 ? `Attio ${attioLive.total}` : null,
    ghlLive && ghlLive.journeys.length > 0 ? `GHL ${ghlLive.total}` : null,
    skyescraperLive && skyescraperLive.journeys.length > 0 ? `Skyescraper ${skyescraperLive.total}` : null,
  ]
    .filter(Boolean)
    .join(' + ');

  // Trakyo first touches (F7) replace the synthetic first touch on live and local journeys alike.
  let all = isLive
    ? mergeTrakyoTouches(liveJourneys, trakyoEvents).filter((j) => !venture || j.venture === venture)
    : mergeTrakyoTouches(getDb().funnel.journeys(venture), trakyoEvents);
  let source: { kind: 'live' | 'db' | 'sample'; label: string } = isLive
    ? { kind: 'live', label: liveLabel }
    : { kind: 'db', label: 'local' };
  const emptyDb = !isLive && all.length === 0;
  if (emptyDb && searchParams?.sample === '1') {
    // Opt-in preview on a blank install: a clearly badged sample set. The
    // default stays honest and empty.
    all = sampleFunnelJourneys(now, venture ?? readVentures()[0]?.id ?? 'default');
    source = { kind: 'sample', label: 'sample' };
  }

  const { active, archived } = splitFunnelJourneys(all, now);
  const attention = attentionQueue(active, now);

  // Channel analytics (F7): attribution needs Trakyo, so unkeyed is Not configured, except the
  // badged ?sample=1 preview and Filming, whose journeys carry their own fixture first touches.
  const trakyoSetup = setupHrefFor('trakyo');
  const trakyoKeyed = Boolean(trakyoKey());
  const fixture = source.kind === 'sample' || filmingMode();
  const channels: ChannelsCard =
    trakyoKeyed || fixture
      ? { state: 'ready', sample: fixture, analytics: channelAnalytics([...active, ...archived]), setupHref: trakyoSetup }
      : { state: 'not_configured', setupHref: trakyoSetup };

  const connectors: DashboardConnector[] = [
    { ...pick(attio), count: attioLive?.journeys.length ? attioLive.total : undefined },
    { ...pick(ghl), count: ghlLive?.journeys.length ? ghlLive.total : undefined },
    pick(trakyo),
    pick(metaAds),
    {
      id: 'skyescraper',
      name: 'Skyescraper',
      ok: skyescraperLive != null,
      detail: skyescraperLive ? `${skyescraperLive.total} real leads` : 'SKYESCRAPER_API_TOKEN not set — see .env.local',
      href: '',
      count: skyescraperLive?.journeys.length ? skyescraperLive.total : undefined,
    },
  ];

  // Two trees, one fetch (glados-ui SPEC X5): the new style renders FunnelDashboardG.
  const props: DashboardProps = {
    journeys: active,
    archived,
    nowIso: now.toISOString(),
    source,
    connectors,
    pushNow: attention.pushNow.map((j) => j.id),
    saveNow: attention.saveNow.map((j) => j.id),
    initial,
    sampleOffer: emptyDb && source.kind !== 'sample',
    channels,
    // Filming: the studio route answers a badged empty workspace (app/api/trakyo/links), never a live call.
    trakyo: { configured: trakyoKeyed || filmingMode(), setupHref: trakyoSetup },
  };
  if (treeFor(getAppearance(), '/funnel') === 'glados') return <FunnelDashboardG {...props} />;
  return <FunnelDashboard {...props} />;
}

/** Source chip: connected chips show the detail; down chips link to their connect flow. */
function pick(status: { id: string; name: string; state: string; detail: string }): DashboardConnector {
  return {
    id: status.id,
    name: status.name,
    ok: status.state === 'connected',
    detail: status.detail,
    href: setupHrefFor(status.id),
  };
}
