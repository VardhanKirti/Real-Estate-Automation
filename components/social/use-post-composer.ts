'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import type { SocialPost } from '@/lib/schemas';

/**
 * The publish composer and queue, shared by both UI styles (glados-ui SPEC X5:
 * the trees fork presentation only). Classic PostComposer and the GladOS
 * PostComposerG render this one state machine: compose, queue (POST), and
 * remove with a 5 s Undo before the DELETE goes out (H40, C16, C40).
 */

// Kept in sync with SocialPlatformSchema; defined here so client components
// never import server-only lib code.
export const COMPOSER_PLATFORMS: { id: SocialPost['platforms'][number]; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'twitter', label: 'Twitter / X' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'linkedin', label: 'LinkedIn' },
];

/** Undo window for a queue removal (SPEC C16, C40): the DELETE only goes out
    once it passes. */
export const QUEUE_UNDO_MS = 5000;

type PendingRemoval = { timer: ReturnType<typeof setTimeout>; post: SocialPost; index: number };

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function usePostComposer(initialPosts: SocialPost[], initialPlatforms: string[] = ['instagram', 'tiktok']) {
  const router = useRouter();
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);
  const [caption, setCaption] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialPlatforms));
  const [mediaUrl, setMediaUrl] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const pending = useRef(new Map<string, PendingRemoval>());

  function restore(entry: PendingRemoval) {
    setPosts((prev) => {
      if (prev.some((p) => p.id === entry.post.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.post);
      return next;
    });
  }

  async function commitRemoval(entry: PendingRemoval) {
    try {
      const res = await fetch(`/api/social/posts?id=${encodeURIComponent(entry.post.id)}`, {
        method: 'DELETE',
        keepalive: true,
      });
      if (res.status === 409) {
        restore(entry);
        toast({ text: 'Already publishing, so it stays in the queue', tone: 'err' });
      } else if (!res.ok && res.status !== 404) {
        restore(entry);
        toast({ text: `Could not remove the post (HTTP ${res.status})`, tone: 'err' });
      } else {
        router.refresh(); // the page's "N queued" count
      }
    } catch {
      restore(entry);
      toast({ text: 'Could not remove the post', tone: 'err' });
    }
  }

  // Optimistic remove with Undo (H40): the row goes now, the DELETE waits out
  // the Undo window, Undo puts the row back where it was.
  function remove(post: SocialPost) {
    const index = posts.findIndex((p) => p.id === post.id);
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    const timer = setTimeout(() => {
      const entry = pending.current.get(post.id);
      if (!entry) return;
      pending.current.delete(post.id);
      void commitRemoval(entry);
    }, QUEUE_UNDO_MS);
    pending.current.set(post.id, { timer, post, index: Math.max(0, index) });
    toast({
      text: 'Removed from the queue',
      tone: 'info',
      ms: QUEUE_UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const entry = pending.current.get(post.id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.current.delete(post.id);
          restore(entry);
        },
      },
    });
  }

  // Leaving the page inside the Undo window still withdraws the post.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const [id, entry] of map) {
        clearTimeout(entry.timer);
        void fetch(`/api/social/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
      map.clear();
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (!caption.trim()) return setError('Add a caption first.');
    if (selected.size === 0) return setError('Pick at least one platform.');
    setBusy(true);
    try {
      const res = await fetch('/api/social/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          platforms: [...selected],
          mediaUrl: mediaUrl.trim() || null,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { post: SocialPost };
      setPosts((prev) => [body.post, ...prev]);
      setCaption('');
      setMediaUrl('');
      setScheduledFor('');
      router.refresh(); // refresh the Social agent's queue count elsewhere
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const queued = posts.filter((p) => p.status === 'queued');

  return {
    caption, setCaption, selected, toggle, mediaUrl, setMediaUrl, scheduledFor, setScheduledFor,
    busy, error, submit, queued, remove,
  };
}
