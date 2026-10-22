import fs from 'node:fs';
import os from 'node:os';
import { skillsDir } from '@/lib/stores';
import path from 'node:path';

/**
 * Reads the operator's real Claude Code skills from ~/.claude/skills/<name>/SKILL.md,
 * honest about what's on disk (empty list when the directory is absent). The
 * full SKILL.md is loaded on demand via readSkillMarkdown so the /skills page
 * ships light. Frontmatter parsing is pure + tested.
 */

export type CatalogSkill = {
  slug: string; // directory name
  name: string; // frontmatter `name` (falls back to the slug)
  description: string; // frontmatter `description` (inline or block scalar)
  group: string; // display grouping
  path: string; // ~-relative path to the SKILL.md, for the reader header
};

/**
 * The library root. GLADOS_SKILLS_DIR lets the filming clone point at its own
 * (larger) library without changing how production reads ~/.claude/skills.
 */
const SLUG_RE = /^[a-zA-Z0-9._-]+$/;

/** Read one frontmatter field, handling inline, quoted, and block scalars (| / >). */
function readField(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!m) continue;
    const inline = m[1].trim();
    if (/^[|>][+-]?$/.test(inline)) {
      // block scalar: gather the following indented (or blank) lines
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '' || /^\s/.test(l)) block.push(l);
        else break;
      }
      // dedent by the smallest indent among non-blank lines
      const indents = block.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)![0].length);
      const strip = indents.length ? Math.min(...indents) : 0;
      const dedented = block.map((l) => l.slice(strip));
      const folded = inline.startsWith('>');
      const joined = folded ? dedented.join(' ') : dedented.join('\n');
      return joined.replace(/\s+$/, '').replace(/^\s+/, '');
    }
    return inline.replace(/^["']|["']$/g, '');
  }
  return undefined;
}

export function parseSkillFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = m[1];
  const out: { name?: string; description?: string } = {};
  const name = readField(fm, 'name');
  const description = readField(fm, 'description');
  if (name !== undefined) out.name = name;
  if (description !== undefined) out.description = description;
  return out;
}

/**
 * Scope taxonomy: WHERE a skill lives — the guidance boundary it belongs to.
 * Derived from slug conventions in ~/.claude/skills so the hierarchy on
 * /skills reflects what's on disk. Brand-scoped skills (prefix `<brand>-`)
 * never apply outside their brand; add your brands to BRAND_PREFIXES.
 */
const BRAND_PREFIXES: string[] = [];

export function skillGroup(name: string): string {
  const n = name.toLowerCase();
  for (const brand of BRAND_PREFIXES) {
    if (n.startsWith(brand)) return `Brands/${brand.charAt(0).toUpperCase()}${brand.slice(1)}`;
  }
  if (n.includes('voice')) return 'Voice/Registers';
  if (/^\d\d-/.test(n)) return 'Content/Video prompts';
  if (['reel', 'watch', 'youtube-transcribe'].includes(n)) return 'Content/Analysis';
  if (n.includes('deck') || n.includes('slide') || n.includes('futurism') || n.includes('design'))
    return 'Design/Decks & slides';
  if (n === 'attack-surface-audit') return 'Engineering/Security';
  if (['learn', 'find-skills', 'skill-distiller'].includes(n) || n.startsWith('glados') || n.startsWith('os-'))
    return 'Operating system/Meta';
  return 'General/Uncategorised';
}

/** Split a "Domain/Group" path into its two levels (a bare name becomes its own domain). */
export function splitGroup(group: string): { domain: string; group: string } {
  const i = group.indexOf('/');
  if (i === -1) return { domain: group, group };
  return { domain: group.slice(0, i), group: group.slice(i + 1) };
}


/** List the real skills on disk (metadata only). Empty when the dir is absent. */
export function readUserSkills(dir: string = skillsDir()): CatalogSkill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: CatalogSkill[] = [];
  for (const e of entries) {
    // Read <name>/SKILL.md for every entry — no isDirectory() gate, because many
    // skills (firecrawl-*) are symlinks, for which isDirectory() is false. The
    // read attempt filters out plain files (auto-mode.md) and dirs without one.
    const file = path.join(dir, e.name, 'SKILL.md');
    let md: string;
    try {
      md = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // not a skill dir (plain file, or no SKILL.md)
    }
    const fm = parseSkillFrontmatter(md);
    const name = fm.name ?? e.name;
    // A skill may declare its own place in the tree with a GROUP file; that
    // beats the slug heuristic, which only exists for skills that say nothing.
    let group: string;
    try {
      group = fs.readFileSync(path.join(dir, e.name, 'GROUP'), 'utf8').trim() || skillGroup(e.name);
    } catch {
      group = skillGroup(e.name);
    }
    out.push({
      slug: e.name,
      name,
      description: fm.description ?? '',
      // scope from the DIRECTORY slug — the on-disk location is the guidance
      // boundary; frontmatter names drop prefixes (01-cinematic → cinematic)
      group,
      path: `~/.claude/skills/${e.name}/SKILL.md`,
    });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** Read one skill's full SKILL.md. Null on a bad slug or missing file (honest). */
export function readSkillMarkdown(slug: string, dir: string = skillsDir()): string | null {
  if (!SLUG_RE.test(slug)) return null; // no path traversal
  try {
    return fs.readFileSync(path.join(dir, slug, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * New-skill intake (2026-09-01): "Describe a new skill" composer on /skills
 * proposes where a skill would live and, on confirm, writes a real draft
 * SKILL.md + GROUP file into the same dir readUserSkills() reads — so it
 * shows up in the hierarchy on the next load. Everything below is pure and
 * deterministic (no fs) except `createDraftSkill`, which is the one write.
 */

/** Directory-safe kebab-case: lowercase, ascii, hyphen-joined, no path chars. */
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function toKebabCase(input: string, maxLen = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (post-NFKD combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLen).replace(/-+$/, '');
}

const NAME_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'that', 'this', 'it', 'is', 'are', 'be', 'on', 'in',
  'with', 'my', 'our', 'i', 'want', 'wants', 'wanted', 'need', 'needs', 'should', 'would', 'can', 'you',
  'skill', 'new', 'that', 'when', 'about', 'into', 'from', 'me', 'us', 'so', 'do', 'does',
]);

/** First few meaningful words of a description, kebab-cased, as a fallback name. */
export function deriveSkillName(description: string, maxWords = 5): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NAME_STOPWORDS.has(w));
  const base = words.slice(0, maxWords).join('-') || 'draft-skill';
  return toKebabCase(base, 40) || 'draft-skill';
}

const PLACEMENT_STOPWORDS = NAME_STOPWORDS;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PLACEMENT_STOPWORDS.has(w));
}

