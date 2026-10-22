'use client';

/**
 * "Describe a new skill" — the intake affordance next to the /skills search
 * bar . Two real POSTs:
 * /api/skills/propose (read-only — scores the description against the REAL
 * taxonomy from lib/skills-catalog.ts and returns a placement + 2
 * alternates) and, on confirm, /api/skills/create (writes an actual draft
 * SKILL.md + GROUP file into the skills dir the catalog reads). No pretend
 * success: any failure from either call surfaces inline, and the composer
 * stays open so the description isn't lost.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PenLine, X, ArrowRight, Check } from 'lucide-react';

type Placement = { domain: string; group: string; path: string };
type Proposal = { name: string; proposed: Placement; alternates: Placement[] };

export function NewSkillIntake() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [chosen, setChosen] = useState(0); // index into [proposed, ...alternates]
  const [created, setCreated] = useState<{ slug: string; path: string } | null>(null);

  function reset() {
    setDescription('');
    setName('');
    setError(null);
    setProposal(null);
    setChosen(0);
    setCreated(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function propose() {
    setError(null);
    if (description.trim().length < 8) {
      setError('Describe it in a bit more detail — at least a sentence.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/skills/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), name: name.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setProposal(body as Proposal);
      setChosen(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!proposal) return;
    const placement = [proposal.proposed, ...proposal.alternates][chosen];
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: proposal.name,
          description: description.trim(),
          domain: placement.domain,
          group: placement.group,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCreated({ slug: body.slug, path: body.path });
      router.refresh(); // re-reads the skills dir server-side so it appears in the hierarchy
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-chip mb-4 flex items-center gap-2 px-4 py-2.5 text-[13px] text-os-muted transition-colors hover:text-os-text"
      >
        <PenLine className="h-3.5 w-3.5 shrink-0 text-os-accent" strokeWidth={1.7} />
        Describe a new skill
      </button>
    );
  }

  const placements = proposal ? [proposal.proposed, ...proposal.alternates] : [];

  return (
    <div className="glass-panel mb-4 max-w-[640px] p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="glass-label">Describe a new skill</span>
        <button onClick={close} aria-label="Close" className="text-os-dim transition-colors hover:text-os-text">
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      {created ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] text-os-text">
            <Check className="h-4 w-4 shrink-0 text-os-accent" strokeWidth={1.7} />
            Draft created at <span className="font-mono text-[12px] text-os-accent">{created.path}</span>
          </div>
          <p className="text-[12px] text-os-dim">It's a stub — flesh it out before first use. It's already in the hierarchy below.</p>
          <button
            onClick={close}
            className="w-fit rounded-[9px] border px-3 py-2 text-[12px] font-medium text-os-accent transition-colors hover:bg-[var(--accent-soft)]"
            style={{ borderColor: 'var(--accent-line)' }}
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What should this skill do?"
            rows={3}
            disabled={busy}
            className="w-full resize-none rounded-[10px] border border-os-border bg-os-surface2 px-3 py-2.5 text-[13.5px] leading-relaxed text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong disabled:opacity-60"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional — kebab-case, e.g. invoice-chaser)"
            disabled={busy}
            className="mt-2 w-full rounded-[10px] border border-os-border bg-os-surface2 px-3 py-2 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong disabled:opacity-60"
          />

          {error && <p className="mt-2 text-[12px] text-os-err">{error}</p>}

          {!proposal ? (
            <button
              onClick={propose}
              disabled={busy}
              className="mt-3 flex items-center gap-1.5 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium text-os-accent transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
              style={{ borderColor: 'var(--accent-line)' }}
            >
              {busy ? 'Proposing…' : 'Propose placement'}
              {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.7} />}
            </button>
          ) : (
            <div className="mt-3">
              <p className="text-[12.5px] text-os-muted">
                Will be created at{' '}
                <span className="font-mono text-[12px] text-os-accent">{placements[chosen].path}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {placements.map((p, i) => (
                  <button
                    key={`${p.domain}/${p.group}`}
                    onClick={() => setChosen(i)}
                    disabled={busy}
                    className={`rounded-[8px] border px-2.5 py-1.5 text-[11.5px] transition-colors ${
                      i === chosen
                        ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                        : 'border-os-border text-os-dim hover:bg-os-surface2 hover:text-os-muted'
                    }`}
                  >
                    {i === 0 ? 'Proposed: ' : 'Alternate: '}
                    {p.domain}/{p.group}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2.5">
                <button
                  onClick={confirm}
                  disabled={busy}
                  className="rounded-[9px] border px-3 py-2 text-[12.5px] font-medium text-os-accent transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                  style={{ borderColor: 'var(--accent-line)' }}
                >
                  {busy ? 'Creating…' : 'Create draft skill'}
                </button>
                <button
                  onClick={() => setProposal(null)}
                  disabled={busy}
                  className="text-[12px] text-os-dim transition-colors hover:text-os-text disabled:opacity-50"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
