/**
 * Generic LangGraph ReAct-agent runner — the piece every Skyescraper agent in
 * lib/agents/sky-agents.ts shares: a model, a system prompt, a toolset, and
 * this app's own rolling conversation history (lib/agents/chat.ts already
 * keeps that in SQLite; LangGraph's own checkpointer would just be a second,
 * redundant copy of the same thing, so this runner stays stateless between
 * calls and is handed the full history each time).
 *
 * Model: calls Anthropic directly with ANTHROPIC_API_KEY — the same key
 * these agents' n8n workflows used before (their Anthropic Chat Model node),
 * reused here instead of standing up a second credential. The app's generic
 * chat path (lib/connectors/llm.ts) still goes through the Vercel AI
 * Gateway's own key; these agents simply don't depend on that one.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { LlmMessage, LlmToolCall } from '@/lib/connectors/llm';

const DEFAULT_MODEL = 'claude-sonnet-5-5';

export type SkyAgentResult = { text: string; toolCalls: LlmToolCall[] };

function historyToMessages(system: string, history: LlmMessage[]): BaseMessage[] {
  const messages: BaseMessage[] = [new SystemMessage(system)];
  for (const m of history) {
    // Prior `tool` turns are this app's own activity-feed record, not a
    // replayable LangChain ToolMessage (no matching tool_call_id survives a
    // restart) — same simplification lib/agents/chat.ts already makes for the
    // built-in gateway path: the model sees the assistant's prose that
    // followed a tool call, not the raw tool output, on later turns.
    if (m.role === 'tool') continue;
    if (m.role === 'user') messages.push(new HumanMessage(m.content));
    else if (m.role === 'assistant') messages.push(new AIMessage(m.content));
  }
  return messages;
}

/** Runs one turn of a tool-calling LangGraph agent and returns its final answer plus a flat list of the tool calls it made, in this app's own LlmToolCall shape (so the activity feed and /chats look identical regardless of which agent produced them). */
export async function runSkyAgent(opts: {
  systemPrompt: string;
  tools: StructuredToolInterface[];
  history: LlmMessage[];
  apiKey: string;
  model?: string;
}): Promise<SkyAgentResult> {
  // claude-sonnet-5-5 rejects a non-default temperature outright, so this is
  // left unset rather than tuned down like an older model would allow.
  const model = new ChatAnthropic({ apiKey: opts.apiKey, model: opts.model ?? DEFAULT_MODEL });

  const graph = createReactAgent({ llm: model, tools: opts.tools });
  const inputMessages = historyToMessages(opts.systemPrompt, opts.history);
  const result = await graph.invoke({ messages: inputMessages }, { recursionLimit: 12 });

  // Only the messages THIS turn produced — result.messages includes the
  // replayed history verbatim first, and Claude's native response content is
  // an array of blocks, not a plain string, so a message-shape mistake here
  // previously picked up a stale answer from an earlier turn in the history.
  const newMessages = (result.messages as BaseMessage[]).slice(inputMessages.length);

  const toolCalls: LlmToolCall[] = [];
  let text = '';
  for (const msg of newMessages) {
    if (msg instanceof ToolMessage) {
      const call = toolCalls.find((c) => c.name === msg.name && c.result === undefined);
      const parsed = typeof msg.content === 'string' ? safeParse(msg.content) : msg.content;
      if (call) call.result = parsed;
      else toolCalls.push({ name: msg.name ?? 'tool', args: {}, result: parsed });
    } else if (msg instanceof AIMessage) {
      for (const tc of msg.tool_calls ?? []) {
        toolCalls.push({ name: tc.name, args: tc.args, result: undefined });
      }
      const blockText = contentToText(msg.content);
      if (blockText.trim()) text = blockText;
    }
  }
  return { text: text || '(no response)', toolCalls };
}

/** Claude's native API returns AIMessage.content as an array of blocks
 *  (text / tool_use / thinking / …), not a plain string like most other
 *  chat model wrappers — this reads only the text blocks, in order. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