export type PlacementGuess = { domain: string; group: string };

/**
 * Where a new skill's description best fits in the REAL taxonomy: token
 * overlap between the description and each existing "Domain/Group" bucket's
 * corpus (its own name plus every skill's name + description in it).
 * Deterministic — ties break alphabetically. Pure, so no catalog read here;
 * the caller passes `readUserSkills()`'s output. Returns up to 3 candidates,
 * best first (the caller treats [0] as "proposed" and the rest as alternates).
 */
export function proposePlacement(description: string, catalog: CatalogSkill[]): PlacementGuess[] {
  const qTokens = new Set(tokenize(description));

  const corpora = new Map<string, Set<string>>(); // "Domain/Group" -> tokens
  for (const skill of catalog) {
    const set = corpora.get(skill.group) ?? new Set<string>();
    for (const t of tokenize(skill.name)) set.add(t);
    for (const t of tokenize(skill.description)) set.add(t);
    for (const t of tokenize(skill.group.replace('/', ' '))) set.add(t);
    corpora.set(skill.group, set);
  }

  if (corpora.size === 0) return [{ domain: 'General', group: 'Uncategorised' }];

  const scored = [...corpora.entries()].map(([groupPath, tokens]) => {
    const { domain, group } = splitGroup(groupPath);
    let score = 0;
    for (const t of qTokens) if (tokens.has(t)) score++;
    return { domain, group, score };
  });

  scored.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain) || a.group.localeCompare(b.group));
  return scored.slice(0, 3).map(({ domain, group }) => ({ domain, group }));
}

export type CreateDraftResult =
  | { ok: true; slug: string; path: string }
  | { ok: false; error: string };

/**
 * Writes a real draft skill: `<dir>/<name>/SKILL.md` + a `GROUP` file
 * carrying "Domain/Group" (readUserSkills() prefers GROUP over the slug
 * heuristic, so the draft lands exactly where the intake proposed). Refuses
 * a name that doesn't sanitize to plain kebab-case, any write outside `dir`,
 * a missing/unwritable dir, and a slug collision — no pretend success.
 */
export function createDraftSkill(
  rawName: string,
  description: string,
  domain: string,
  group: string,
  dir: string,
): CreateDraftResult {
  const name = toKebabCase(rawName);
  if (!name || !KEBAB_RE.test(name)) return { ok: false, error: 'skill name must be kebab-case (letters, numbers, hyphens)' };
  if (!description.trim()) return { ok: false, error: 'description is required' };
  if (!domain.trim() || !group.trim()) return { ok: false, error: 'domain and group are required' };

  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(dir);
  } catch {
    return { ok: false, error: `skills directory not found: ${dir}` };
  }
  if (!dirStat.isDirectory()) return { ok: false, error: `not a directory: ${dir}` };

  const resolvedRoot = path.resolve(dir);
  const skillDir = path.resolve(resolvedRoot, name);
  // Belt + suspenders on top of KEBAB_RE (which already forbids '.', '/', '..'):
  // the resolved path must land strictly inside the skills dir.
  if (skillDir !== path.join(resolvedRoot, name) || !skillDir.startsWith(resolvedRoot + path.sep)) {
    return { ok: false, error: 'invalid skill name' };
  }
  if (fs.existsSync(skillDir)) return { ok: false, error: `a skill named "${name}" already exists` };

  try {
    fs.mkdirSync(skillDir);
  } catch (err) {
    return { ok: false, error: `could not create skill directory: ${(err as Error).message}` };
  }

  const groupPath = `${domain.trim()}/${group.trim()}`;
  const desc = description.trim().replace(/\s+/g, ' ');
  const md = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    '---',
    '',
    description.trim(),
    '',
    'Draft — flesh out before first use.',
    '',
  ].join('\n');

  try {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), md, 'utf8');
    fs.writeFileSync(path.join(skillDir, 'GROUP'), `${groupPath}\n`, 'utf8');
  } catch (err) {
    return { ok: false, error: `could not write skill files: ${(err as Error).message}` };
  }

  return { ok: true, slug: name, path: `${groupPath}/${name}` };
}

/** Same GLADOS_SKILLS_DIR resolution as the module default, but re-read on
 * every call — route handlers use this (rather than the SKILLS_DIR const
 * captured at import time) so tests can point at a fresh temp dir per call. */
export function resolveSkillsDir(): string {
  return skillsDir();
}
