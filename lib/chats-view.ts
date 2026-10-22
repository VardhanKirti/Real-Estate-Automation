/**
 * The /chats view model (pages/chats.md §2), built once on the server and handed to
 * whichever tree renders (GladOS, Classic, and later Bennett Legacy) as plain props.
 * GET /api/chats and GET /api/chats/[agentId] answer from the same builders, so the
 * page and its API never disagree.
 *
 * Sources: `agent_messages` (one thread per agent), the Wizard project store
 * (lib/wizard/store) for the pinned Wizard row, `db.agents` for the roster, the
 * model key the agent chat already uses (lib/connectors/llm, key read only).
 * Sample (`?sample=1` on a blank install) and Filming read the fixture in
 * lib/fo-sample.ts and the composer is off: nothing is sent and no request
 * leaves the box. Nothing here calls a model.
 */
import type { getDb } from '@/lib/data';
import type { AgentMessage } from '@/lib/schemas';
import { WIZARD_ID, chatThreads, threadPage, type ChatThread, type RosterAgent } from '@/lib/chats';
import { foMode, sampleChatMessages, type FoMode } from '@/lib/fo-sample';
import { llmStatus } from '@/lib/connectors/llm';
import { SKY_AGENTS, skyAgentConfigured } from '@/lib/agents/sky-agents';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { agentAvatars } from '@/lib/agent-avatars';
import { readProjects, type WizardProject } from '@/lib/wizard/store';

type Db = ReturnType<typeof getDb>;

export { WIZARD_ID };

/** One line in a thread, as every tree renders it. */
export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool names on a `tool` line. */
  tools: string[];
  createdAt: string;
};

export type ChatRailRow = ChatThread & { avatar: string | null };
export type ChatRosterRow = RosterAgent & { avatar: string | null };

export type ChatThreadView = {
  agentId: string;
  name: string;
  role: string;
  avatar: string | null;
  messages: ChatMsg[];
  hasMore: boolean;
  /** The Wizard row reads the latest Wizard project; every other thread reads agent_messages. */
  source: 'agent' | 'wizard';
  /** The Wizard project the pinned thread shows, when there is one. */
  projectName: string | null;
};

export type ComposerState = {
  enabled: boolean;
  /** Why it is off: no model key, or a Sample/Filming preview. */
  reason: 'not_configured' | 'sample' | null;
};

export type ChatsView = {
  /** Server clock for relative times (the client takes over after mount). */
  now: number;
  mode: FoMode;
  sample: boolean;
  threads: ChatRailRow[];
  /** "New chat": agents without a thread. */
  roster: ChatRosterRow[];
  /** Every agent in the roster, so a provisional thread can name its agent. */
  agentCount: number;
  model: { state: 'configured' | 'not_configured'; setupHref: string };
  composer: ComposerState;
  /** The thread open on first paint (`?agent=`, else the Wizard). */
  selected: string;
  open: ChatThreadView | null;
};

const toMsg = (m: Pick<AgentMessage, 'id' | 'role' | 'content' | 'createdAt'> & { toolCalls?: AgentMessage['toolCalls'] }): ChatMsg => ({
  id: m.id,
  role: m.role,
  content: m.content,
  tools: (m.toolCalls ?? []).map((c) => c.name),
  createdAt: m.createdAt,
});

/** The newest Wizard project that has a conversation, if any. */
function latestWizardProject(): WizardProject | null {
  try {
    return readProjects().find((p) => p.messages.length > 0) ?? null;
  } catch {
    return null;
  }
}

const wizardMsgs = (p: WizardProject): ChatMsg[] =>
  p.messages.map((m, i) => ({ id: `${p.id}:${i}`, role: m.role === 'user' ? 'user' : 'assistant', content: m.text, tools: [], createdAt: m.at }));

function roster(db: Db): RosterAgent[] {
  return db.agents.all().map((a) => ({ id: a.id, name: a.name, description: a.role || a.description, departmentId: a.departmentId }));
}

type Source = { live: boolean; recent: Pick<AgentMessage, 'id' | 'agentId' | 'role' | 'content' | 'createdAt'>[] };

