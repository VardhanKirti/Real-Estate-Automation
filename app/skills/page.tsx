import { getDb } from '@/lib/data';
import { PageHeader } from '@/components/PageHeader';
import type { SkillCard } from '@/components/SkillsGrid';
import { SkillsExplorer } from '@/components/SkillsExplorer';
import { readUserSkills } from '@/lib/skills-catalog';
import { NewSkillIntake } from '@/app/skills/NewSkillIntake';
import { SkillsG } from '@/components/skills/SkillsG';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';

export const dynamic = 'force-dynamic';

const truncate = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t);

export default function SkillsPage() {
  const real = readUserSkills();

  let cards: SkillCard[];
  let sourceNote: string;

  if (real.length > 0) {
    // Live from disk — the full SKILL.md loads on demand via /api/skills/[slug].
    cards = real.map((s) => ({
      id: s.slug,
      name: s.name,
      group: s.group,
      description: truncate(s.description),
      meta: s.path,
      filePath: s.path,
    }));
    sourceNote = `${real.length} skills read live from ~/.claude/skills — open any card to read its SKILL.md.`;
  } else {
    // Fallback: the seeded catalog (docs carried inline).
    const db = getDb();
    const agentNames = Object.fromEntries(db.agents.all().map((a) => [a.id, a.name]));
    cards = db.skills.all().map((s) => ({
      id: s.id,
      name: s.name,
      group: s.category,
      description: truncate(s.description),
      meta: s.ownerAgentId ? (agentNames[s.ownerAgentId] ?? s.ownerAgentId) : 'unassigned',
      filePath: `skills/${s.id}/SKILL.md`,
      status: s.status,
      markdown: s.markdown,
    }));
    sourceNote = 'Seeded catalog — no ~/.claude/skills found on this machine.';
  }

  // GladOS tree (glados-ui SPEC S04 §4.5, X5): same cards, kit presentation.
  if (treeFor(getAppearance(), '/skills') === 'glados') {
    const live = real.length > 0;
    return <SkillsG cards={cards} sourceNote={live ? `${real.length} skills · live from ~/.claude/skills` : 'Seeded catalog · no ~/.claude/skills on this machine'} />;
  }

  return (
    <div>
      <PageHeader eyebrow="Capability library" title="Skills" />
      <NewSkillIntake />
      <SkillsExplorer cards={cards} sourceNote={sourceNote} />
    </div>
  );
}
