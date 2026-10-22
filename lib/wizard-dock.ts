/**
 * The Wizard dock's public API (docs/projects/glados-ui/SPEC.md GP2).
 *
 * Pages never touch dock internals: they call `openWizard({ text, broadcast })`
 * and the dock (components/ConductorPanel.tsx) opens, puts the text in its
 * composer without sending, sets the "Send to every agent" chip and focuses
 * the composer at the end of the text. Works in both UI styles: the dock is shell.
 *
 * The pure helpers below are unit-tested in the node env (tests/wizard-dock.test.ts).
 */

/** Window event the dock listens for. `detail` is a WizardOpenDetail. */
export const WIZARD_OPEN_EVENT = 'wizard:open';

export type WizardOpenDetail = {
  /** Text to place in the composer. Never sent on its own. */
  text?: string;
  /** Set the broadcast chip (send to every agent). Omitted leaves the chip as it is. */
  broadcast?: boolean;
  /** Who asked (for example "agents-ask"), for debugging only. */
  source?: string;
};

/** Open the dock with an optional prefill. A no-op on the server. */
export function openWizard(detail: WizardOpenDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WizardOpenDetail>(WIZARD_OPEN_EVENT, { detail }));
}

/**
 * The composer text after a prefill (FR-GP2.4): an existing draft is kept and
 * the incoming text goes on a new line; an empty draft takes the text as is.
 * Incoming text that is blank leaves the draft unchanged. A single-line
 * composer cannot hold a line break (the browser strips it from an input's
 * value), so it passes `join = ' '`.
 */
export function mergeDraft(draft: string, incoming: string | undefined, join = '\n'): string {
  const add = (incoming ?? '').trim();
  if (!add) return draft;
  if (!draft.trim()) return add;
  return `${draft.replace(/\s+$/, '')}${join}${add}`;
}

/** The broadcast chip after a prefill: an explicit flag wins, otherwise it keeps its state. */
export function nextBroadcast(current: boolean, incoming: boolean | undefined): boolean {
  return typeof incoming === 'boolean' ? incoming : current;
}

/** Where a send goes (FR-GP2.2): the conductor routes to one agent; broadcast asks every agent. */
export function sendEndpoint(broadcast: boolean): '/api/agents/broadcast' | '/api/agents/conductor/chat' {
  return broadcast ? '/api/agents/broadcast' : '/api/agents/conductor/chat';
}

/** One agent's answer to a broadcast, as the dock renders it. */
export type BroadcastReplyView = { agentId: string; ok: boolean; reply: string };

/**
 * Group broadcast replies by agent (FR-GP2.2: "replies render grouped by
 * agent"), keeping first-seen order and dropping malformed rows.
 */
export function groupBroadcastReplies(replies: unknown): { agentId: string; replies: BroadcastReplyView[] }[] {
  if (!Array.isArray(replies)) return [];
  const groups = new Map<string, BroadcastReplyView[]>();
  for (const r of replies) {
    if (!r || typeof r !== 'object') continue;
    const { agentId, ok, reply } = r as Record<string, unknown>;
    if (typeof agentId !== 'string' || !agentId) continue;
    const row: BroadcastReplyView = { agentId, ok: ok === true, reply: typeof reply === 'string' ? reply : '' };
    const list = groups.get(agentId);
    if (list) list.push(row);
    else groups.set(agentId, [row]);
  }
  return [...groups.entries()].map(([agentId, list]) => ({ agentId, replies: list }));
}
