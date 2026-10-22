'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { GAsk } from '@/components/g';
import type { AgentMessage } from '@/lib/schemas';

/**
 * The AgentSheet's Chat section (glados-ui SPEC S04 F-A6.2): the same real
 * conversation as components/AgentChat.tsx (POST /api/agents/<id>/chat, the
 * agent reads its connectors to answer), on the kit. Behaviour unchanged;
 * the Classic tree keeps AgentChat.
 */
export function SheetChat({ agentId, agentName, initialMessages }: { agentId: string; agentName: string; initialMessages: AgentMessage[] }) {
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`Chat failed (${res.status})`);
      const body = (await res.json()) as { reply: string; messages: AgentMessage[] };
      setMessages(body.messages);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="wg-chat">
      {messages.length === 0 ? (
        <p className="wg-cap">Ask {agentName} anything. It reads its live connectors to answer.</p>
      ) : (
        <ol className="wg-chat-log" aria-label={`Conversation with ${agentName}`}>
          {messages.map((m) =>
            m.role === 'tool' ? (
              <li key={m.id} className="wg-chat-tool">
                <Wrench size={12} strokeWidth={1.6} aria-hidden />
                {m.toolCalls.map((c) => c.name).join(', ') || 'tool'}
              </li>
            ) : (
              <li key={m.id} className="wg-chat-msg" data-role={m.role === 'user' ? 'user' : 'agent'}>
                <span>{m.content}</span>
              </li>
            ),
          )}
        </ol>
      )}
      <GAsk
        value={input}
        onValueChange={setInput}
        onSubmit={send}
        busy={sending}
        error={error}
        minChars={1}
        label={`Message ${agentName}`}
        placeholder={`Message ${agentName}`}
      />
    </div>
  );
}
