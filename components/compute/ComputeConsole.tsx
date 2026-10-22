'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Monitor, RefreshCw } from 'lucide-react';
import type { ComputerRow } from '@/lib/compute/miosa';
import { BRAND } from '@/lib/brand';

/**
 * Compute: the MIOSA computers this account runs, and a live view of one
 * desktop. The desktop link is minted server-side per open (about an hour)
 * and quietly re-minted before it lapses, so the view never drops mid-task.
 */

export type EmbedState = { status: 'idle' | 'loading' | 'ready' | 'error'; url?: string; expiresAt?: number; error?: string };

export const LIVE = new Set(['active', 'running', 'starting']);
export const TRANSITIONAL = ['provisioning', 'creating', 'stopping', 'paused'];
function statusTone(s: string) {
  if (LIVE.has(s)) return 'var(--ok)';
  if (TRANSITIONAL.includes(s)) return 'var(--warn)';
  if (s === 'error') return 'var(--err)';
  return 'var(--text-3)';
}

export function ComputeConsole({ computers }: { computers: ComputerRow[] }) {
  const { selected, setSelected, embed, frameBox, comp, connect, fullscreen } = useComputeEmbed(computers);
  return (
    <ConsoleClassic {...{ computers, selected, setSelected, embed, frameBox, comp, connect, fullscreen }} />
  );
}

/**
 * Selection, the desktop link (GET only, re-minted before it lapses) and full
 * screen, shared by both trees of /compute (GladOS: components/compute/ComputeG.tsx).
 * Nothing here starts, stops or provisions a computer.
 */
export function useComputeEmbed(computers: ComputerRow[]) {
  const firstLive = computers.find((c) => LIVE.has(c.status) && c.desktop) ?? computers[0];
  const [selected, setSelected] = useState<string | null>(firstLive?.id ?? null);
  const [embed, setEmbed] = useState<EmbedState>({ status: 'idle' });
  const frameBox = useRef<HTMLDivElement>(null);
  const comp = computers.find((c) => c.id === selected) ?? null;

  const connect = useCallback(async (id: string) => {
    setEmbed({ status: 'loading' });
    try {
      const r = await fetch(`/api/compute/embed?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then((x) => x.json());
      if (r.ok) setEmbed({ status: 'ready', url: r.url, expiresAt: r.expiresAt });
      else setEmbed({ status: 'error', error: r.error });
    } catch {
      setEmbed({ status: 'error', error: `Could not reach ${BRAND.name}.` });
    }
  }, []);

  useEffect(() => {
    if (comp && LIVE.has(comp.status) && comp.desktop) void connect(comp.id);
    else setEmbed({ status: 'idle' });
  }, [comp, connect]);

  // re-mint the link five minutes before it expires
  useEffect(() => {
    if (embed.status !== 'ready' || !embed.expiresAt || !comp) return;
    const wait = Math.max(30_000, embed.expiresAt - Date.now() - 300_000);
    const t = setTimeout(() => void connect(comp.id), wait);
    return () => clearTimeout(t);
  }, [embed, comp, connect]);

  const fullscreen = () => frameBox.current?.requestFullscreen?.();
  return { selected, setSelected, embed, frameBox, comp, connect, fullscreen };
}

function ConsoleClassic({
  computers, selected, setSelected, embed, frameBox, comp, connect, fullscreen,
}: ReturnType<typeof useComputeEmbed> & { computers: ComputerRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      {/* computers */}
      <aside className="space-y-2">
        <div className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-os-dim">Computers</div>
        {computers.map((c) => (
          <button key={c.id} type="button" onClick={() => setSelected(c.id)}
            className={`w-full rounded-[10px] border p-3 text-left transition-colors ${selected === c.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-[var(--hairline)] bg-os-surface hover:bg-[var(--accent-soft)]'}`}>
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 shrink-0 text-os-muted" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-os-text">{c.name}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-os-muted">
                <i className="h-2 w-2 rounded-full" style={{ background: statusTone(c.status) }} />{c.status}
              </span>
            </div>
            <div className="mt-1.5 text-[11.5px] text-os-muted">
              {[c.size, c.template.replace(/^miosa-/, ''), c.resolution, c.region].filter(Boolean).join(' · ')}
            </div>
          </button>
        ))}
      </aside>

      {/* live desktop */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-os-text">{comp ? comp.name : 'No computer'}</span>
          {comp && <span className="text-[12px] text-os-muted">{embed.status === 'ready' ? 'Live desktop' : embed.status === 'loading' ? 'Connecting…' : LIVE.has(comp.status) ? '' : `Computer is ${comp.status}`}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => comp && connect(comp.id)} disabled={!comp || !LIVE.has(comp.status)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[var(--hairline)] px-3 text-[12px] text-os-text hover:bg-[var(--accent-soft)] disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${embed.status === 'loading' ? 'animate-spin' : ''}`} strokeWidth={2} />Reconnect
            </button>
            <button type="button" onClick={fullscreen} disabled={embed.status !== 'ready'}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[var(--hairline)] px-3 text-[12px] text-os-text hover:bg-[var(--accent-soft)] disabled:opacity-50">
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />Full screen
            </button>
            {embed.status === 'ready' && embed.url && (
              <a href={embed.url} target="_blank" rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[var(--hairline)] px-3 text-[12px] text-os-text hover:bg-[var(--accent-soft)]">
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />New tab
              </a>
            )}
          </span>
        </div>
        <div ref={frameBox} className="relative aspect-video w-full overflow-hidden rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)]">
          {embed.status === 'ready' && embed.url ? (
            <iframe key={embed.url} src={embed.url} title={`${comp?.name ?? 'Computer'} desktop`} className="absolute inset-0 h-full w-full border-0"
              allow="clipboard-read; clipboard-write; fullscreen; autoplay" />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-os-muted">
              {embed.status === 'loading' ? 'Opening the desktop…'
                : embed.status === 'error' ? <span className="text-os-err">{embed.error}</span>
                : !comp ? 'No computer selected.'
                : !comp.desktop ? 'This computer has no desktop.'
                : `This computer is ${comp.status}. Start it from MIOSA to see its desktop here.`}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
