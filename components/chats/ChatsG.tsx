'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Plus, Wand2, Wrench } from 'lucide-react';
import { GAsk, GButton, GCard, GCardRaised, GEmpty, GErrorLine, GList, GProgress, GRow, GSampleBadge, GSearch, GSectionHeader, GSkeleton, GTag, GPage, GWell } from '@/components/g';
import { AgentFace } from '@/components/agents/AgentFace';
import { relativeTime } from '@/lib/wizard/helpers';
import type { ChatsView } from '@/lib/chats-view';
import { useChats, WIZARD, type ChatsState } from './useChats';

/**
 * /chats, GladOS tree (founderos-ui pages/chats.md §6): one GCard shell with
 * the conversation rail (Wizard pinned, then one thread per agent) and the
 * open thread. Kit primitives only; state lives in useChats, shared with the
 * Classic tree.
 */
export function ChatsG({ view, initialView }: { view: ChatsView; initialView: 'rail' | 'thread' }) {
  const c = useChats(view, { initialView });
  const startNew = () => {
    c.setPicking(true);
    c.back();
    if (c.collapsed) c.toggleRail();
  };
  return (
    <GPage className="ch-g-page">
      <GSectionHeader
        size="page"
        title="Chats"
        caption="Every conversation with your agents"
        action={
          <div className="ch-g-head-actions">
            {view.sample && <GSampleBadge fixture={view.mode === 'filming' ? 'Filming threads' : 'Sample threads (?sample=1)'} />}
            <GButton variant="ink" onClick={startNew} aria-expanded={c.picking}>
              <Plus size={14} strokeWidth={1.75} aria-hidden /> New chat
            </GButton>
          </div>
        }
      />
      <GCard p={16} className="ch-g-shell">
        <div className="ch-g-grid" data-view={c.mobileView} data-collapsed={c.collapsed || undefined}>
          <Rail c={c} />
          <RailStrip c={c} />
          <Thread c={c} />
        </div>
      </GCard>
    </GPage>
  );
}

function Face({ id, src, name, size }: { id: string; src: string | null; name: string; size: number }) {
  if (id === WIZARD) {
    return (
      <span className="wg-face ch-g-wizface" style={{ width: size, height: size }} aria-hidden>
        <Wand2 size={Math.round(size * 0.5)} strokeWidth={1.6} />
      </span>
    );
  }
  return <AgentFace src={src} name={name} size={size} />;
}

function Rail({ c }: { c: ChatsState }) {
  const empty = c.allThreadsCount <= 1 && !c.search.trim();
  return (
    <GWell className="ch-g-rail">
      <div className="ch-g-rail-head">
        <h2 className="ch-g-rail-title">{c.picking ? 'New chat' : 'Conversations'}</h2>
        {c.picking ? (
          <GButton size="sm" onClick={() => c.setPicking(false)} title="Back to conversations (Esc)">
            Back
          </GButton>
        ) : (
          <GButton variant="icon" size="compact" aria-label="Collapse the conversation list" onClick={c.toggleRail} className="ch-g-wide-only">
            <PanelLeftClose size={15} strokeWidth={1.6} aria-hidden />
          </GButton>
        )}
      </div>
      <GSearch size="md" value={c.search} onValueChange={c.setSearch} placeholder={c.picking ? 'Search agents' : 'Search threads'} aria-label={c.picking ? 'Search agents' : 'Search threads'} />
      <div className="ch-g-rail-list">
        {c.picking ? (
          c.roster.length > 0 ? (
            <GList label="Agents without a thread">
              {c.roster.map((r) => (
                <GRow key={r.id} leading={<Face id={r.id} src={r.avatar} name={r.name} size={28} />} title={r.name} meta={r.description || 'Agent'} onClick={() => c.select(r.id)} />
              ))}
            </GList>
          ) : c.rosterTotal === 0 && c.view.agentCount === 0 ? (
            <div className="ch-g-rail-empty">
              <GEmpty inline title="No agents yet" body="Agents you set up appear here to chat with." />
              <GButton size="sm" href="/agents">
                Open Agents
              </GButton>
            </div>
          ) : (
            <p className="wg-cap ch-g-rail-note">{c.rosterTotal === 0 ? 'Every agent already has a thread.' : 'No agent matches that search.'}</p>
          )
        ) : (
          <>
            <GList label="Conversations">
              {c.threads.map((t) => (
                <GRow
                  key={t.agentId}
                  selected={t.agentId === c.selected}
                  leading={<Face id={t.agentId} src={t.avatar} name={t.name} size={32} />}
                  title={
                    <span className="ch-g-row-title">
                      <span className="ch-g-row-name">{t.name}</span>
                      {t.pinned && (
                        <GTag size="xs" tone="outline">
                          Pinned
                        </GTag>
                      )}
                    </span>
                  }
                  meta={t.lastMessage ?? (t.pinned ? t.role : 'No messages yet')}
                  trailing={t.lastAt ? <span className="ch-g-when">{relativeTime(t.lastAt, c.now)}</span> : undefined}
                  onClick={() => c.select(t.agentId)}
                />
              ))}
            </GList>
            {empty && <p className="wg-cap ch-g-rail-note">No direct chats yet. Start one with New chat.</p>}
            {!empty && c.threads.length === 0 && <p className="wg-cap ch-g-rail-note">No threads match that search.</p>}
          </>
        )}
      </div>
    </GWell>
  );
}

