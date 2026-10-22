'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { GAsk, GButton, GCard, GDrawer, GEmpty, GErrorLine, GField, GInput, GPage, GProgress, GSectionHeader, GSegmented, GSheet, GTextarea } from '@/components/g';
import { SkillHierarchy } from '@/components/SkillHierarchy';
import { specificSkillIcon, type SkillCard } from '@/components/SkillsGrid';

/**
 * /skills under the GladOS style (glados-ui SPEC S04 §4.5, X5). Same cards
 * and the same calls as the Classic page: the intake (propose, pick one of
 * three placements, create) moves into a sheet behind "New skill" (F-S1); a
 * filter field searches the tree and the grid (F-S2); the hierarchy sits in a
 * card at a bounded height (F-S3); domain tabs replace the forty section
 * heads and stay in step with a domain click in the tree (F-S4, AC04.22); the
 * reader is a drawer with `?skill=` deep links (F-S5, AC04.23).
 */
const STATUS_TONE: Record<string, string> = { live: 'ok', learning: 'warn', planned: 'idle' };
const ALL = '__all';

/** The domain a card's group belongs to (edge 10: no slash means the whole group). */
export function domainOf(group: string): string {
  const i = group.indexOf('/');
  return i === -1 ? group : group.slice(0, i);
}

function groupOf(group: string): string {
  const i = group.indexOf('/');
  return i === -1 ? group : group.slice(i + 1);
}

function matches(c: SkillCard, q: string): boolean {
  return q === '' || [c.name, c.description, c.id, c.group, c.meta].some((v) => v.toLowerCase().includes(q));
}

function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url);
}

