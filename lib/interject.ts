/**
 * The Home interject composer's router (pages/feature-additions.md F2, ported
 * in spirit from FounderOS `pages/console/interject.go`). Rule-based, no LLM:
 *
 *   "tell <agent> …" / "ask <agent> …" / "@<agent> …"  → relay: a task assigned to that agent
 *   "note …" / "note: …" / "remember …"                 → note: captured to the Optimal Engine inbox
 *   anything else ("todo …" optional)                   → task: one of the operator's own tasks
 *
 * An agent is matched by id or by name (case-insensitive, longest name
 * first, so "Daily Briefing" wins over "Daily"). An unknown agent after
 * "tell" falls back to a plain task rather than guessing.
 */
export type InterjectAgent = { id: string; name: string };

export type InterjectRoute =
  | { kind: 'task'; title: string; detail: string }
  | { kind: 'relay'; agentId: string; agentName: string; title: string; detail: string }
  | { kind: 'note'; text: string };

const TITLE_MAX = 120;

function titleOf(text: string): { title: string; detail: string } {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_MAX) return { title: flat, detail: text.trim() === flat ? '' : text.trim() };
  return { title: `${flat.slice(0, TITLE_MAX - 1)}…`, detail: text.trim() };
}

export function routeInterject(raw: string, agents: InterjectAgent[]): InterjectRoute | null {
  const text = raw.trim();
  if (!text) return null;

  const note = text.match(/^(?:note|remember)\s*:?\s+([\s\S]+)$/i);
  if (note) return { kind: 'note', text: note[1].trim() };

  const relay = text.match(/^(?:(?:tell|ask)\s+|@)([\s\S]+)$/i);
  if (relay) {
    const rest = relay[1];
    const lower = rest.toLowerCase();
    const candidates = agents
      .flatMap((a) => [a.name, a.id].map((label) => ({ a, label: label.toLowerCase() })))
      .sort((x, y) => y.label.length - x.label.length);
    for (const { a, label } of candidates) {
      if (!label || !lower.startsWith(label)) continue;
      const after = rest.slice(label.length);
      if (after && !/^[\s,:;.-]/.test(after)) continue; // "Daily" must not match "Dailyx"
      const body = after.replace(/^[\s,:;.-]+(?:to\s+)?/i, '').trim();
      if (!body) return null;
      return { kind: 'relay', agentId: a.id, agentName: a.name, ...titleOf(body) };
    }
  }

  const todo = text.match(/^(?:todo|task)\s*:?\s+([\s\S]+)$/i);
  return { kind: 'task', ...titleOf(todo ? todo[1] : text) };
}

/** How long Undo stays offered after an interject (the toast's window). */
export const INTERJECT_UNDO_MS = 10_000;
