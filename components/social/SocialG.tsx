'use client';

/**
 * /social under the GladOS style (glados-ui SPEC S03 §4.1, §5.2; X5). Same
 * data as the Classic tree (the server page fetches once), every widget a G
 * kit part. Brody's complaint, fixed here: no glows (kit cards are borderless
 * with one soft shadow), one font (Geist, no mono), one spacing scale (kit
 * tokens), and less clutter: the total audience shows once, one range
 * control drives every figure, no handles or share bars on the account cards,
 * no recency dots, one list for recent posts.
 */

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Instagram, Linkedin, Mail, Music2, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import {
  GButton, GCard, GDelta, GDonut, GEmpty, GHeroCard, GList, GPage, GRow, GSampleBadge, GSectionHeader, GSegmented, GShareBar, GStat, GTag, GTickStrip,
  type DonutSlice,
} from '@/components/g';
import type { SocialStatusPill } from '@/lib/social-status';
import type { DmThread } from '@/lib/social';
import type { PostDay } from '@/lib/posting-activity';
import type { SocialPost } from '@/lib/schemas';
import { channelsNetChange, netChange, seriesWindow, type RangePoint, type SocialRange } from '@/lib/social-range';
import { formatFull } from '@/lib/format-number';
import { fmtPct, parseRange, RANGE_OPTIONS, rangeParam, rangePhrase, stripValues } from '@/lib/social-view';
import { channelVizColor } from './channel';
import { SocialChartsG } from './SocialChartsG';
import { SeriesSheetG } from './SeriesSheetG';
import { DmInboxSheetG } from './DmInboxG';
import { PostComposerG } from './PostComposerG';
import { ContentCrewG } from './ContentCrew';
import type { ContentCrew } from '@/lib/social-crew';

export type SocialAccountG = {
  platform: string;
  label: string;
  href: string;
  followers: number | null;
  /** 7-day change from lib/social-range (null without history). */
  cur: number | null;
  prev: number | null;
};

export type SocialRecentG =
  | { kind: 'live'; posts: { key: string; platform: string; ago: string; caption: string; status: string; url: string | null }[] }
  | { kind: 'sample'; posts: { tag: string; ago: string; caption: string; kind: string; views: number; likes: number; ratio: string }[]; avg: string }
  | { kind: 'empty'; setupHref: string | null; hint: string };

export type SocialGProps = {
  pill: SocialStatusPill;
  accounts: SocialAccountG[];
  /** Platforms the composer offers that have no connected account. */
  unconnected: { platform: string; label: string }[];
  zernioSetupHref: string;
  total: number;
  /** Each audience channel's history (platforms + email). */
  channels: { key: string; label: string; points: RangePoint[] }[];
  /** The summed audience line. */
  audience: RangePoint[];
  dmPoints: RangePoint[];
  totalDms: number;
  dmThreads: DmThread[];
  nowMs: number;
  postDays: PostDay[];
  today: string;
  recent: SocialRecentG;
  posts: SocialPost[];
  queuedCount: number;
  /** F12: the Growth agents card in the right column beside Recent posts */
  crew: ContentCrew;
};

const ICONS: Record<string, LucideIcon> = { instagram: Instagram, tiktok: Music2, twitter: Twitter, youtube: Youtube, linkedin: Linkedin, email: Mail };


const toneOf = (t: SocialStatusPill['tone']) => (t === 'off' ? 'neutral' : t);