export function SkillsG({ cards, sourceNote }: { cards: SkillCard[]; sourceNote: string }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string>(ALL);
  const [reading, setReading] = useState<SkillCard | null>(null);
  const [intake, setIntake] = useState(false);
  const askWrap = useRef<HTMLDivElement>(null);

  // deep links: ?domain= and ?skill= (§7)
  useEffect(() => {
    const p = new URL(window.location.href).searchParams;
    const d = p.get('domain');
    if (d) setDomain(d);
    const s = p.get('skill');
    if (s) setReading(cards.find((c) => c.id === s) ?? null);
  }, [cards]);
  // "/" focuses the search (F-S2)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))) return;
      e.preventDefault();
      askWrap.current?.querySelector<HTMLInputElement>('input')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const domains = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) if (matches(c, q)) m.set(domainOf(c.group), (m.get(domainOf(c.group)) ?? 0) + 1);
    const names = [...new Set(cards.map((c) => domainOf(c.group)))];
    // edge 10: "General" (no domain) goes last
    names.sort((a, b) => Number(a === 'General') - Number(b === 'General') || a.localeCompare(b));
    return names.map((n) => ({ name: n, count: m.get(n) ?? 0 }));
  }, [cards, q]);
  const total = domains.reduce((s, d) => s + d.count, 0);

  const pickDomain = (d: string) => {
    setDomain(d);
    setParam('domain', d === ALL ? null : d);
  };
  const open = (c: SkillCard | null) => {
    setReading(c);
    setParam('skill', c?.id ?? null);
  };

  const visible = cards.filter((c) => matches(c, q) && (domain === ALL || domainOf(c.group) === domain));
  const byGroup = new Map<string, SkillCard[]>();
  // All: one section per domain (ten, not forty); one domain: a section per group
  const keyOf = (c: SkillCard) => (domain === ALL ? domainOf(c.group) : c.group);
  for (const c of visible) byGroup.set(keyOf(c), [...(byGroup.get(keyOf(c)) ?? []), c]);
  const groups = [...byGroup.keys()].sort((a, b) => Number(a === 'General') - Number(b === 'General') || a.localeCompare(b));

  return (
    <GPage className="wg-page">
      <GSectionHeader
        size="page"
        title="Skills"
        caption={sourceNote}
        action={
          <GButton variant="ink" onClick={() => setIntake(true)}>
            <Plus size={14} strokeWidth={1.75} aria-hidden /> New skill
          </GButton>
        }
      />
      <div ref={askWrap} className="wg-sk-search">
        <GAsk mode="filter" value={query} onValueChange={setQuery} label="Search skills (/)" placeholder="Search skills" />
      </div>

      <GCard p={16} className="wg-sk-tree">
        <SkillHierarchy
          cards={cards}
          query={query}
          onOpen={(id) => open(cards.find((c) => c.id === id) ?? null)}
          skin="g"
          focusDomain={domain === ALL ? null : domain}
          onDomain={(d) => pickDomain(d ?? ALL)}
        />
      </GCard>

      <GSegmented
        label="Domain"
        value={domain}
        onChange={pickDomain}
        className="wg-fit"
        options={[{ value: ALL, label: `All ${total}` }, ...domains.map((d) => ({ value: d.name, label: `${d.name} ${d.count}` }))]}
      />

      {visible.length === 0 ? (
        <GEmpty inline title={q ? `No skill matches “${query.trim()}”` : 'No skills in this domain'} />
      ) : (
        <div className="wg-sk-groups">
          {groups.map((g) => (
            <section key={g} className="wg-sk-group">
              <span className="wg-cap">
                {domain === ALL ? g : groupOf(g)} · {byGroup.get(g)!.length}
              </span>
              <div className="wg-sk-grid">
                {byGroup.get(g)!.map((c) => {
                  const Icon = specificSkillIcon(c);
                  return (
                    <GCard key={c.id} p={16} onClick={() => open(c)} className="wg-sk-card" title={`${c.name}: open SKILL.md`}>
                      <span className="wg-sk-name">
                        {Icon && <Icon size={14} strokeWidth={1.6} aria-hidden />}
                        <span>{c.name}</span>
                        {c.status && <span className="wg-dot" data-tone={STATUS_TONE[c.status]} title={c.status} />}
                      </span>
                      <span className="wg-sk-desc">{c.description}</span>
                    </GCard>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Reader card={reading} onClose={() => open(null)} />
      <IntakeSheet open={intake} onClose={() => setIntake(false)} />
    </GPage>
  );
}

/* ── Reader (F-S5) ────────────────────────────────────────────────────── */

function Reader({ card, onClose }: { card: SkillCard | null; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
    if (!card) return;
    if (card.markdown != null) {
      setMd(card.markdown);
      return;
    }
    let dead = false;
    setMd(null);
    fetch(`/api/skills/${encodeURIComponent(card.id)}`)
      .then((r) => r.json().then((b: { markdown?: string; error?: string }) => ({ r, b })))
      .then(({ r, b }) => !dead && setMd(b.markdown ?? `SKILL.md could not be read (${b.error ?? r.status}).`))
      .catch(() => !dead && setMd('SKILL.md could not be read.'));
    return () => {
      dead = true;
    };
  }, [card]);
  return (
    <GDrawer open={!!card} onClose={onClose} title={card?.name ?? ''} width={640}>
      {card && (
        <div className="wg-sk-reader">
          <div className="wg-sk-path">
            <span className="wg-cap" data-mono-ok="">
              {card.filePath}
            </span>
            <GButton
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(card.filePath).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy path'}
            </GButton>
          </div>
          {md === null ? <GProgress text="Loading SKILL.md" /> : <MarkdownG src={md} />}
        </div>
      )}
    </GDrawer>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} data-mono-ok="">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

/** The same small markdown pass as the Classic reader, on kit type. */
function MarkdownG({ src }: { src: string }) {
  const out: ReactNode[] = [];
  let fence: string[] | null = null;
  let k = 0;
  for (const line of src.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (fence) {
        out.push(<pre key={k++} data-mono-ok="">{fence.join('\n')}</pre>);
        fence = null;
      } else fence = [];
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (/^#\s/.test(line)) out.push(<h3 key={k++}>{inline(line.slice(2))}</h3>);
    else if (/^##\s/.test(line)) out.push(<h4 key={k++}>{inline(line.slice(3))}</h4>);
    else if (/^###\s/.test(line)) out.push(<h5 key={k++}>{inline(line.slice(4))}</h5>);
    else if (/^---\s*$/.test(line)) out.push(<hr key={k++} />);
    else if (/^\s*[-*]\s/.test(line)) out.push(<p key={k++} className="wg-md-li">{inline(line.replace(/^\s*[-*]\s/, ''))}</p>);
    else if (line.trim() === '') out.push(<div key={k++} className="wg-md-gap" />);
    else out.push(<p key={k++}>{inline(line)}</p>);
  }
  if (fence) out.push(<pre key={k++} data-mono-ok="">{fence.join('\n')}</pre>);
  return <div className="wg-md">{out}</div>;
}

/* ── Intake (F-S1): propose, choose, create ───────────────────────────── */

type Placement = { domain: string; group: string; path: string };
type Proposal = { name: string; proposed: Placement; alternates: Placement[] };

function IntakeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [chosen, setChosen] = useState('0');
  const [created, setCreated] = useState<{ slug: string; path: string } | null>(null);

  const close = () => {
    onClose();
    setDescription('');
    setName('');
    setError(null);
    setProposal(null);
    setChosen('0');
    setCreated(null);
  };

  async function propose() {
    setError(null);
    if (description.trim().length < 8) return setError('Describe it in a bit more detail, at least a sentence.');
    setBusy(true);
    try {
      const res = await fetch('/api/skills/propose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: description.trim(), name: name.trim() || undefined }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setProposal(body as Proposal);
      setChosen('0');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!proposal) return;
    const placement = [proposal.proposed, ...proposal.alternates][Number(chosen)];
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: proposal.name, description: description.trim(), domain: placement.domain, group: placement.group }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCreated({ slug: body.slug, path: body.path });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const placements = proposal ? [proposal.proposed, ...proposal.alternates] : [];
  const footer = created ? (
    <GButton variant="ink" onClick={close}>
      Done
    </GButton>
  ) : proposal ? (
    <>
      <GButton onClick={() => setProposal(null)} disabled={busy}>
        Back
      </GButton>
      <GButton variant="ink" busy={busy} onClick={confirm}>
        Create draft skill
      </GButton>
    </>
  ) : (
    <>
      <GButton onClick={close}>Cancel</GButton>
      <GButton variant="ink" busy={busy} onClick={propose} disabled={!description.trim()} disabledReason="Describe the skill first">
        Propose placement
      </GButton>
    </>
  );

  return (
    <GSheet open={open} onClose={close} width={560} title="New skill" caption="Describe it; the placement is proposed from the real skill library." footer={footer}>
      <div className="wg-form">
        {created ? (
          <>
            <p className="wg-sk-done">
              Draft created at <span data-mono-ok="">{created.path}</span>
            </p>
            <p className="wg-cap">It is a stub: flesh it out before first use. It already shows in the hierarchy.</p>
          </>
        ) : (
          <>
            <GField label="What should this skill do?">
              <GTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={busy || !!proposal} />
            </GField>
            <GField label="Name" hint="Optional, kebab-case, for example invoice-chaser">
              <GInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy || !!proposal} />
            </GField>
            {proposal && (
              <GField label="Placement" hint={`Will be created at ${placements[Number(chosen)].path}`}>
                <GSegmented
                  label="Placement"
                  value={chosen}
                  onChange={setChosen}
                  options={placements.map((p, i) => ({ value: String(i), label: `${i === 0 ? 'Proposed' : 'Alternate'}: ${p.domain}/${p.group}` }))}
                />
              </GField>
            )}
          </>
        )}
        {error && <GErrorLine align="left">{error}</GErrorLine>}
      </div>
    </GSheet>
  );
}
