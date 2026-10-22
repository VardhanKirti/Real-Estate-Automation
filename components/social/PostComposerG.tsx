'use client';

/**
 * The publish composer and queue under the GladOS style (glados-ui SPEC S03
 * F9). Same state machine as Classic (usePostComposer): compose, queue, and
 * remove with a 5 s Undo. Platforms without a connected account are disabled
 * with the reason in their title.
 */

import { Send, X } from 'lucide-react';
import { GButton, GCard, GChip, GDateTime, GEmpty, GErrorLine, GField, GInput, GList, GRow, GSectionHeader, GTag, GTextarea } from '@/components/g';
import type { SocialPost } from '@/lib/schemas';
import { COMPOSER_PLATFORMS, fmtWhen, usePostComposer } from './use-post-composer';

const LABEL: Record<string, string> = Object.fromEntries(COMPOSER_PLATFORMS.map((p) => [p.id, p.label]));

export function PostComposerG({ initialPosts, unconnected }: { initialPosts: SocialPost[]; unconnected: string[] }) {
  const c = usePostComposer(initialPosts);
  return (
    <div className="soc-g-publish">
      <GCard p={24} className="soc-g-composer">
        <GField label="Caption">
          <GTextarea value={c.caption} onChange={(e) => c.setCaption(e.target.value)} placeholder="Write a caption" rows={3} />
        </GField>
        <div className="soc-g-chips" role="group" aria-label="Platforms">
          {COMPOSER_PLATFORMS.map((p) => {
            const off = unconnected.includes(p.id);
            return (
              <GChip
                key={p.id}
                pressed={!off && c.selected.has(p.id)}
                onPressedChange={() => c.toggle(p.id)}
                disabled={off}
                disabledReason={off ? `${p.label} is not connected` : undefined}
              >
                {p.label}
              </GChip>
            );
          })}
        </div>
        <div className="soc-g-composer-row">
          <GField label="Media URL" className="soc-g-grow">
            <GInput value={c.mediaUrl} onChange={(e) => c.setMediaUrl(e.target.value)} placeholder="Optional" inputMode="url" />
          </GField>
          <GField label="Schedule">
            <GDateTime value={c.scheduledFor} onChange={(e) => c.setScheduledFor(e.target.value)} />
          </GField>
        </div>
        <div className="soc-g-composer-foot">
          <span className="soc-g-cap">Queues only. The Social agent publishes on its next run.</span>
          <GButton variant="ink" onClick={() => void c.submit()} busy={c.busy}>
            <Send size={14} strokeWidth={1.75} aria-hidden /> Queue post
          </GButton>
        </div>
        {c.error && <GErrorLine align="left">{c.error}</GErrorLine>}
      </GCard>

      <GCard p={16} className="soc-g-queue" aria-labelledby="soc-g-queue">
        <GSectionHeader id="soc-g-queue" size={22} title="Queue" caption={`${c.queued.length} pending`} className="soc-g-queue-head" />
        {c.queued.length === 0 ? (
          <GEmpty inline title="Nothing queued yet" />
        ) : (
          <GList divided label="Queued posts">
            {c.queued.map((post) => (
              <GRow
                key={post.id}
                title={<span className="soc-g-caption">{post.caption}</span>}
                meta={post.platforms.map((p) => LABEL[p] ?? p).join(' · ')}
                trailing={
                  <span className="soc-g-row-trail">
                    <GTag tone={post.scheduledFor ? 'warn' : 'accent'}>{post.scheduledFor ? fmtWhen(post.scheduledFor) : 'Queued'}</GTag>
                    <GButton variant="icon" size="sm" aria-label="Remove from queue" title="Remove from queue (Undo for 5 seconds)" onClick={() => c.remove(post)}>
                      <X size={13} strokeWidth={1.75} aria-hidden />
                    </GButton>
                  </span>
                }
              />
            ))}
          </GList>
        )}
      </GCard>
    </div>
  );
}
