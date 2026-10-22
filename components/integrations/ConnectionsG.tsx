import type { ReactNode } from 'react';
import { GButton, GCard, GSectionHeader, GTag } from '@/components/g';
import { BrandLogo } from '@/lib/brand-logos';
import { connectKeysFor, type CatalogEntry } from '@/lib/integrations-catalog';
import { ConnectFlowG } from './ConnectFlowG';

/**
 * Connections under the GladOS style (SPEC S05 F05.70 to F05.72). A tool card
 * keeps its logo, name, blurb and live state; a connector that does several
 * things lists each capability with its own state and a Configure link, as
 * the Classic card does (one green dot would overstate it). Categories are
 * accordions, all closed on load.
 */

export function ConnectionCardG({ entry, guidance }: { entry: CatalogEntry; guidance?: string }) {
  const caps = entry.capabilities && entry.capabilities.length > 1 ? entry.capabilities : null;
  return (
    // id anchor: SetupLink buttons across the OS deep-link to /integrations#<slug>
    <GCard as="article" p={20} id={entry.slug} className="kg-conn scroll-mt-24" aria-label={entry.name}>
      <div className="kg-conn-head">
        <BrandLogo slug={entry.slug} name={entry.name} size={36} g />
        <div className="kg-conn-text">
          <span className="kg-conn-name" title={entry.name}>
            {entry.name}
          </span>
          <span className="kg-cap kg-trunc" title={entry.tagline}>
            {entry.tagline}
          </span>
        </div>
      </div>
      {caps ? (
        <div className="kg-conn-caps">
          <ul className="kg-caps">
            {caps.map((c) => (
              <li key={c.id} title={c.detail}>
                <span>{c.label}</span>
                <GTag size="xs" tone={c.state === 'connected' ? 'ok' : c.state === 'error' ? 'err' : 'outline'} dot={c.state !== 'not_configured'}>
                  {c.state === 'connected' ? 'Live' : c.state === 'error' ? 'Error' : 'Not set up'}
                </GTag>
              </li>
            ))}
          </ul>
          <GButton variant="sm" href={entry.configHref ?? '/integrations'}>
            Configure
          </GButton>
        </div>
      ) : (
        <ConnectFlowG slug={entry.slug} name={entry.name} connected={entry.connected} keySaved={entry.keySaved} keys={connectKeysFor(entry)} guidance={guidance} />
      )}
    </GCard>
  );
}

export function ConnSection({ id, title, caption, children }: { id: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="kg-section" aria-labelledby={id}>
      <GSectionHeader size={22} id={id} title={title} caption={caption} />
      {children}
    </section>
  );
}
