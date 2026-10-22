'use client';
/**
 * Studio (`/lab/studio`), Classic tree (01 11): Generate and New idea, the grouped idea list with the
 * diversity line, scripts and audience seeds, and the selected idea (D5: ?idea= selects in place at
 * 768px and wider; below that the Idea sheet opens).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ActionPill, Glass } from '@/components/lab/v2/shared';
import type { NewIdeaFormView, StudioPageView } from '@/lib/lab/view/studio';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { Btn, CapDialog, ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { useMinWidth } from './hooks';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Panel, StateLine, Tag, shows } from './parts';
import { IdeaActions, IdeaBody } from './sheets/IdeaSheet';

function NewIdeaForm({ form, readOnly }: { form: NewIdeaFormView; readOnly: string | null }) {
  const router = useRouter();
  const { post, busy } = useLabPost();
  const [title, setTitle] = useState('');
  const [angle, setAngle] = useState(form.fields.angle.options[0]?.id ?? 'other');
  const [eventId, setEvent] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => {
    const t = title.trim();
    if (t.length < 8) { setError(C.studio.titleLength); return; }
    setError(null);
    const r = await post('/api/lab/ideas', { action: 'create', title: t, angle, eventId: eventId || undefined, notes: notes.trim() || undefined }, { key: 'create', refresh: false, quiet: true });
    if (r.ok && typeof r.data.ideaId === 'string') {
      const u = new URL(window.location.href);
      u.searchParams.delete('new');
      u.searchParams.set('idea', r.data.ideaId);
      router.replace(u.pathname + u.search, { scroll: false });
    } else if (typeof r.data.error === 'string') setError(r.data.error);
  };
  return (
    <form className="lab2c-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={C.studio.newIdea}>
      <label className="lab2c-field">
        <span className="lab2c-field-label" data-lab-ink="">{form.fields.title.label}</span>
        <input ref={ref} className="lab2c-input" value={title} maxLength={form.fields.title.max} placeholder={form.fields.title.placeholder} onChange={(e) => setTitle(e.target.value)} disabled={!!readOnly} />
      </label>
      <span className="lab2c-field-row">
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{form.fields.angle.label}</span>
          <select className="lab2c-input" value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} disabled={!!readOnly}>
            {form.fields.angle.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{form.fields.eventId.label}</span>
          <select className="lab2c-input" value={eventId} onChange={(e) => setEvent(e.target.value)} disabled={!!readOnly}>
            <option value="" />
            {form.fields.eventId.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      </span>
      <label className="lab2c-field">
        <span className="lab2c-field-label" data-lab-ink="">{form.fields.notes.label}</span>
        <textarea className="lab2c-input" value={notes} maxLength={form.fields.notes.max} onChange={(e) => setNotes(e.target.value)} disabled={!!readOnly} />
      </label>
      {error && <p className="lab2c-field-err" role="alert">{error}</p>}
      {readOnly && <p className="lab2c-muted" data-lab-ink="">{readOnly}</p>}
      <span className="lab2c-actrow">
        <Btn primary type="submit" disabled={!!readOnly} busy={busy === 'create'}>{form.submitLabel}</Btn>
        <Link href="?" replace scroll={false} className="lab2c-btn" onClick={(e) => { e.preventDefault(); const u = new URL(window.location.href); u.searchParams.delete('new'); router.replace(u.pathname + u.search, { scroll: false }); }}>{C.studio.cancel}</Link>
      </span>
    </form>
  );
}

export function StudioPage({ view }: { view: StudioPageView }) {
  return (
    <ClassicCapHost>
      <StudioPageBody view={view} />
    </ClassicCapHost>
  );
}

function StudioPageBody({ view }: { view: StudioPageView }) {
  const router = useRouter();
  const wide = useMinWidth(768);
  const { post, busy } = useLabPost();
  const [cap, setCap] = useState<Record<string, unknown> | null>(null);
  const [genLine, setGenLine] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => Object.fromEntries(view.groups.map((g) => [g.id, g.collapsed])));
  const genRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (window.location.hash === '#generate') genRef.current?.querySelector<HTMLElement>('button, a')?.focus();
  }, []);
  // 01 22.1: n opens New idea.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey || (t && t.closest('input, textarea, select, [contenteditable], [role="dialog"]'))) return;
      const u = new URL(window.location.href);
      u.searchParams.set('new', '1');
      router.push(u.pathname + u.search, { scroll: false });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [router]);

  const generate = async (override = false) => {
    setCap(null);
    const r = await post('/api/lab/ideas', { action: 'generate', ...(override ? { override: true } : {}) }, { key: 'generate', onCap: (_retry, d) => setCap(d) });
    if (r.status === 503) setGenLine(typeof r.data.error === 'string' ? r.data.error : null);
    else if (r.ok && typeof r.data.line === 'string') setGenLine(r.data.line);
  };

  const select = (href: string) => {
    if (!wide) return; // the Link pushes ?idea= and the sheet opens (D5 applies at >= 768px only)
    router.replace(href, { scroll: false });
    requestAnimationFrame(() => detailRef.current?.focus());
  };

  const g = view.generate;
  const genDisabled = g.state === 'no_material' || g.state === 'full' || g.state === 'read_only' || g.state === 'running';
  const sel = view.selected;

  return (
    <Frame frame={view.frame} sheet={view.sheet} outsideScripts={view.scripts.rows.filter((r) => r.status === 'draft').map((r) => ({ id: r.id, label: r.title }))}>
      <div className="lab2c-bar lab2c-studio-bar">
        <span ref={genRef} id="generate" className="lab2c-gen">
          <ActionPill label={C.studio.generate} icon="plus" busy={g.state === 'running' || busy === 'generate'} disabled={genDisabled} disabledReason={g.disabledReason ?? undefined} onClick={() => void generate()} />
          {g.lineHref ? (
            <Link href={g.lineHref} scroll={false} className="lab2c-gen-line" data-lab-ink="">{genLine ?? g.line}</Link>
          ) : (
            <span className="lab2c-gen-line" data-lab-ink="">{genLine ?? g.line}</span>
          )}
        </span>
        <span className="lab2c-bar-end">
          <ActionPill label={C.studio.newIdea} href="?new=1" sharedId="studio-new" disabled={!!view.frame.readOnly} disabledReason={view.frame.readOnly ?? undefined} />
        </span>
      </div>

      {view.emptyCard ? (
        <Panel className="lab2c-gap-top" priority={2}><StateLine state={view.emptyCard} /></Panel>
      ) : (
        <div className="lab2c-studio">
          <Panel as="div" className="lab2c-studio-list" priority={2}>
            <p className="lab2c-muted" data-lab-ink="">{view.diversity.text}</p>
            {view.groups.filter((gr) => gr.items.length > 0).map((gr) => {
              const isClosed = closed[gr.id];
              return (
                <section key={gr.id} className="lab2c-igroup" aria-labelledby={`grp-${gr.id}`}>
                  <button type="button" className="lab2c-disclose lab2c-igroup-head" aria-expanded={!isClosed} aria-controls={`grp-list-${gr.id}`} onClick={() => setClosed((c) => ({ ...c, [gr.id]: !c[gr.id] }))}>
                    <span className="lab2c-disclose-mark" aria-hidden="true" />
                    <span id={`grp-${gr.id}`} data-lab-ink="">{gr.label}</span>
                    <span className="lab2c-fchip-n" data-lab-ink="">{gr.items.length}</span>
                  </button>
                  {!isClosed && (
                    <ul id={`grp-list-${gr.id}`} className="lab2c-ilist">
                      {gr.items.map((it) => (
                        <li key={it.id}>
                          <Link
                            href={it.href}
                            replace={wide}
                            scroll={false}
                            className="lab2c-iitem"
                            aria-current={it.selected ? 'true' : undefined}
                            data-lab-shared={`idea-${it.id}`}
                            onClick={(e) => { if (wide) { e.preventDefault(); select(it.href); } }}
                          >
                            <span className="lab2c-iitem-title" data-lab-ink="">{it.title}</span>
                            <span className="lab2c-iitem-meta" data-lab-ink="">
                              {it.windowText && <span>{it.windowText}</span>}
                              <span>{it.groundedText}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            <section className="lab2c-igroup" aria-labelledby="grp-scripts">
              <h2 id="grp-scripts" className="lab2c-igroup-title" data-lab-ink="">{C.studio.scripts}</h2>
              <StateLine state={view.scripts.state} compact />
              {shows(view.scripts.state) && (
                <ul className="lab2c-ilist">
                  {view.scripts.rows.map((s) => (
                    <li key={s.id}>
                      <Link href={`?script=${s.id}`} scroll={false} className="lab2c-iitem" data-lab-shared={`script-${s.id}`}>
                        <span className="lab2c-iitem-title" data-lab-ink="">{s.title}</span>
                        <span className="lab2c-iitem-meta" data-lab-ink="">
                          <span>{`v${s.version}`}</span>
                          <span>{s.gateText}</span>
                          {s.predictionText && <span>{s.predictionText}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {view.frame.layers.comments !== 'not_built' && (
              <section className="lab2c-igroup" aria-labelledby="grp-seeds">
                <h2 id="grp-seeds" className="lab2c-igroup-title" data-lab-ink="">{view.seeds.title}</h2>
                <StateLine state={view.seeds.state} compact />
                {shows(view.seeds.state) && (
                  <ul className="lab2c-ilist">
                    {view.seeds.rows.map((s) => (
                      <li key={s.seedId} className="lab2c-seed">
                        <span className="lab2c-iitem-title" data-lab-ink="">{`"${s.label}"`}</span>
                        <span className="lab2c-iitem-meta" data-lab-ink="">{s.countText}</span>
                        {s.ideaHref ? (
                          <Link href={s.ideaHref} replace scroll={false} className="lab2c-btn">{C.studio.openIdea}</Link>
                        ) : (
                          <Btn
                            disabled={!!s.make.disabledReason}
                            title={s.make.disabledReason ?? undefined}
                            busy={busy === `seed-${s.seedId}`}
                            onClick={async () => {
                              const r = await post('/api/lab/ideas', { action: 'from_seed', seedId: s.seedId }, { key: `seed-${s.seedId}`, refresh: false });
                              const idea = r.data.idea as { id?: string } | undefined;
                              if (r.ok && idea?.id) router.replace(`?idea=${idea.id}`, { scroll: false });
                            }}
                          >
                            {busy === `seed-${s.seedId}` ? C.today.making : s.make.label}
                          </Btn>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </Panel>

          <Glass as="section" tone="strong" radius="tile" priority={2} className="lab2c-studio-detail" aria-labelledby="studio-detail-title">
            {view.newIdea ? (
              <>
                <h2 id="studio-detail-title" ref={detailRef} tabIndex={-1} className="lab2c-detail-title" data-lab-ink="">{C.studio.newIdea}</h2>
                <NewIdeaForm form={view.newIdea} readOnly={view.frame.readOnly} />
              </>
            ) : sel ? (
              <>
                <header className="lab2c-detail-head">
                  <h2 id="studio-detail-title" ref={detailRef} tabIndex={-1} className="lab2c-detail-title" data-lab-ink="">{sel.data.title}</h2>
                  <Tag tone="quiet">{C.studio.status[sel.data.status] ?? sel.data.status}</Tag>
                </header>
                <IdeaBody view={sel} readOnly={view.frame.readOnly} />
                <IdeaActions view={sel} readOnly={view.frame.readOnly} />
              </>
            ) : (
              <p className="lab2c-state-text" id="studio-detail-title" data-lab-ink="">{C.studio.select}</p>
            )}
          </Glass>
        </div>
      )}
      <CapDialog ask={cap} onClose={() => setCap(null)} onPass={() => void generate(true)} />
    </Frame>
  );
}
