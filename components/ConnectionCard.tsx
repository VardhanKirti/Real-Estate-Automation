import Link from 'next/link';
import { BrandLogo } from '@/lib/brand-logos';
import { connectKeysFor, type CatalogEntry } from '@/lib/integrations-catalog';
import { ConnectFlow } from '@/components/ConnectFlow';

/**
 * One integration tile in the connections marketplace: rounded card, brand
 * logo, name + blurb, and a LIVE footer — Connect opens a paste-a-key form
 * that writes .env.local through /api/connections/connect; connected state
 * always comes from the real connector, never the stored key alone.
 *
 * A connector that does several things reports them separately: WhatsApp reads
 * from the local desktop app but cannot send, so the tile lists each capability
 * with its own state and offers Configure for the choices behind it. One green
 * dot for a connector that only half works is exactly the kind of claim the
 * house rule forbids.
 */
export function ConnectionCard({ entry, guidance }: { entry: CatalogEntry; guidance?: string }) {
  // When a connector reports its capabilities, those rows ARE the status —
  // stacking a "Connected" chip and a "Managed" chip on top of them says the
  // same thing three times, and the first two say it wrong.
  const hasCapabilities = !!entry.capabilities && entry.capabilities.length > 1;
  return (
    // id anchor: SetupLink buttons across the OS deep-link to /integrations#<slug>
    <div
      id={entry.slug}
      className="group flex min-h-[112px] scroll-mt-24 flex-col justify-between rounded-lg-t border border-os-border bg-os-surface p-6 transition-colors hover:border-os-border-strong"
    >
      <div className="flex items-start gap-4">
        <BrandLogo slug={entry.slug} name={entry.name} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[14.5px] font-medium leading-tight text-os-text">{entry.name}</div>
          <div className="mt-1 truncate text-[12.5px] leading-tight text-os-dim">{entry.tagline}</div>
        </div>
      </div>

      {hasCapabilities ? (
        <ul className="mt-4 flex flex-col gap-1.5">
          {entry.capabilities!.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[11.5px]" title={c.detail}>
              <span
                className="h-[6px] w-[6px] flex-none rounded-full"
                style={{
                  background:
                    c.state === 'connected' ? 'var(--accent)' : c.state === 'error' ? 'var(--err)' : 'var(--text-3)',
                }}
              />
              <span className="text-os-dim">{c.label}</span>
              <span className="ml-auto text-os-dim">
                {c.state === 'connected' ? 'Live' : c.state === 'error' ? 'Error' : 'Not set up'}
              </span>
            </li>
          ))}
          <li className="mt-1.5 flex">
            <Link
              href={entry.configHref ?? '/integrations'}
              className="rounded-[8px] border px-2.5 py-[3px] text-[11.5px] font-medium text-os-accent transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderColor: 'var(--accent-line)' }}
            >
              Configure <span aria-hidden>›</span>
            </Link>
          </li>
        </ul>
      ) : (
        <ConnectFlow
          slug={entry.slug}
          connected={entry.connected}
          keySaved={entry.keySaved}
          keys={connectKeysFor(entry)}
          guidance={guidance}
        />
      )}
    </div>
  );
}
