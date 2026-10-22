'use client';
/**
 * Studio (`/lab/studio`) under Bennett Legacy (founderos-ui pages/lab.md section 1): Generate and the
 * generation line, the Ask the Lab composer with the `▌` caret, the grouped idea list, scripts and
 * audience seeds, and the selected idea with its hook pair as two SlabCards side by side; New idea is a
 * mono form. D5: ?idea= selects in place at 768px and wider; below that the Idea sheet opens.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { NewIdeaFormView, StudioPageView } from '@/lib/lab/view/studio';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { useMinWidth } from '../classic/hooks';
import { LEGACY_LAB as L } from './copy';
import { CapDialog, Field, LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Btn, Card, LState, Tag, cx, shows } from './parts';
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
  const close = () => { const u = new URL(window.location.href); u.searchParams.delete('new'); router.replace(u.pathname + u.search, { scroll: false }); };
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
    <form data-l="LabIdeaForm" className="l-lab-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={C.studio.newIdea}>
      <Field label={form.fields.title.label}>
        <input ref={ref} className="l-input" value={title} maxLength={form.fields.title.max} placeholder={form.fields.title.placeholder} onChange={(e) => setTitle(e.target.value)} disabled={!!readOnly} />
      </Field>
      <div className="l-lab-field-row">
        <Field label={form.fields.angle.label}>
          <select className="l-select" value={angle} onChange={(e) => setAngle(e.target.value as typeof angle)} disabled={!!readOnly}>
            {form.fields.angle.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label={form.fields.eventId.label}>
          <select className="l-select" value={eventId} onChange={(e) => setEvent(e.target.value)} disabled={!!readOnly}>
            <option value="" />
            {form.fields.eventId.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label={form.fields.notes.label}>
        <textarea className="l-textarea" value={notes} maxLength={form.fields.notes.max} onChange={(e) => setNotes(e.target.value)} disabled={!!readOnly} />
      </Field>
      {error && <p className="l-err-text" role="alert">{error}</p>}
      {readOnly && <p className="l-body-text">{readOnly}</p>}
      <span className="l-lab-actrow">
        <Btn primary type="submit" disabled={!!readOnly} busy={busy === 'create'}>{form.submitLabel}</Btn>
        <Btn onClick={close}>{C.studio.cancel}</Btn>
      </span>
    </form>
  );
}

/** Ask the Lab, the composer (pages/lab.md Studio): a prompt, the field, the blinking `▌` caret; Enter asks. */
function Composer() {
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim().slice(0, 300);
    if (!t) return;
    const u = new URL(window.location.href);
    u.searchParams.set('ask', t);
    openSheetHref(u.pathname + u.search);
  };
  return (
    <form data-l="LabComposer" className="l-lab-composer" onSubmit={submit}>
      <span aria-hidden className="l-lab-prompt">{'>'}</span>
      <input value={q} maxLength={300} placeholder={L.composerHint} aria-label={L.composer} onChange={(e) => setQ(e.target.value)} />
      <span aria-hidden className="l-lab-caret">▌</span>
      <Btn primary type="submit" disabled={!q.trim()}>{C.today.askSubmit}</Btn>
    </form>
  );
}

export function StudioPage({ view }: { view: StudioPageView }) {
  return (
    <LegacyCapHost>
      <StudioBody view={view} />
    </LegacyCapHost>
  );
}

