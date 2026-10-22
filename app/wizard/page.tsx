import { getDb } from '@/lib/data';
import { readProjects } from '@/lib/wizard/store';
import { buildCrew } from '@/lib/wizard/crew';
import { WizardWorkspace } from '@/components/wizard/WizardWorkspace';
import { WizardG } from '@/components/wizard/WizardG';
import { WizardL } from '@/components/wizard/WizardL';
import { isFilming } from '@/lib/demo-mode';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { buildAgentDirectory } from '@/lib/agent-directory';

export const dynamic = 'force-dynamic';

/**
 * Wizard — the chat you run the system through. A project is a
 * conversation; the crew panel is real run history. Server component
 * gathers the roster, projects and crew snapshot and hands them to the
 * client workspace. No PageHeader — the Wizard owns its chrome.
 */
export default function WizardPage() {
  const db = getDb();
  // GladOS tree (glados-ui SPEC S04 §4.6, X5): same state hook, kit presentation.
  const tree = treeFor(getAppearance(), '/wizard');
  if (tree === 'glados') {
    return <WizardG agents={db.agents.all()} departments={db.departments.all()} initialProjects={readProjects()} initialCrew={buildCrew(db)} dir={buildAgentDirectory(db)} />;
  }
  // Bennett Legacy tree (founderos-ui pages/wizard.md): same hook, FO chat shell.
  if (tree === 'legacy') {
    return <WizardL agents={db.agents.all()} departments={db.departments.all()} initialProjects={readProjects()} initialCrew={buildCrew(db)} filming={isFilming()} />;
  }
  return <WizardWorkspace agents={db.agents.all()} departments={db.departments.all()} initialProjects={readProjects()} initialCrew={buildCrew(db)} />;
}
