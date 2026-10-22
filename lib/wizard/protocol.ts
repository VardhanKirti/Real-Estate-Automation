import { z } from 'zod';
import { BRAND } from '@/lib/brand';

/**
 * The Wizard block — how a reply turns into project state. Claude is asked
 * (see systemAppend) to end any reply that plans or delegates work with a
 * fenced ```wizard block carrying tasks it created, tasks it finished and
 * agents it wants run. The block is parsed here, stripped from the shown
 * text, and never trusted beyond what the schema allows.
 */

const BlockSchema = z.object({
  tasks: z.array(z.object({ title: z.string().min(1), owner: z.string().optional() })).default([]),
  done: z.array(z.string()).default([]),
  run: z.array(z.string()).default([]),
});
export type WizardBlock = z.infer<typeof BlockSchema>;

const FENCE = /```wizard\s*\n([\s\S]*?)```/;

export function parseWizardBlock(reply: string): { text: string; block: WizardBlock } {
  const m = reply.match(FENCE);
  if (!m) return { text: reply.trim(), block: { tasks: [], done: [], run: [] } };
  let block: WizardBlock = { tasks: [], done: [], run: [] };
  try {
    const parsed = BlockSchema.safeParse(JSON.parse(m[1]));
    if (parsed.success) block = parsed.data;
  } catch {
    // malformed block: show the reply, apply nothing
  }
  return { text: reply.replace(FENCE, '').trim(), block };
}

/** Strip the markdown a model slips in anyway (bold/italic/headers/inline code) for plain display. */
export function plainText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

export type RosterEntry = { id: string; name: string; role: string };

/** Resolves an owner string from the block to a roster agent (id or name). */
export function resolveOwner(owner: string | undefined, roster: RosterEntry[]): { ownerId: string | null; ownerName: string } {
  if (!owner) return { ownerId: null, ownerName: 'Wizard' };
  const needle = owner.trim().toLowerCase();
  const hit = roster.find((a) => a.id.toLowerCase() === needle) ?? roster.find((a) => a.name.toLowerCase() === needle);
  return hit ? { ownerId: hit.id, ownerName: hit.name } : { ownerId: null, ownerName: 'Wizard' };
}

export function systemAppend(roster: RosterEntry[]): string {
  const crew = roster.map((a) => `${a.id} = ${a.name} (${a.role})`).join('; ');
  return [
    `You are the Wizard, the super agent of ${BRAND.name}, a personal AI operating system.`,
    'Answer as the system itself: direct, concrete, sentence case, plain text only (no markdown, no bold, no headers, no emojis).',
    'If asked to do something you cannot actually do from this session, say so plainly and name where it can be done. Never pretend an action happened.',
    'This conversation is a project. When you plan or delegate work, finish your reply with a fenced block on its own lines:',
    '```wizard',
    '{"tasks":[{"title":"short task","owner":"agent-id"}],"done":["title of a task now finished"],"run":["agent-id"]}',
    '```',
    'Only include keys you need. "run" triggers a real run of that agent; use it only when the user asks for work to happen now.',
    `Agents you can assign (id = name (role)): ${crew || 'none registered'}.`,
  ].join(' ');
}
