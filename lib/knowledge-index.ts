/**
 * The knowledge index — ONE graph over everything the OS knows about.
 *
 * The Optimal Engine observatory answers "what is in the brain store". This answers a
 * different and harder question: "what is connected to what, and how do I
 * know?" Every node is a real record (a page on disk, a skill directory, a
 * seeded agent/client/workflow row) and every edge carries the evidence that
 * produced it. Nothing here is decorative — if an edge cannot name its
 * source, it is not emitted.
 *
 * Edge kinds, strongest evidence first:
 *
 *   link     an author wrote [[target]] on the source page. Unambiguous.
 *   owns     a structural relation asserted by the database (agent → skill,
 *            agent → department). Unambiguous.
 *   mention  the target's name appears in the source's text. The evidence is
 *            the surrounding sentence, so a reader can judge it themselves.
 *   similar  the two documents share distinctive vocabulary (TF-IDF cosine).
 *            The evidence is the shared terms. This is the weakest kind and is
 *            the only one that is inferred rather than observed, so it is off
 *            by default in the UI.
 *
 * Mention matching is deliberately conservative. Several agents are named
 * after common English words (Future, Offset, Drake, Quill, Atlas). For those
 * the match requires exact capitalisation, which cuts the false-positive rate
 * to near zero at the cost of missing lowercase references — the right trade
 * when the whole point is that a shown connection is a true one.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readStoreNotes } from '@/lib/connectors/gbrain';
import { parseNote } from '@/lib/brain-graph';
import { readUserSkills, readSkillMarkdown } from '@/lib/skills-catalog';
import { brainStoreDir, skillsDir as skillsDirPath } from '@/lib/stores';
import { getDb } from '@/lib/data';

export type EntityKind = 'page' | 'skill' | 'agent' | 'person' | 'client' | 'workflow' | 'tool' | 'department';

export type EdgeKind = 'link' | 'owns' | 'mention' | 'similar';

export type KIEntity = {
  id: string;
  kind: EntityKind;
  label: string;
  /** folder for a page, department for an agent, group for a skill, sector for a client */
  cluster: string;
  /** one-line human summary shown in the focus panel */
  summary: string;
  /** words of body text — the mass of the record */
  words: number;
  /** days since last modified; null when the record has no meaningful mtime */
  days: number | null;
  /** where to go to read the real thing, when there is somewhere to go */
  href: string | null;
  /** on-disk location, for records that have one */
  source: string | null;
  /** top distinctive terms (TF-IDF), used for the similar edges and shown in the panel */
  terms: string[];
  /** other strings that refer to this record, searched for alongside the label */
  aliases?: string[];
};

export type KIEdge = {
  a: string;
  b: string;
  kind: EdgeKind;
  /** why this edge exists, in words a person can check */
  evidence: string;
  weight: number;
};

export type KnowledgeIndex = {
  mounted: boolean;
  entities: KIEntity[];
  edges: KIEdge[];
  /** counts by kind, for the legend */
  byKind: Record<string, number>;
  byEdgeKind: Record<string, number>;
  /** how the index was built, shown verbatim in the UI so nothing is implied */
  provenance: string[];
  builtAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Text utilities
// ─────────────────────────────────────────────────────────────────────────────

const STOP = new Set(
  ('a an the and or but if then than that this these those is are was were be been being it its of to in on ' +
    'for with as at by from into out up down over under again further once here there when where why how all ' +
    'any both each few more most other some such no nor not only own same so too very can will just should now ' +
    'we you they he she i our your their his her them us me my me do does did doing have has had having would ' +
    'could may might must shall about after before between during without within because while against page ' +
    'every never always one two three which what who whom whose also per via each rather instead every').split(/\s+/),
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w) && w.length < 24);
}