export function SocialG(props: SocialGProps) {
  const { pill, accounts, unconnected, zernioSetupHref, total, channels, audience, dmPoints, totalDms, dmThreads, nowMs, postDays, today, recent, posts, queuedCount, crew } = props;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [range, setRangeState] = useState<SocialRange>(() => parseRange(search?.get('range')));
  const [sheet, setSheet] = useState<'audience' | 'dms' | 'inbox' | null>(null);

  // One range for the page (F5): the hero sub-line and strip, the DM delta and both charts.
  const setRange = useCallback(
    (v: string) => {
      const r = parseRange(v);
      setRangeState(r);
      const q = new URLSearchParams(search?.toString() ?? '');
      q.set('range', rangeParam(r));
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const channelPoints = useMemo(() => channels.map((c) => c.points), [channels]);
  const growth = useMemo(() => channelsNetChange(channelPoints, range, today), [channelPoints, range, today]);
  const strip = useMemo(() => stripValues(audience, range, today), [audience, range, today]);
  const dm = useMemo(() => (dmPoints.length ? netChange(dmPoints, seriesWindow(range, dmPoints, today)) : null), [dmPoints, range, today]);
  const unreplied = dmThreads.filter((t) => t.unreplied).length;
  const hasEmail = channels.some((c) => c.key === 'email');

  const slices: DonutSlice[] = [
    ...accounts.map((a) => ({ id: a.platform, label: a.label, value: a.followers ?? 0, color: channelVizColor(a.platform) })),
  ];
  const largest = slices.reduce<DonutSlice | null>((m, s) => (!m || s.value > m.value ? s : m), null);
  const share = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');

  return (
    <GPage className="soc-g">
      <GSectionHeader
        size="page"
        title="Social"
        caption="Audience, growth and publishing"
        action={
          <span className="soc-g-status" title={pill.title} data-social-status="">
            <GTag tone={toneOf(pill.tone)} dot>{pill.text}</GTag>
            {pill.setupHref && <GButton size="sm" href={pill.setupHref} title={pill.title}>Set up</GButton>}
          </span>
        }
      />

      {/* Accounts (F2): one card per channel; the total lives in the hero only. */}
      <section className="soc-g-sec" aria-labelledby="soc-g-accounts">
        <GSectionHeader id="soc-g-accounts" size={22} title="Accounts" />
        <div className="soc-g-accounts">
          {accounts.map((a) => {
            const Icon = ICONS[a.platform] ?? Mail;
            return (
              <GCard key={a.platform} href={a.href} p={20} className="soc-g-acct" title={`${a.label}: ${a.followers == null ? 'no count yet' : `${formatFull(a.followers)} ${a.platform === 'email' ? 'subscribers' : 'followers'}`} · open details`}>
                <span className="soc-g-acct-head">
                  <span className="soc-g-icon"><Icon size={14} strokeWidth={1.75} aria-hidden /></span>
                  <span className="soc-g-acct-name">{a.label}</span>
                </span>
                <span className="soc-g-num">{a.followers == null ? '—' : formatFull(a.followers)}</span>
                <span className="soc-g-acct-delta">
                  {a.cur != null && a.prev != null ? <GDelta cur={a.cur} prev={a.prev} window="7 days" /> : <span className="soc-g-cap">no 7d history</span>}
                </span>
              </GCard>
            );
          })}
          {unconnected.map((u) => {
            const Icon = ICONS[u.platform] ?? Mail;
            return (
              <GCard key={u.platform} p={20} className="soc-g-acct soc-g-acct-off">
                <span className="soc-g-acct-head">
                  <span className="soc-g-icon"><Icon size={14} strokeWidth={1.75} aria-hidden /></span>
                  <span className="soc-g-acct-name">{u.label}</span>
                </span>
                <span className="soc-g-num soc-g-num-dim">—</span>
                <span className="soc-g-acct-delta">
                  <span className="soc-g-cap">Not connected</span>
                  <GButton size="sm" href={zernioSetupHref} title={`Connect ${u.label} through Zernio`}>Set up</GButton>
                </span>
              </GCard>
            );
          })}
        </div>
      </section>

      {/* Audience (F3 to F7): one range drives every figure in this section. */}
      <section className="soc-g-sec" aria-labelledby="soc-g-audience">
        <GSectionHeader
          id="soc-g-audience"
          size={22}
          title="Audience"
          action={<GSegmented label="Range" options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={rangeParam(range)} onChange={setRange} />}
        />
        <div className="soc-g-heroes">
          <GHeroCard
            variant="a"
            caption="Total audience"
            value={formatFull(total)}
            label={`Total audience ${formatFull(total)}`}
            title={`Every platform's latest follower count${hasEmail ? ' plus the email list' : ''}. Open the history by channel.`}
            status={growth?.pct != null ? `${fmtPct(growth.pct)} ${rangePhrase(range)}` : `No history ${rangePhrase(range)}`}
            strip={strip.values.length > 1 ? <GTickStrip onHero values={strip.values} titles={strip.titles} label={`Total audience by day, ${rangePhrase(range)}`} /> : undefined}
            onClick={() => setSheet('audience')}
            className="soc-g-hero-a"
          />
          <GHeroCard
            variant="b"
            caption="Instagram DMs"
            value={unreplied}
            label={`${unreplied} Instagram conversations need a reply`}
            title="Conversations whose last message is inbound. Open the inbox to reply."
            status={dmThreads.length === 0 ? 'No conversations yet' : unreplied === 0 ? 'Inbox clear' : `to reply · ${dmThreads.length} conversations`}
            strip={dmThreads.length > 0 ? (
              <GShareBar
                onHero
                label="Conversations by reply state"
                segments={[
                  { id: 'reply', label: 'To reply', value: unreplied, title: `${unreplied} to reply` },
                  { id: 'done', label: 'Replied', value: dmThreads.length - unreplied, title: `${dmThreads.length - unreplied} replied` },
                ]}
              />
            ) : undefined}
            onClick={() => setSheet('inbox')}
          />
          <GCard p={24} className="soc-g-dms" onClick={() => setSheet('dms')} title="DMs across every platform (seeded until a DM source is wired). Open the history." aria-label={`Total DMs ${formatFull(totalDms)}. Open the history.`}>
            <GStat
              value={formatFull(totalDms)}
              label="Total DMs"
              source="DMs across every platform (seeded until a DM source is wired)"
              extra={dm ? <GDelta cur={dm.current} prev={dm.baseline} window={rangePhrase(range)} /> : <span className="soc-g-cap">no history {rangePhrase(range)}</span>}
            />
          </GCard>
        </div>

        <div className="soc-g-charts">
          <SocialChartsG audience={audience} channels={channelPoints} postDays={postDays} range={range} today={today} />
          <GCard p={24} className="soc-g-share" aria-labelledby="soc-g-share">
            <GSectionHeader id="soc-g-share" size={22} title="Share" caption="Of the total audience" />
            <GDonut
              slices={slices}
              size={168}
              formatValue={formatFull}
              centre={largest && total > 0 ? (
                <>
                  <span className="g-donut-big">{share(largest.value)}</span>
                  <span className="g-donut-cap">{largest.label}</span>
                </>
              ) : undefined}
              label="Share of the total audience by channel"
            />
          </GCard>
        </div>
      </section>

      {/* Recent posts (F8): one list, sample rows only in Filming with a Sample badge; the content crew (F12) rides the right column. */}
      <div className="soc-g-split">
      <section className="soc-g-sec" aria-labelledby="soc-g-recent">
        <GSectionHeader
          id="soc-g-recent"
          size={22}
          title="Recent posts"
          caption={recent.kind === 'live' ? `${recent.posts.length} from Zernio` : recent.kind === 'sample' ? `${recent.avg} average likes per view` : undefined}
          action={recent.kind === 'sample' ? <GSampleBadge fixture="Filming mode sample posts, not Zernio history" /> : undefined}
        />
        <GCard p={16} className="soc-g-recent">
          {recent.kind === 'empty' ? (
            recent.setupHref ? (
              <GEmpty kind="unconfigured" title="No published posts from Zernio yet" body="Connect Zernio to list what went out." setupHref={recent.setupHref} setupHint={recent.hint} />
            ) : (
              <GEmpty title="No published posts from Zernio yet" body="Posts the Social agent publishes show here." />
            )
          ) : (
            <GList divided label="Recent posts">
              {recent.kind === 'live'
                ? recent.posts.map((p) => (
                    <GRow
                      key={p.key}
                      title={<span className="soc-g-caption">{p.caption}</span>}
                      meta={`${p.platform}${p.ago ? ` · ${p.ago} ago` : ''}`}
                      trailing={
                        <span className="soc-g-row-trail">
                          <GTag tone={p.status === 'success' ? 'ok' : 'warn'} dot>{p.status}</GTag>
                          {p.url && <GButton size="sm" href={p.url} external title="Open the post">Open</GButton>}
                        </span>
                      }
                    />
                  ))
                : recent.posts.map((p) => (
                    <GRow
                      key={p.caption}
                      title={<span className="soc-g-caption">{p.caption}</span>}
                      meta={`${p.tag} · ${p.ago} ago`}
                      hint={`${formatFull(p.views)} ${p.kind} · ${formatFull(p.likes)} likes · like-to-view ${p.ratio}`}
                      trailing={
                        <span className="soc-g-row-trail soc-g-cap" title={`${formatFull(p.views)} ${p.kind} · ${formatFull(p.likes)} likes · like-to-view ${p.ratio}`}>
                          {formatFull(p.views)} {p.kind} · {p.ratio}
                        </span>
                      }
                    />
                  ))}
            </GList>
          )}
        </GCard>
      </section>
      <ContentCrewG crew={crew} />
      </div>

      {/* Publish (F9) */}
      <section className="soc-g-sec" aria-labelledby="soc-g-publish">
        <GSectionHeader
          id="soc-g-publish"
          size={22}
          title="Publish"
          caption={`${queuedCount} queued`}
          action={<GButton size="sm" href="/agents" title="The Social agent publishes the queue on its next run">Social agent</GButton>}
        />
        <PostComposerG initialPosts={posts} unconnected={unconnected.map((u) => u.platform)} />
      </section>

      <SeriesSheetG open={sheet === 'audience' || sheet === 'dms'} metric={sheet === 'dms' ? 'dms' : 'audience'} range={range} today={today} onClose={() => setSheet(null)} />
      <DmInboxSheetG open={sheet === 'inbox'} threads={dmThreads} nowMs={nowMs} onClose={() => setSheet(null)} />
    </GPage>
  );
}
