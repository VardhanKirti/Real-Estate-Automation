'use client';

import { ExternalLink, Maximize2, Monitor, RefreshCw } from 'lucide-react';
import { GButton, GCard, GEmpty, GList, GProgress, GRow, GSectionHeader, GTag, type GTagTone } from '@/components/g';
import type { ComputerRow } from '@/lib/compute/miosa';
import { LIVE, TRANSITIONAL, useComputeEmbed } from './ComputeConsole';

/**
 * /compute under the GladOS style (SPEC S05 F05.61 to F05.63): the computer
 * list as rows with a status tag, and the live desktop in a card whose header
 * carries Reconnect, Full screen and New tab. The remote desktop iframe is
 * third-party content (exempt from the control guard, §3.2). Read-only: no
 * control here starts, stops or provisions a computer.
 */

function tone(status: string): GTagTone {
  if (LIVE.has(status)) return 'ok';
  if (TRANSITIONAL.includes(status)) return 'warn';
  if (status === 'error') return 'err';
  return 'neutral';
}

export function ComputeG({ computers }: { computers: ComputerRow[] }) {
  const { selected, setSelected, embed, frameBox, comp, connect, fullscreen } = useComputeEmbed(computers);
  const live = Boolean(comp && LIVE.has(comp.status));
  return (
    <div className="kg-compute">
      <GCard as="section" p={20} aria-labelledby="compute-list" className="kg-compute-list">
        <GSectionHeader size={22} id="compute-list" title="Computers" caption={`${computers.length} on this account`} />
        <GList label="Computers">
          {computers.map((c) => (
            <GRow
              key={c.id}
              leading={<Monitor size={16} strokeWidth={1.7} aria-hidden="true" />}
              title={c.name}
              meta={[c.size, c.template.replace(/^miosa-/, ''), c.resolution, c.region].filter(Boolean).join(' · ')}
              trailing={
                <GTag tone={tone(c.status)} dot size="xs">
                  {c.status}
                </GTag>
              }
              selected={selected === c.id}
              onClick={() => setSelected(c.id)}
              hint={`Show ${c.name}'s desktop`}
            />
          ))}
        </GList>
      </GCard>

      <GCard as="section" p={20} aria-labelledby="compute-desk" className="kg-compute-desk">
        <GSectionHeader
          size={22}
          id="compute-desk"
          title={comp ? comp.name : 'No computer'}
          caption={
            !comp
              ? 'Pick a computer to see its desktop.'
              : embed.status === 'ready'
                ? 'Live desktop'
                : embed.status === 'loading'
                  ? 'Connecting…'
                  : live
                    ? 'Desktop not open'
                    : `Computer is ${comp.status}`
          }
          action={
            <span className="kg-actions">
              <GButton variant="sm" onClick={() => comp && connect(comp.id)} busy={embed.status === 'loading'} disabled={!live} disabledReason="The computer is not running">
                <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" /> Reconnect
              </GButton>
              <GButton variant="sm" onClick={fullscreen} disabled={embed.status !== 'ready'} disabledReason="Open the desktop first">
                <Maximize2 size={13} strokeWidth={1.8} aria-hidden="true" /> Full screen
              </GButton>
              {embed.status === 'ready' && embed.url && (
                <GButton variant="sm" href={embed.url} external>
                  <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" /> New tab
                </GButton>
              )}
            </span>
          }
        />
        <div ref={frameBox} className="kg-desk">
          {embed.status === 'ready' && embed.url ? (
            <iframe
              key={embed.url}
              src={embed.url}
              title={`${comp?.name ?? 'Computer'} desktop`}
              className="kg-desk-frame"
              data-g-exempt="third-party remote desktop"
              allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            />
          ) : embed.status === 'loading' ? (
            <GProgress text="Opening the desktop…" />
          ) : embed.status === 'error' ? (
            <GEmpty kind="error" inline title="The desktop did not open" body={embed.error} onRetry={comp ? () => connect(comp.id) : undefined} />
          ) : (
            <GEmpty
              inline
              title={!comp ? 'No computer selected' : !comp.desktop ? 'This computer has no desktop' : `This computer is ${comp.status}`}
              body={comp && comp.desktop && !live ? 'Start it from MIOSA to see its desktop here.' : undefined}
            />
          )}
        </div>
      </GCard>
    </div>
  );
}
