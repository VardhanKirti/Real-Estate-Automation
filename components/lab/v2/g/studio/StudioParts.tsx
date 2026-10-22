'use client';
/**
 * Studio pieces, GladOS tree (07 7.3.7, 7.3.8, 7.13.5; 01 11): the Generate button with 07's state line,
 * the diversity line, the "Your audience keeps asking" seeds, and the New idea form (grounded on submit;
 * 07 refuses with a plain 422 reason shown inline).
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GButton, GField, GInput, GSelect, GTextarea, useToast } from '@/components/g';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { NewIdeaFormView, StudioPageView } from '@/lib/lab/view/studio';
import { SectionNote } from '../bits';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

export function GenerateButton({ gen, readOnly }: { gen: StudioPageView['generate']; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [line, setLine] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (window.location.hash === '#generate') btn.current?.focus();
  }, []);
  const disabled = !!readOnly || gen.state === 'no_material' || gen.state === 'full' || gen.state === 'read_only' || busy === 'generate';
  const reason = readOnly ?? gen.disabledReason ?? undefined;
  return (
    <span className="lab2g-generate">
      <GButton
        ref={btn as never}
        id="generate"
        variant="ink"
        busy={busy === 'generate' || gen.state === 'running'}
        disabled={disabled}
        disabledReason={reason}
        onClick={async () => {
          const r = await post('/api/lab/ideas', { action: 'generate' }, { key: 'generate', inline: [503] });
          if (r.status === 503) setLine(LAB_COPY.cliMissingGenerate);
          else if (r.ok) setLine(typeof r.data.line === 'string' ? r.data.line : typeof r.data.outcome === 'string' ? r.data.outcome : null);
        }}
      >
        {LAB_UI.generateIdeas}
      </GButton>
      {gen.lineHref ? (
        <a data-g="LabLink" href={gen.lineHref} className="lab2g-onaurora lab2g-genline" data-lab-ink="">{line ?? gen.line}</a>
      ) : (
        <span className="lab2g-onaurora lab2g-genline" data-lab-ink="">{line ?? gen.line}</span>
      )}
    </span>
  );
}

export function Seeds({ seeds, readOnly }: { seeds: StudioPageView['seeds']; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams() ?? new URLSearchParams();
  const { toast } = useToast();
  if (seeds.state.kind === 'not_built') return null;
  const select = (id: string) => {
    const q = new URLSearchParams(params.toString());
    q.set('idea', id);
    q.delete('new');
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  return (
    <div className="lab2g-group">
      <h3 className="lab2g-group-title" data-lab-ink="">{seeds.title}</h3>
      {seeds.rows.length === 0 ? (
        <SectionNote state={seeds.state} />
      ) : (
        <ul className="lab2g-rows lab2g-rows-flat">
          {seeds.rows.map((s) => (
            <li key={s.seedId} className="lab2g-row lab2g-row-static lab2g-seed">
              <span className="lab2g-row-main" data-lab-ink="">{`"${s.label}"`}</span>
              <span className="lab2g-row-meta" data-lab-ink="">{s.countText}</span>
              {s.ideaHref ? (
                <a data-g="LabLink" href={s.ideaHref} className="lab2-pill lab2-seeall" data-lab-ink="">{LAB_UI.openWord}</a>
              ) : (
                <button data-g="LabButton"
                  type="button"
                  className="lab2-pill lab2-seeall"
                  aria-disabled={readOnly || s.make.disabledReason ? true : undefined}
                  title={s.make.disabledReason ?? readOnly ?? undefined}
                  onClick={async () => {
                    if (readOnly || s.make.disabledReason) return;
                    const r = await post('/api/lab/ideas', { action: 'from_seed', seedId: s.seedId }, { key: `seed-${s.seedId}`, refresh: false, inline: [404] });
                    if (r.status === 404) toast({ text: LAB_UI.seedGone, tone: 'info' });
                    const idea = r.data.idea as { id?: string } | undefined;
                    if (r.ok && idea?.id) {
                      toast({ text: r.data.existing ? LAB_UI.ideaExists : LAB_UI.ideaFromSeed, tone: 'ok' });
                      select(idea.id);
                    }
                  }}
                >
                  <span data-lab-ink="">{busy === `seed-${s.seedId}` ? LAB_UI.making : s.make.label}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewIdeaForm({ form, readOnly }: { form: NewIdeaFormView; readOnly: string | null }) {
  const f = form.fields;
  const [title, setTitle] = useState('');
  const [angle, setAngle] = useState<string>(f.angle.options[0]?.id ?? 'other');
  const [eventId, setEventId] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { post, busy } = useLabPost();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams() ?? new URLSearchParams();
  const submit = async () => {
    const t = title.trim();
    if (t.length < 8 || t.length > f.title.max) {
      setErr(LAB_UI.titleTooShort);
      return;
    }
    setErr(null);
    const r = await post('/api/lab/ideas', { action: 'create', title: t, angle, eventId: eventId || undefined, notes: notes || undefined }, { key: 'create', refresh: false, inline: [422, 400] });
    if (!r.ok && (r.status === 422 || r.status === 400)) setErr(typeof r.data.error === 'string' ? r.data.error : null);
    if (r.ok && typeof r.data.ideaId === 'string') {
      const q = new URLSearchParams(params.toString());
      q.set('idea', r.data.ideaId);
      q.delete('new');
      router.replace(`${pathname}?${q}`, { scroll: false });
    }
  };
  const cancel = () => {
    const q = new URLSearchParams(params.toString());
    q.delete('new');
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  };
  return (
    <form
      className="lab2g-form lab2g-newidea"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) void submit();
      }}
    >
      <h2 className="lab2g-panel-title" data-lab-ink="">{LAB_UI.newIdea}</h2>
      <GField label={f.title.label} htmlFor="lab2g-ni-title" error={err ?? undefined}>
        <GInput id="lab2g-ni-title" placeholder={f.title.placeholder} maxLength={f.title.max} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus disabled={!!readOnly} />
      </GField>
      <span className="lab2g-form-pair">
        <GField label={f.angle.label} htmlFor="lab2g-ni-angle">
          <GSelect id="lab2g-ni-angle" value={angle} onChange={(e) => setAngle(e.target.value)} options={f.angle.options.map((o) => ({ value: o.id, label: o.label }))} />
        </GField>
        <GField label={f.eventId.label} htmlFor="lab2g-ni-event">
          <GSelect id="lab2g-ni-event" value={eventId} onChange={(e) => setEventId(e.target.value)} options={[{ value: '', label: LAB_UI.none }, ...f.eventId.options.map((o) => ({ value: o.id, label: o.label }))]} />
        </GField>
      </span>
      <GField label={f.notes.label} htmlFor="lab2g-ni-notes">
        <GTextarea id="lab2g-ni-notes" maxLength={f.notes.max} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </GField>
      <span className="lab2g-sheetfoot">
        <span className="lab2g-grow" />
        <GButton type="button" onClick={cancel}>{LAB_UI.cancel}</GButton>
        <GButton type="submit" variant="ink" busy={busy === 'create'} disabled={!!readOnly} disabledReason={readOnly ?? undefined}>
          {form.submitLabel}
        </GButton>
      </span>
    </form>
  );
}