function StudioBody({ view }: { view: StudioPageView }) {
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
    if (!wide) return;
    router.replace(href, { scroll: false });
    requestAnimationFrame(() => detailRef.current?.focus());
  };

  const g = view.generate;
  const genDisabled = g.state === 'no_material' || g.state === 'full' || g.state === 'read_only' || g.state === 'running';
  const sel = view.selected;

  const bar = (
    <>
      <span ref={genRef} id="generate" className="l-lab-gen">
        <Btn primary busy={g.state === 'running' || busy === 'generate'} disabled={genDisabled} title={g.disabledReason ?? undefined} onClick={() => void generate()}>
          <Plus size={12} strokeWidth={1.8} aria-hidden />
          {C.studio.generate}
        </Btn>
        {g.lineHref ? <Link href={g.lineHref} scroll={false} className="l-lab-gen-line">{genLine ?? g.line}</Link> : <span className="l-lab-gen-line">{genLine ?? g.line}</span>}
      </span>
      <span className="l-lab-bar-end">
        <Btn href="?new=1" disabled={!!view.frame.readOnly} title={view.frame.readOnly ?? undefined} data-lab-shared="studio-new">{C.studio.newIdea}</Btn>
      </span>
    </>
  );

  return (
    <Frame frame={view.frame} sheet={view.sheet} bar={bar} outsideScripts={view.scripts.rows.filter((r) => r.status === 'draft').map((r) => ({ id: r.id, label: r.title }))}>
      <div className="l-stack">
        <Composer />
        {view.emptyCard ? (
          <Card i={1}><LState state={view.emptyCard} /></Card>
        ) : (
          <div className="l-lab-studio">
            <Card i={1} className="l-lab-studio-list" as="div">
              <p className="l-body-text">{view.diversity.text}</p>
              {view.groups.filter((gr) => gr.items.length > 0).map((gr) => {
                const isClosed = closed[gr.id];
                return (
                  <section key={gr.id} className="l-lab-igroup" aria-labelledby={`grp-${gr.id}`}>
                    <button type="button" className="l-lab-disclose" aria-expanded={!isClosed} aria-controls={`grp-list-${gr.id}`} onClick={() => setClosed((c) => ({ ...c, [gr.id]: !c[gr.id] }))}>
                      <span aria-hidden className="l-lab-disclose-mark" />
                      <span id={`grp-${gr.id}`}>{gr.label}</span>
                      <span className="l-lab-chip-n">{gr.items.length}</span>
                    </button>
                    {!isClosed && (
                      <ul id={`grp-list-${gr.id}`} className="l-lab-rows">
                        {gr.items.map((it) => (
                          <li key={it.id}>
                            <Link
                              href={it.href}
                              replace={wide}
                              scroll={false}
                              data-l="Pressable"
                              data-lens="r"
                              className={cx('l-pressable is-row l-btn-row l-lab-iitem', it.selected && 'is-on')}
                              aria-current={it.selected ? 'true' : undefined}
                              data-lab-shared={`idea-${it.id}`}
                              onClick={(e) => { if (wide) { e.preventDefault(); select(it.href); } }}
                            >
                              <span className="l-lab-iitem-title">{it.title}</span>
                              <span className="l-lab-iitem-meta">
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

              <section className="l-lab-igroup" aria-labelledby="grp-scripts">
                <h2 id="grp-scripts" className="l-lab-block-title">{C.studio.scripts}</h2>
                <LState state={view.scripts.state} compact />
                {shows(view.scripts.state) && (
                  <ul className="l-lab-rows">
                    {view.scripts.rows.map((s) => (
                      <li key={s.id}>
                        <Link href={`?script=${s.id}`} scroll={false} data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-iitem" data-lab-shared={`script-${s.id}`}>
                          <span className="l-lab-iitem-title">{s.title}</span>
                          <span className="l-lab-iitem-meta">
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
                <section className="l-lab-igroup" aria-labelledby="grp-seeds">
                  <h2 id="grp-seeds" className="l-lab-block-title">{view.seeds.title}</h2>
                  <LState state={view.seeds.state} compact />
                  {shows(view.seeds.state) && (
                    <ul className="l-lab-rows">
                      {view.seeds.rows.map((s) => (
                        <li key={s.seedId} className="l-lab-seed">
                          <span className="l-lab-iitem-title">{`"${s.label}"`}</span>
                          <span className="l-muted">{s.countText}</span>
                          {s.ideaHref ? (
                            <Btn href={s.ideaHref} replace>{C.studio.openIdea}</Btn>
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
            </Card>

            <section data-l="SlabCard" className="l-rise l-card l-lab-studio-detail" style={{ ['--l-rise-i' as string]: 2 }} aria-labelledby="studio-detail-title">
              {view.newIdea ? (
                <>
                  <h2 id="studio-detail-title" ref={detailRef} tabIndex={-1} className="l-lab-detail-title">{C.studio.newIdea}</h2>
                  <NewIdeaForm form={view.newIdea} readOnly={view.frame.readOnly} />
                </>
              ) : sel ? (
                <>
                  <header className="l-lab-detail-head">
                    <h2 id="studio-detail-title" ref={detailRef} tabIndex={-1} className="l-lab-detail-title">{sel.data.title}</h2>
                    <Tag tone="quiet">{C.studio.status[sel.data.status] ?? sel.data.status}</Tag>
                  </header>
                  <IdeaBody view={sel} readOnly={view.frame.readOnly} />
                  <IdeaActions view={sel} readOnly={view.frame.readOnly} />
                </>
              ) : (
                <p className="l-lab-state-text" id="studio-detail-title">{C.studio.select}</p>
              )}
            </section>
          </div>
        )}
      </div>
      <CapDialog ask={cap} onClose={() => setCap(null)} onPass={() => void generate(true)} />
    </Frame>
  );
}
