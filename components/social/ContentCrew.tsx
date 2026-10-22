import Link from 'next/link';
import { GButton, GCard, GEmpty, GList, GRow, GSectionHeader, GStat, GTag } from '@/components/g';
import { postAgeText, CREW_WINDOW_DAYS, type ContentCrew } from '@/lib/social-crew';

/**
 * The content crew card on /social (founderos-ui F12, from FO's
 * ContentAgentCard): the Growth agents, their runs in 30 days, the busiest
 * one and the age of the last post. GladOS and Classic forms; Legacy renders
 * the Classic one under its skin.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ContentCrewG({ crew }: { crew: ContentCrew }) {
  return (
    <aside className="soc-g-sec soc-g-crew" aria-labelledby="soc-g-crew" data-content-crew="">
      <GSectionHeader
        id="soc-g-crew"
        size={22}
        title="Content crew"
        caption={crew.department ? `${crew.department.name} · last ${CREW_WINDOW_DAYS} days` : undefined}
        action={
          <GButton size="sm" href={crew.href} title="Open the Growth agents">
            Agents
          </GButton>
        }
      />
      <GCard p={16} className="soc-g-crew-card">
        {crew.agents.length === 0 ? (
          <GEmpty title="No Growth agents yet" body="Agents in the Growth department show here with their runs." action={{ label: 'Open Agents', href: '/agents' }} />
        ) : (
          <>
            <div className="soc-g-crew-stats">
              <GStat value={crew.runs} label={`runs · ${CREW_WINDOW_DAYS}d`} href={crew.href} source={`Runs by the ${plural(crew.agents.length, 'Growth agent')} in the last ${CREW_WINDOW_DAYS} days${crew.failed > 0 ? `; ${crew.failed} failed` : ''}`} />
              <div className="soc-g-crew-facts">
                <span title={crew.busiest ? `${crew.busiest.name} ran ${plural(crew.busiest.runs, 'time')} in ${CREW_WINDOW_DAYS} days` : `No Growth agent ran in ${CREW_WINDOW_DAYS} days`}>
                  <span className="soc-g-cap">Busiest</span> {crew.busiest ? crew.busiest.name : 'None yet'}
                </span>
                <span title={crew.lastPostAt ? new Date(crew.lastPostAt).toLocaleString('en-US') : 'No published post on record'}>
                  <span className="soc-g-cap">Last post</span> {postAgeText(crew.lastPostAge)}
                </span>
              </div>
            </div>
            <GList divided label="Growth agents">
              {crew.agents.map((a) => (
                <GRow
                  key={a.id}
                  href={`/agents?agent=${encodeURIComponent(a.id)}`}
                  title={a.name}
                  meta={a.role || a.status}
                  hint={`${a.name}: ${plural(a.runs, 'run')} in ${CREW_WINDOW_DAYS} days`}
                  trailing={
                    a.failed > 0 ? (
                      <GTag tone="err" size="xs">
                        {a.runs} · {a.failed} failed
                      </GTag>
                    ) : (
                      <span className="soc-g-cap">{plural(a.runs, 'run')}</span>
                    )
                  }
                />
              ))}
            </GList>
          </>
        )}
      </GCard>
    </aside>
  );
}

export function ContentCrewClassic({ crew }: { crew: ContentCrew }) {
  return (
    <section className="mb-8" aria-labelledby="crew-title" data-content-crew="">
      <div className="rounded-lg-t border border-os-border bg-os-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="crew-title" className="text-[13.5px] font-medium text-os-text">
            Content crew
            {crew.department && <span className="ml-2 font-normal text-os-muted">{crew.department.name} · last {CREW_WINDOW_DAYS} days</span>}
          </h2>
          <Link href={crew.href} className="text-[12px] text-os-accent hover:underline">
            Agents →
          </Link>
        </div>
        {crew.agents.length === 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-os-muted">
            No Growth agents yet. Agents in the Growth department show here with their runs.
            <Link href="/agents" className="text-os-accent hover:underline">
              Open Agents
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[11.5px] text-os-muted">Runs · {CREW_WINDOW_DAYS}d</div>
                <div className="mt-1 text-[26px] font-normal leading-none tabular-nums text-os-text">{crew.runs}</div>
                {crew.failed > 0 && <div className="mt-1 text-[11.5px] text-os-err">{crew.failed} failed</div>}
              </div>
              <div className="min-w-0">
                <div className="text-[11.5px] text-os-muted">Busiest</div>
                <div className="mt-1 truncate text-[14px] text-os-text" title={crew.busiest ? `${crew.busiest.name}: ${plural(crew.busiest.runs, 'run')}` : undefined}>
                  {crew.busiest ? crew.busiest.name : 'None yet'}
                </div>
                {crew.busiest && <div className="mt-1 font-mono text-[11.5px] text-os-muted">{plural(crew.busiest.runs, 'run')}</div>}
              </div>
              <div>
                <div className="text-[11.5px] text-os-muted">Last post</div>
                <div className="mt-1 text-[14px] text-os-text" title={crew.lastPostAt ? new Date(crew.lastPostAt).toLocaleString('en-US') : undefined}>
                  {postAgeText(crew.lastPostAge)}
                </div>
              </div>
            </div>
            <ul className="mt-4 divide-y divide-os-border border-t border-os-border">
              {crew.agents.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents?agent=${encodeURIComponent(a.id)}`} className="flex items-center gap-3 py-2 text-[12.5px] hover:bg-os-surface2">
                    <span className="min-w-0 flex-1 truncate text-os-text">{a.name}</span>
                    <span className="hidden min-w-0 truncate text-os-muted sm:inline">{a.role || a.status}</span>
                    <span className={`shrink-0 font-mono text-[11.5px] ${a.failed > 0 ? 'text-os-err' : 'text-os-muted'}`}>
                      {plural(a.runs, 'run')}
                      {a.failed > 0 ? ` · ${a.failed} failed` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