/** Words that are also agent/client names — matched case-sensitively only. */
const AMBIGUOUS = new Set([
  'future', 'drake', 'quill', 'atlas', 'conductor',
  'monitoring', 'slack', 'notion', 'wise', 'stripe', 'gamma', 'vertex', 'solace',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the first mention of `name` in `text`; returns the sentence around it.
 * Exported because the ambiguity rule is the load-bearing honesty decision in
 * this module and deserves to be pinned by tests.
 */
export function findMention(text: string, name: string): string | null {
  const single = !/\s/.test(name);
  const caseSensitive = single && AMBIGUOUS.has(name.toLowerCase());
  const re = new RegExp(`(^|[^\\w-])${escapeRe(name)}([^\\w-]|$)`, caseSensitive ? '' : 'i');
  const m = re.exec(text);
  if (!m) return null;

  // m.index points at the delimiter captured in group 1, not at the name.
  const at = m.index + m[1].length;
  const after = at + name.length;

  // Walk back to the start of the sentence the name sits in (or the start of
  // the text), then forward to the end of it.
  let start = Math.max(0, at - 240);
  for (let i = at - 1; i >= start; i--) {
    if (/[.\n!?]/.test(text[i])) {
      start = i + 1;
      break;
    }
  }
  let end = Math.min(text.length, after + 240);
  for (let i = after; i < end; i++) {
    if (/[.\n!?]/.test(text[i])) {
      end = i + 1;
      break;
    }
  }

  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return snippet.length > 4 ? snippet.slice(0, 220) : null;
}


// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF
// ─────────────────────────────────────────────────────────────────────────────

type Doc = { id: string; tf: Map<string, number>; len: number };

function buildTfIdf(docs: { id: string; text: string }[]): {
  terms: Map<string, string[]>;
  vectors: Map<string, Map<string, number>>;
} {
  const parsed: Doc[] = docs.map((d) => {
    const tf = new Map<string, number>();
    const toks = tokenize(d.text);
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: d.id, tf, len: Math.max(1, toks.length) };
  });
  const df = new Map<string, number>();
  for (const d of parsed) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  const N = Math.max(1, parsed.length);
  const terms = new Map<string, string[]>();
  const vectors = new Map<string, Map<string, number>>();

  for (const d of parsed) {
    const scored: [string, number][] = [];
    for (const [t, c] of d.tf) {
      const n = df.get(t) ?? 1;
      // Terms in more than 45% of documents describe the corpus, not the doc.
      if (n / N > 0.45) continue;
      scored.push([t, (c / d.len) * Math.log(N / n)]);
    }
    scored.sort((x, y) => y[1] - x[1]);
    const top = scored.slice(0, 24);
    terms.set(d.id, top.slice(0, 8).map(([t]) => t));
    // unit-normalised vector over the top terms, for cosine
    const norm = Math.sqrt(top.reduce((s, [, v]) => s + v * v, 0)) || 1;
    vectors.set(d.id, new Map(top.map(([t, v]) => [t, v / norm])));
  }
  return { terms, vectors };
}

function cosine(a: Map<string, number>, b: Map<string, number>): { score: number; shared: string[] } {
  let s = 0;
  const shared: string[] = [];
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, v] of small) {
    const w = large.get(t);
    if (w !== undefined) {
      s += v * w;
      shared.push(t);
    }
  }
  return { score: s, shared };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function buildKnowledgeIndex(): KnowledgeIndex {
  const provenance: string[] = [];
  const entities: KIEntity[] = [];
  const edges: KIEdge[] = [];
  const now = Date.now();

  // ── pages ────────────────────────────────────────────────────────────────
  const root = brainStoreDir();
  const rawNotes = readStoreNotes();
  const mounted = rawNotes.length > 0;
  provenance.push(
    mounted
      ? `${rawNotes.length} pages read from ${root}`
      : 'brain store not mounted — no pages in this index',
  );

  /** page slug (basename without extension) → entity id */
  const slugToId = new Map<string, string>();
  const pageText = new Map<string, string>();

  for (const n of rawNotes) {
    const note = parseNote(n.path, n.content);
    // readStoreNotes yields STORE-RELATIVE paths; everything on disk has to be
    // resolved against the root or the stat silently fails and every page looks
    // like it has no modification date.
    const rel = path.isAbsolute(n.path) ? path.relative(root, n.path) : n.path;
    const abs = path.isAbsolute(n.path) ? n.path : path.join(root, n.path);
    const folder = rel.includes('/') ? rel.split('/')[0] : 'root';
    const stem = path.basename(rel).replace(/\.md$/i, '');
    const id = `page:${rel}`;
    let days: number | null = null;
    try {
      days = Math.floor((now - fs.statSync(abs).mtimeMs) / DAY);
    } catch {
      days = null;
    }
    const body = note.body ?? '';
    const firstLine =
      body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('**')) ?? '';
    entities.push({
      id,
      kind: 'page',
      label: note.title || stem,
      cluster: folder,
      summary: firstLine.slice(0, 180),
      words: body.split(/\s+/).filter(Boolean).length,
      days,
      href: null,
      source: rel,
      terms: [],
    });
    slugToId.set(stem.toLowerCase(), id);
    pageText.set(id, `${note.title}\n${body}`);
  }

  // ── wikilinks between pages ──────────────────────────────────────────────
  let linkCount = 0;
  for (const [id, text] of pageText) {
    const seen = new Set<string>();
    for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      const target = slugToId.get(m[1].trim().toLowerCase());
      if (!target || target === id || seen.has(target)) continue;
      seen.add(target);
      edges.push({ a: id, b: target, kind: 'link', evidence: `wikilink [[${m[1].trim()}]]`, weight: 3 });
      linkCount++;
    }
  }
  provenance.push(`${linkCount} wikilinks resolved between pages`);

  // ── skills ───────────────────────────────────────────────────────────────
  const skills = readUserSkills();
  const skillText = new Map<string, string>();
  const skillsDir = skillsDirPath();
  for (const s of skills) {
    const id = `skill:${s.slug}`;
    const md = readSkillMarkdown(s.slug) ?? '';
    // A SKILL.md is a file like any other, so it has a real last-modified date.
    // Database rows genuinely do not, and stay out of the timeline rather than
    // being given an invented one.
    let skillDays: number | null = null;
    try {
      skillDays = Math.floor((now - fs.statSync(path.join(skillsDir, s.slug, 'SKILL.md')).mtimeMs) / DAY);
    } catch {
      skillDays = null;
    }
    entities.push({
      id,
      kind: 'skill',
      label: s.name,
      // Cluster on the DOMAIN half of "Domain/Group": the sub-groups belong to
      // the skill tree, and as graph clusters they were 30 slivers of two.
      cluster: s.group.includes('/') ? s.group.slice(0, s.group.indexOf('/')) : s.group,
      summary: s.description.slice(0, 180),
      words: md.split(/\s+/).filter(Boolean).length,
      days: skillDays,
      href: '/skills',
      source: s.path,
      terms: [],
      // Prose writes "client onboarding"; the directory is "client-onboarding".
      // Without the spaced alias the whole skill library reads as orphaned.
      aliases: [s.slug, s.slug.replace(/-/g, ' ')].filter((a) => a !== s.name),
    });
    skillText.set(id, `${s.name}\n${s.description}\n${md}`);
  }
  provenance.push(`${skills.length} skills read from the skill library`);

  // ── database records ─────────────────────────────────────────────────────
  const db = getDb();
  const departments = db.departments.all();
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  for (const d of departments) {
    entities.push({
      id: `department:${d.id}`,
      kind: 'department',
      label: d.name,
      cluster: 'Departments',
      summary: d.tagline,
      words: 0,
      days: null,
      href: '/org',
      source: null,
      terms: [],
    });
  }

  const agents = db.agents.all();
  for (const a of agents) {
    entities.push({
      id: `agent:${a.id}`,
      kind: 'agent',
      label: a.name,
      cluster: deptName.get(a.departmentId) ?? 'Unassigned',
      summary: a.role ?? '',
      words: 0,
      days: null,
      href: '/agents',
      source: null,
      terms: [],
    });
    edges.push({
      a: `agent:${a.id}`,
      b: `department:${a.departmentId}`,
      kind: 'owns',
      evidence: `${a.name} reports into ${deptName.get(a.departmentId) ?? a.departmentId}`,
      weight: 2,
    });
  }
  provenance.push(`${agents.length} agents and ${departments.length} departments from the database`);

  const contacts = db.funnel.journeys();
  for (const c of contacts) {
    entities.push({
      id: `client:${c.id}`,
      kind: 'client',
      label: c.name,
      cluster: 'Accounts',
      summary: `Furthest stage: ${c.status}${c.company ? ` · ${c.company}` : ''}`,
      words: 0,
      days: null,
      href: '/funnel',
      source: null,
      terms: [],
    });
  }

  const workflows = db.workflows.all();
  for (const w of workflows) {
    entities.push({
      id: `workflow:${w.id}`,
      kind: 'workflow',
      label: w.name,
      cluster: 'Workflows',
      summary: w.subtitle,
      words: 0,
      days: null,
      href: '/workflows',
      source: null,
      terms: [],
    });
  }

  const tools = db.tools.all();
  for (const t of tools) {
    entities.push({
      id: `tool:${t.id}`,
      kind: 'tool',
      label: t.name,
      cluster: 'Tools',
      summary: t.description,
      words: 0,
      days: null,
      href: '/integrations',
      source: null,
      terms: [],
    });
  }
  provenance.push(
    `${contacts.length} accounts, ${workflows.length} workflows, ${tools.length} tools from the database`,
  );

  // ── mentions: every named record, searched for in every body of text ─────
  // Only records with a name distinctive enough to match on are candidates;
  // one- and two-character names would match everything.
  const mentionTargets = entities.filter(
    (e) =>
      (e.kind === 'agent' ||
        e.kind === 'client' ||
        e.kind === 'workflow' ||
        e.kind === 'tool' ||
        e.kind === 'skill' ||
        e.kind === 'person') &&
      e.label.length >= 4,
  );
  const textSources: [string, string][] = [...pageText, ...skillText];

  let mentionCount = 0;
  for (const [srcId, text] of textSources) {
    for (const t of mentionTargets) {
      if (t.id === srcId) continue;
      let snippet: string | null = null;
      for (const name of [t.label, ...(t.aliases ?? [])]) {
        if (name.length < 4) continue;
        snippet = findMention(text, name);
        if (snippet) break;
      }
      if (!snippet) continue;
      edges.push({ a: srcId, b: t.id, kind: 'mention', evidence: `“${snippet}”`, weight: 1.5 });
      mentionCount++;
    }
  }
  provenance.push(`${mentionCount} name mentions found in page and skill text (exact-case for ambiguous names)`);

  // ── TF-IDF terms + similarity between documents ──────────────────────────
  const docs = textSources.map(([id, text]) => ({ id, text }));
  const { terms, vectors } = buildTfIdf(docs);
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const [id, ts] of terms) {
    const e = byId.get(id);
    if (e) e.terms = ts;
  }

  // Pairwise cosine over documents. ~380 docs → ~72k comparisons, trivial.
  const ids = [...vectors.keys()];
  const SIM_MIN = 0.34;
  const SIM_PER_NODE = 5;
  // Similarity is dense by nature: without a cap the inferred edges outnumber
  // the observed ones several times over and the graph stops being readable.
  // Each document keeps only its strongest few neighbours; an edge survives if
  // EITHER end ranked it, so a hub cannot crowd out a small page's best match.
  const candidates = new Map<string, { other: string; score: number; shared: string[] }[]>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const { score, shared } = cosine(vectors.get(ids[i])!, vectors.get(ids[j])!);
      if (score < SIM_MIN || shared.length < 3) continue;
      (candidates.get(ids[i]) ?? candidates.set(ids[i], []).get(ids[i])!).push({ other: ids[j], score, shared });
      (candidates.get(ids[j]) ?? candidates.set(ids[j], []).get(ids[j])!).push({ other: ids[i], score, shared });
    }
  }
  const keptPairs = new Map<string, { score: number; shared: string[] }>();
  for (const [id, list] of candidates) {
    list.sort((x, y) => y.score - x.score);
    for (const c of list.slice(0, SIM_PER_NODE)) {
      const key = id < c.other ? `${id}\u0000${c.other}` : `${c.other}\u0000${id}`;
      if (!keptPairs.has(key)) keptPairs.set(key, { score: c.score, shared: c.shared });
    }
  }
  for (const [key, v] of keptPairs) {
    const [a, b] = key.split('\u0000');
    edges.push({
      a,
      b,
      kind: 'similar',
      evidence: `shares distinctive vocabulary: ${v.shared.slice(0, 6).join(', ')}`,
      weight: v.score,
    });
  }
  provenance.push(
    `${keptPairs.size} vocabulary-similarity pairs kept (cosine \u2265 ${SIM_MIN}, top ${SIM_PER_NODE} per document)`,
  );

  const byKind: Record<string, number> = {};
  for (const e of entities) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const byEdgeKind: Record<string, number> = {};
  for (const e of edges) byEdgeKind[e.kind] = (byEdgeKind[e.kind] ?? 0) + 1;

  return { mounted, entities, edges, byKind, byEdgeKind, provenance, builtAt: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache — the build walks the whole store, so it runs once per store change
// ─────────────────────────────────────────────────────────────────────────────
let cache: { key: string; value: KnowledgeIndex } | null = null;

/**
 * Cache key = how many markdown files there are and the newest mtime among
 * them.
 *
 * The first version stat'd the store ROOT and used its mtime, which was wrong
 * in the most ordinary case there is: a directory's mtime only moves when an
 * entry is added or removed IN that directory, so editing `Clients/foo.md`
 * left the key unchanged and the page served a stale graph until the server
 * restarted. Walking the tree costs a few milliseconds even on a large store —
 * far less than the rebuild it is deciding whether to skip.
 */
function storeKey(): string {
  const root = brainStoreDir();
  let count = 0;
  let newest = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return; // the store is a knowledge base, not a filesystem
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.md')) {
        count++;
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* a file that vanished mid-walk simply does not count */
        }
      }
    }
  };
  walk(root, 0);
  if (count === 0) return 'unmounted';
  return `${root}:${count}:${newest}:${skillsDirPath()}`;
}

export function knowledgeIndex(): KnowledgeIndex {
  const key = storeKey();
  if (cache && cache.key === key) return cache.value;
  const value = buildKnowledgeIndex();
  cache = { key, value };
  return value;
}