function RailStrip({ c }: { c: ChatsState }) {
  return (
    <GWell className="ch-g-strip">
      <GButton variant="icon" size="compact" aria-label="Show the conversation list" onClick={c.toggleRail}>
        <PanelLeftOpen size={15} strokeWidth={1.6} aria-hidden />
      </GButton>
      <ul className="ch-g-strip-list" aria-label="Conversations">
        {c.threads.map((t) => (
          <li key={t.agentId}>
            <GButton variant="icon" aria-label={`Open ${t.name}`} title={t.name} aria-pressed={t.agentId === c.selected} onClick={() => c.select(t.agentId)} className="ch-g-strip-btn">
              <Face id={t.agentId} src={t.avatar} name={t.name} size={28} />
            </GButton>
          </li>
        ))}
      </ul>
    </GWell>
  );
}

function Thread({ c }: { c: ChatsState }) {
  const h = c.header;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.selected, c.messages.length, c.pending.length, c.routed.length, c.status]);
  const composer = c.view.composer;
  const nothing = c.status === 'ready' && c.messages.length === 0 && c.pending.length === 0 && c.routed.length === 0;

  return (
    <section className="ch-g-thread" aria-label={`Conversation with ${h.name}`}>
      <header className="ch-g-thread-head">
        <GButton variant="icon" size="compact" aria-label="Back to conversations" onClick={c.back} className="ch-g-narrow-only">
          <ArrowLeft size={16} strokeWidth={1.6} aria-hidden />
        </GButton>
        <Face id={h.agentId} src={h.avatar} name={h.name} size={40} />
        <div className="ch-g-thread-id">
          <p className="ch-g-thread-name">
            <span>{h.name}</span>
            {!h.wizard && <GTag size="xs">Direct line</GTag>}
          </p>
          <p className="wg-cap ch-g-thread-role">{h.wizard ? (h.projectName ? `Latest project: ${h.projectName}` : 'Your conductor') : h.role || 'Agent'}</p>
        </div>
        <GButton size="sm" href={h.wizard ? '/wizard' : `/agents?agent=${encodeURIComponent(h.agentId)}`}>
          {h.wizard ? 'Open Wizard' : 'Open agent'}
        </GButton>
      </header>
      <p className="wg-cap ch-g-note">
        {h.wizard ? 'The Wizard hands your message to the agent best placed to answer. The reply also lands in that agent’s thread.' : `Direct line: ${h.name} can read your data here, not change it.`}
      </p>

      <div ref={scroller} className="ch-g-msgs" aria-live="polite">
        {c.status === 'loading' && c.messages.length === 0 && (
          <div className="ch-g-skel" aria-label="Loading the thread">
            <GSkeleton width="46%" height={44} shape="well" />
            <GSkeleton width="62%" height={18} />
            <GSkeleton width="38%" height={18} />
          </div>
        )}
        {c.status === 'error' && <GErrorLine onRetry={c.reload}>{c.error ?? 'Could not load the thread.'}</GErrorLine>}
        {nothing && (
          <GEmpty
            title={h.wizard ? 'No Wizard conversation yet' : `No messages with ${h.name} yet`}
            body={h.wizard ? 'Your latest Wizard project shows here. Ask below and the Wizard routes it.' : 'Ask what it can see. It reads its connectors to answer.'}
          />
        )}
        {c.messages.length > 0 && (
          <ol className="ch-g-log">
            {c.messages.map((m) =>
              m.role === 'tool' ? (
                <li key={m.id} className="ch-g-tool">
                  <Wrench size={12} strokeWidth={1.6} aria-hidden /> Read {m.tools.join(', ') || 'a tool'}
                </li>
              ) : m.role === 'user' ? (
                <li key={m.id} className="ch-g-msg" data-role="user">
                  <GCardRaised p={16} className="ch-g-bubble">
                    <p>{m.content}</p>
                  </GCardRaised>
                  <span className="ch-g-when">{relativeTime(m.createdAt, c.now)}</span>
                </li>
              ) : (
                <li key={m.id} className="ch-g-msg" data-role="agent">
                  <Face id={h.agentId} src={h.avatar} name={h.name} size={24} />
                  <div className="ch-g-agent-text">
                    <p>{m.content}</p>
                    <span className="ch-g-when">{relativeTime(m.createdAt, c.now)}</span>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
        {(c.routed.length > 0 || c.pending.length > 0) && (
          <ol className="ch-g-log">
            {c.routed.map((r) => (
              <li key={r.key} className="ch-g-turn">
                <div className="ch-g-msg" data-role="user" data-new="">
                  <GCardRaised p={16} className="ch-g-bubble">
                    <p>{r.text}</p>
                  </GCardRaised>
                </div>
                <div className="ch-g-msg" data-role="agent" data-new="">
                  <Face id={r.routedTo} src={r.routedAvatar} name={r.routedName} size={24} />
                  <div className="ch-g-agent-text">
                    <p>{r.reply}</p>
                    <span className="ch-g-routed">
                      <span className="ch-g-when">Answered by {r.routedName}</span>
                      <GButton size="sm" onClick={() => c.select(r.routedTo)}>
                        Open thread
                      </GButton>
                    </span>
                  </div>
                </div>
              </li>
            ))}
            {c.pending.map((p) => (
              <li key={p.key} className="ch-g-turn">
                <div className="ch-g-msg" data-role="user" data-new="" data-state={p.state}>
                  <GCardRaised p={16} className="ch-g-bubble">
                    <p>{p.text}</p>
                  </GCardRaised>
                  {p.state === 'sending' && <span className="ch-g-when">Sending</span>}
                </div>
                {p.state === 'sending' ? (
                  <GProgress text="Thinking" className="ch-g-thinking" />
                ) : (
                  <GErrorLine align="left" onRetry={() => c.retry(p.key)}>
                    Not sent. {p.error}
                  </GErrorLine>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="ch-g-compose">
        {composer.reason === 'not_configured' && (
          <div className="ch-g-compose-note">
            <GTag tone="outline" size="xs">
              Not configured
            </GTag>
            <span className="wg-cap">Agent chat needs a model key.</span>
            <GButton size="sm" href={c.view.model.setupHref} title="Add the AI Gateway key the agent chat uses">
              Set up
            </GButton>
          </div>
        )}
        {composer.reason === 'sample' && <p className="wg-cap ch-g-compose-note">Sample threads. Sending is off in this preview.</p>}
        <GAsk
          value={c.draft}
          onValueChange={c.setDraft}
          onSubmit={c.send}
          busy={c.busy}
          minChars={1}
          disabled={!composer.enabled}
          disabledReason={composer.reason === 'sample' ? 'Sending is off in a preview' : 'Agent chat needs a model key'}
          label={`Message ${h.name}`}
          placeholder={`Message ${h.name}…`}
        />
        {composer.enabled && <p className="ch-g-hint">Enter sends</p>}
      </div>
    </section>
  );
}