/** Which messages a view reads: the store, or the fixture in Sample (and in Filming when the demo database has no threads). */
function source(mode: FoMode, recent: AgentMessage[]): Source {
  const fixture = mode === 'sample' || (mode === 'filming' && recent.length === 0);
  if (!fixture) return { live: true, recent };
  return { live: false, recent: [...sampleChatMessages()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

function modeFor(db: Db, url: string): { mode: FoMode; recent: AgentMessage[] } {
  const recent = db.agentMessages.recent(5000);
  return { mode: foMode(url, recent.length === 0 && !latestWizardProject()), recent };
}

/** One thread, oldest first, a page at a time. `null` for an agent that is neither in the roster nor the Wizard. */
export function buildThread(db: Db, agentId: string, url: string, opts: { before?: string | null; limit?: number } = {}): (ChatThreadView & { mode: FoMode; sample: boolean }) | null {
  const agents = roster(db);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent && agentId !== WIZARD_ID) return null;
  const { mode, recent } = modeFor(db, url);
  const src = source(mode, recent);
  const avatar = agentAvatars().get(agentId) ?? null;
  let all: ChatMsg[];
  let projectName: string | null = null;
  const kind: ChatThreadView['source'] = agentId === WIZARD_ID ? 'wizard' : 'agent';
  const project = src.live && agentId === WIZARD_ID ? latestWizardProject() : null;
  if (project) {
    all = wizardMsgs(project);
    projectName = project.name;
  } else if (src.live) {
    all = db.agentMessages.byAgent(agentId).map(toMsg);
  } else {
    all = src.recent
      .filter((m) => m.agentId === agentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => toMsg(m));
  }
  const page = threadPage(all, opts);
  return {
    agentId,
    name: agentId === WIZARD_ID ? 'Wizard' : agent!.name,
    role: agentId === WIZARD_ID ? 'Your conductor' : (agent!.description ?? ''),
    avatar,
    messages: page.messages,
    hasMore: page.hasMore,
    source: kind,
    projectName,
    mode,
    sample: mode !== 'live',
  };
}

const strip = (t: ReturnType<typeof buildThread>): ChatThreadView | null => {
  if (!t) return null;
  const { mode: _m, sample: _s, ...view } = t;
  return view;
};

/** The rail, the roster, the model state and the first open thread. */
export async function buildChatsView(db: Db, url: string, opts: { agent?: string | null; now?: number } = {}): Promise<ChatsView> {
  const { mode, recent } = modeFor(db, url);
  const src = source(mode, recent);
  const agents = roster(db);
  const avatars = agentAvatars();
  const { threads, newChat } = chatThreads(src.recent, agents);
  // The pinned row summarises the Wizard project store (pages/chats.md §2) when it has a conversation.
  const project = src.live ? latestWizardProject() : null;
  if (project) {
    const last = project.messages[project.messages.length - 1];
    const flat = last.text.replace(/\s+/g, ' ').trim();
    threads[0] = {
      ...threads[0],
      lastMessage: flat.length > 120 ? `${flat.slice(0, 119)}…` : flat,
      lastAt: last.at,
      lastRole: last.role === 'user' ? 'user' : 'assistant',
      messageCount: project.messages.length,
    };
  }
  const llm = await llmStatus(); // reads the key only; no request
  const configured = llm.state === 'connected';
  const sample = mode !== 'live';
  const wanted = opts.agent && (opts.agent === WIZARD_ID || agents.some((a) => a.id === opts.agent)) ? opts.agent : WIZARD_ID;
  // A Skyescraper agent (Lead Management etc.) runs its own LangGraph loop
  // (lib/agents/sky-agents.ts) straight against Anthropic, not the generic
  // AI Gateway check above — it has its own two credentials (Skyescraper +
  // Anthropic), so its composer readiness is checked separately here.
  const selectedIsSkyAgent = wanted !== WIZARD_ID && Boolean(SKY_AGENTS[wanted]);
  const composerReady = configured || (selectedIsSkyAgent && skyAgentConfigured());
  return {
    now: opts.now ?? Date.now(),
    mode,
    sample,
    threads: threads.map((t) => ({ ...t, avatar: avatars.get(t.agentId) ?? null })),
    roster: newChat.map((a) => ({ ...a, avatar: avatars.get(a.id) ?? null })),
    agentCount: agents.filter((a) => a.id !== WIZARD_ID).length,
    model: { state: configured ? 'configured' : 'not_configured', setupHref: setupHrefFor('llm') },
    composer: sample ? { enabled: false, reason: 'sample' } : composerReady ? { enabled: true, reason: null } : { enabled: false, reason: 'not_configured' },
    selected: wanted,
    open: strip(buildThread(db, wanted, url)),
  };
}
