import { NAV_EXTRA, NAV_ITEMS, groupOf } from '@/lib/nav';

/** Window events a palette command can fire instead of navigating. */
export type CommandAction = 'sidebar:toggle';

export type Command = {
  id: string;
  label: string;
  keywords: string;
  /** Where the command goes: an app path, or an https link opened in a new tab. */
  href?: string;
  /** Fired as a window event instead of navigating (SPEC S09 FR-15). */
  action?: CommandAction;
  hint?: string;
};

/**
 * Every whitespace-separated term must match label or keywords. Results are
 * ranked: label prefix > label substring > keyword-only match.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return commands;

  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${command.keywords.toLowerCase()}`;
    if (!terms.every((t) => haystack.includes(t))) continue;
    let score = 0;
    for (const term of terms) {
      if (label.startsWith(term)) score += 3;
      else if (label.includes(term)) score += 2;
      else score += 1;
    }
    scored.push({ command, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.command);
}

/** The palette's view commands, derived from the nav (SPEC S12 FR-3, §5 C34):
 *  every sidebar item plus the palette-only NAV_EXTRA views. The group title
 *  joins the keywords, so typing "system" or "growth" lists that group. */
export function viewCommands(): Command[] {
  return [...NAV_ITEMS, ...NAV_EXTRA].map((item) => {
    const group = groupOf(item.href)?.title;
    const slug = item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: `nav-${slug}`,
      label: item.label,
      keywords: group ? `${item.keywords} ${group.toLowerCase()}` : item.keywords,
      href: item.href,
      hint: 'view',
    };
  });
}

/** External surfaces, opened in a new tab: the only hand-written commands
 *  (app/layout.tsx appends agents and tools from the DB). */
export const EXTERNAL_COMMANDS: Command[] = [
  { id: 'ext-attio', label: 'Attio CRM', keywords: 'deals pipeline crm', href: 'https://app.attio.com', hint: 'web' },
  { id: 'ext-fathom', label: 'Fathom Calls', keywords: 'meetings recordings notes', href: 'https://fathom.video', hint: 'web' },
];

/** Shell actions: no destination, a window event the shell listens for. */
export const ACTION_COMMANDS: Command[] = [
  {
    id: 'ui-sidebar',
    label: 'Toggle sidebar',
    keywords: 'collapse expand minimize minimise rail nav navigation sidebar',
    hint: '⌘\\',
    action: 'sidebar:toggle',
  },
];
