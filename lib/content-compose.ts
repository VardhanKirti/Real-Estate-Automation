'use client';

import type { TaskSpec } from '@/lib/content-schema';

/**
 * The compose bus — how any surface on /content opens the Composer without
 * importing it. The Production feed's "Reuse settings", the Library's
 * "Vary", and the Create grid all dispatch the same window event; the
 * mounted Composer listens and opens pre-filled.
 */

export const COMPOSE_EVENT = 'glados:compose';

export type ComposeRequest = {
  /** Which create tool to open (image, video, thumbnail, avatar, clips, enhance, speak, ads). */
  toolKey?: string;
  /** Pre-fill from an existing task's spec — the reuse/vary/upscale loop. */
  spec?: Partial<TaskSpec>;
  title?: string;
  campaignId?: string;
};

export function requestCompose(detail: ComposeRequest): void {
  window.dispatchEvent(new CustomEvent<ComposeRequest>(COMPOSE_EVENT, { detail }));
}

export function onComposeRequest(handler: (detail: ComposeRequest) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ComposeRequest>).detail);
  window.addEventListener(COMPOSE_EVENT, listener);
  return () => window.removeEventListener(COMPOSE_EVENT, listener);
}
