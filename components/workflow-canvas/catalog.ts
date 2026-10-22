/* Node catalog for the workflow canvas. Ported from the design sandbox
   (~/Desktop/UI design examples/ai flowchart example 2/data.js) on
   2026-09-15. Icons are inline stroke paths (Lucide language): never emoji. */
/* eslint-disable */
export type Field = { key: string; label: string; type: 'select' | 'text' | 'toggle' | 'number'; options?: string[]; default?: unknown; unit?: string };
export type NodeType = {
  cat: string; label: string; sub: string; icon: string; shape: 'card' | 'square';
  ports: { in?: boolean; out?: boolean; top?: boolean; outs?: string[]; subs?: string[] };
  ownerKind: 'human' | 'agent'; hours: number; inline?: boolean; fields: Field[];
};

export const ICONS: Record<string, string> = {
  mail: '<path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path d="m3 7 9 6 9-6"/>',
  send: '<path d="m21 3-9 9"/><path d="M21 3 14 21l-2.5-8.5L3 10z"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01"/><path d="M9 17h6"/><path d="M2 13h2M20 13h2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  branch: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 6v12"/><path d="M18 10a6 6 0 0 1-6 6H8"/>',
  merge: '<circle cx="18" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 8v2a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4"/><path d="M18 8v8"/>',
  loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-6h8v6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  play: '<path d="M6 4v16l14-8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 4-4 16"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  wand: '<path d="m15 4 5 5L7 22H2v-5z"/><path d="m13 6 5 5"/><path d="M19 2v2M21 4h2M17 4h2M19 6v2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V4a1.5 1.5 0 0 1 3 0v7"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-12 0v-3a1.5 1.5 0 0 1 3 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7 15h10"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  hourglass: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3v4a5 5 0 0 0 10 0V3"/><path d="M7 21v-4a5 5 0 0 1 10 0v4"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  workflow: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/>',
  brain: '<path d="M9.5 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5.5A3 3 0 0 0 9.5 21c1 0 2-.4 2.5-1V4c-.5-.6-1.5-1-2.5-1z"/><path d="M14.5 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5.5A3 3 0 0 1 14.5 21c-1 0-2-.4-2.5-1V4c.5-.6 1.5-1 2.5-1z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  camera: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M9 6l1-2h4l1 2"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 10v7M8 7h.01"/><path d="M12 17v-4a2 2 0 0 1 4 0v4"/><path d="M12 10v7"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6H5V6h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  notion: '<path d="M5 4h11l3 2v14H8L5 18z"/><path d="M9 8v8M9 8l6 8V8"/>',
  attio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  sheets: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
  youtube: '<path d="M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="m10 9 5 3-5 3z"/>',
  telegram: '<path d="m21 4-4 16-6-5-3 3v-5l9-8"/><path d="m3 11 18-7"/>',
  claude: '<path d="M12 3c1.5 3.5 3 5.5 6.5 7-3.5 1.5-5 3.5-6.5 7-1.5-3.5-3-5.5-6.5-7C9 8.5 10.5 6.5 12 3z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  premiere: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 17V7h4a3 3 0 0 1 0 6H8"/><path d="M15 17v-6"/>',
  chevUp: '<path d="m6 15 6-6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  vector: '<path d="M4 20 20 4"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="12" r="2"/>',
};


export function icon(name: string, cls?: string): string {
  const d = ICONS[name] || ICONS.circle;
  return `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

export const CATEGORIES = [
  { id: 'trigger', label: 'Triggers', sub: 'Start the flow from an event.', icon: 'zap' },
  { id: 'ai', label: 'AI', sub: 'Automate with agents & queries.', icon: 'bot' },
  { id: 'app', label: 'Action in an app', sub: 'Execute in Gmail, Telegram, Notion.', icon: 'globe' },
  { id: 'transform', label: 'Data transformation', sub: 'Manipulate, filter or convert data.', icon: 'wand' },
  { id: 'flow', label: 'Flow', sub: 'Branch, merge or loop the flow.', icon: 'branch' },
  { id: 'core', label: 'Core', sub: 'Code and HTTP actions.', icon: 'code' },
  { id: 'human', label: 'Human in the loop', sub: 'Wait for user action.', icon: 'user' },
];

const F = {
  credential: (opts: string[]): Field => ({ key: 'credential', label: 'Credential to connect with', type: 'select', options: opts }),
  text: (key: string, label: string, def: string): Field => ({ key, label, type: 'text', default: def }),
  select: (key: string, label: string, options: string[], def?: string): Field => ({ key, label, type: 'select', options, default: def || options[0] }),
  toggle: (key: string, label: string, def: boolean): Field => ({ key, label, type: 'toggle', default: !!def }),
  number: (key: string, label: string, def: number, unit?: string): Field => ({ key, label, type: 'number', default: def, unit }),
};

export const NODE_TYPES: Record<string, NodeType> = {
  /* ── triggers ── */
  'trigger-gmail': { cat: 'trigger', label: 'Inbound email', sub: 'Gmail', icon: 'mail', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Shared inbox', 'Personal inbox']), F.text('filter', 'Only when subject contains', 'sponsor OR collab OR partnership')] },
  'trigger-telegram': { cat: 'trigger', label: 'Telegram message', sub: 'When a message arrives', icon: 'telegram', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Agent bot']), F.text('chat', 'From chat', 'Operator (allowlist)')] },
  'trigger-schedule': { cat: 'trigger', label: 'Schedule', sub: 'Run on a timer', icon: 'clock', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.select('cadence', 'Cadence', ['Every weekday 06:30', 'Monday 09:00', '1st of the month', 'Every 5 minutes']), F.select('tz', 'Timezone', ['America/Vancouver', 'UTC'])] },
  'trigger-webhook': { cat: 'trigger', label: 'Webhook', sub: 'POST to an endpoint', icon: 'link', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.text('path', 'Path', '/hooks/inbound'), F.select('auth', 'Authentication', ['Header token', 'None'])] },
  'trigger-form': { cat: 'trigger', label: 'Calendly booking', sub: 'New discovery call', icon: 'calendar', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Calendly']), F.select('event', 'Event type', ['Discovery call', 'Walkthrough'])] },
  'trigger-crm': { cat: 'trigger', label: 'Deal stage changed', sub: 'Attio record update', icon: 'attio', shape: 'square', ports: { out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Attio']), F.select('stage', 'When stage becomes', ['Won', 'Proposal sent', 'Lost'])] },

  /* ── ai ── */
  'ai-agent': { cat: 'ai', label: 'AI Agent', sub: 'Tools Agent', icon: 'bot', shape: 'card', ports: { in: true, out: true, subs: ['model', 'memory', 'tool'] }, ownerKind: 'agent', hours: 1, fields: [F.text('prompt', 'Instructions', 'Draft the reply from the rate card.'), F.select('output', 'Output', ['Gmail draft', 'Structured JSON', 'Plain text']), F.number('auditEveryDays', 'Audit every', 3, 'days'), F.number('staleDays', 'Stale after', 3, 'days'), F.number('maxRetry', 'Max retries', 8)] },
  'ai-model': { cat: 'ai', label: 'Claude model', sub: 'Chat model', icon: 'claude', shape: 'square', ports: { top: true }, ownerKind: 'agent', hours: 0, inline: true, fields: [F.credential(['Anthropic']), F.select('model', 'Model', ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'])] },
  'ai-memory': { cat: 'ai', label: 'Memory', sub: 'SQLite chat memory', icon: 'db', shape: 'square', ports: { top: true }, ownerKind: 'agent', hours: 0, inline: true, fields: [F.select('store', 'Store', ['glados.db', 'ledger.db']), F.number('window', 'Context window', 20, 'turns')] },
  'ai-vector': { cat: 'ai', label: 'Vector store', sub: 'Brain retrieval', icon: 'layers', shape: 'card', ports: { top: true, subs: ['embed'] }, ownerKind: 'agent', hours: 0, fields: [F.select('index', 'Index', ['Optimal Engine', 'Knowledge']), F.number('topK', 'Top K', 6)] },
  'ai-tool': { cat: 'ai', label: 'Tool', sub: 'Callable by the agent', icon: 'cpu', shape: 'square', ports: { top: true }, ownerKind: 'agent', hours: 0, inline: true, fields: [F.select('tool', 'Tool', ['Rate card lookup', 'Gmail thread fetch', 'Attio record fetch', 'Calendar availability'])] },
  'ai-classify': { cat: 'ai', label: 'Classifier', sub: 'Tag the inbound', icon: 'spark', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.text('uniqueHints', 'UNIQUE hints', 'event, retainer, equity'), F.text('dealHints', 'Deal hints', 'sponsor, collab, budget')] },
  'ai-qualify': { cat: 'ai', label: 'Qualify', sub: 'Score the fit', icon: 'shield', shape: 'card', ports: { in: true, outs: ['yes', 'no'] }, ownerKind: 'agent', hours: 0, fields: [F.text('criteria', 'Qualification criteria', 'STRONG fit: AI tools, dev tools, automation platforms.'), F.number('passBelow', 'Pass below', 25, '/100'), F.text('yes', 'Fits label', 'fits'), F.text('no', 'Below label', 'below threshold')] },

  /* ── apps ── */
  'app-gsend': { cat: 'app', label: 'Send email', sub: 'gsend · Gmail API', icon: 'send', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, inline: true, fields: [F.credential(['Shared inbox']), F.select('mode', 'Send mode', ['Queue for approval', 'Send immediately']), F.toggle('commit', 'Commit before fire (no double send)', true)] },
  'app-telegram': { cat: 'app', label: 'Telegram announce', sub: 'bdpilot bot', icon: 'telegram', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['bdpilot bot']), F.text('template', 'Message', 'New inbound: {{brand}} · {{summary}}'), F.toggle('buttons', 'Attach SEND / SKIP buttons', true)] },
  'app-notion': { cat: 'app', label: 'Notion page', sub: 'Create or update', icon: 'notion', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Notion']), F.select('db', 'Database', ['Deal log', 'Content calendar', 'Client workspaces'])] },
  'app-sheets': { cat: 'app', label: 'Google Sheets row', sub: 'Append a row', icon: 'sheets', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Google Drive']), F.text('sheet', 'Spreadsheet', 'Invoices 2026')] },
  'app-instagram': { cat: 'app', label: 'Instagram post', sub: 'Your account', icon: 'instagram', shape: 'card', ports: { in: true, out: true }, ownerKind: 'human', hours: 1, fields: [F.select('format', 'Format', ['Reel', 'Carousel', 'Story'])] },
  'app-youtube': { cat: 'app', label: 'YouTube upload', sub: 'Long-form', icon: 'youtube', shape: 'card', ports: { in: true, out: true }, ownerKind: 'human', hours: 1, fields: [F.select('visibility', 'Visibility', ['Scheduled', 'Public', 'Unlisted'])] },
  'app-linkedin': { cat: 'app', label: 'LinkedIn post', sub: 'Founder profile', icon: 'linkedin', shape: 'card', ports: { in: true, out: true }, ownerKind: 'human', hours: 1, fields: [F.select('format', 'Format', ['Text + image', 'Document', 'Video'])] },
  'app-attio': { cat: 'app', label: 'Attio record', sub: 'Create deal', icon: 'attio', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Attio']), F.select('object', 'Object', ['Deal', 'Company', 'Person'])] },
  'app-calendar': { cat: 'app', label: 'Calendar hold', sub: 'Google Calendar', icon: 'calendar', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.credential(['Primary calendar']), F.number('minutes', 'Duration', 30, 'min')] },

  /* ── transform ── */
  'tx-filter': { cat: 'transform', label: 'Filter', sub: 'Drop items that fail', icon: 'filter', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.text('rule', 'Keep when', 'brand.followers > 50k')] },
  'tx-format': { cat: 'transform', label: 'Format', sub: 'Shape the payload', icon: 'wand', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.select('into', 'Into', ['Markdown', 'JSON', 'Plain text'])] },
  'tx-extract': { cat: 'transform', label: 'Extract fields', sub: 'Pull structured data', icon: 'file', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.text('fields', 'Fields', 'brand, budget, deliverables, deadline')] },
  'tx-summarize': { cat: 'transform', label: 'Summarize', sub: 'Compress a thread', icon: 'chat', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.number('sentences', 'Length', 3, 'sentences')] },

  /* ── flow ── */
  'flow-branch': { cat: 'flow', label: 'Branch', sub: 'Route on a condition', icon: 'branch', shape: 'card', ports: { in: true, outs: ['yes', 'no'] }, ownerKind: 'agent', hours: 0, fields: [F.text('condition', 'Condition', 'approval == "SEND"'), F.text('yes', 'Yes label', 'approved'), F.text('no', 'No label', 'skipped')] },
  'flow-merge': { cat: 'flow', label: 'Merge', sub: 'Wait for every branch', icon: 'merge', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.select('mode', 'Mode', ['Wait for all', 'First to arrive'])] },
  'flow-loop': { cat: 'flow', label: 'Loop', sub: 'Once per item', icon: 'loop', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.number('batch', 'Batch size', 1)] },
  'flow-wait': { cat: 'flow', label: 'Wait', sub: 'Pause the run', icon: 'hourglass', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.number('days', 'Wait', 3, 'days'), F.toggle('resume', 'Resume early on reply', true)] },

  /* ── core ── */
  'core-code': { cat: 'core', label: 'Code', sub: 'Run a script', icon: 'code', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.select('runtime', 'Runtime', ['Node 22', 'Python 3.12']), F.text('entry', 'Entry', 'scripts/mark-paid.ts')] },
  'core-http': { cat: 'core', label: 'HTTP request', sub: 'Call an endpoint', icon: 'globe', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.select('method', 'Method', ['POST', 'GET', 'PATCH']), F.text('url', 'URL', 'https://api.example.com/deals')] },
  'core-set': { cat: 'core', label: 'Set variable', sub: 'Store a value', icon: 'table', shape: 'card', ports: { in: true, out: true }, ownerKind: 'agent', hours: 0, fields: [F.text('name', 'Name', 'dealState'), F.text('value', 'Value', 'drafted')] },

  /* ── human ── */
  'human-approve': { cat: 'human', label: 'Approve from Telegram', sub: 'Operator', icon: 'hand', shape: 'card', ports: { in: true, outs: ['yes', 'no'] }, ownerKind: 'human', hours: 1, fields: [F.select('who', 'Who approves', ['Operator', 'Team member']), F.number('timeout', 'Escalate after', 24, 'h'), F.toggle('edit', 'Allow edit-by-reply', true), F.text('yes', 'Approve label', 'SEND'), F.text('no', 'Reject label', 'SKIP')] },
  'human-review': { cat: 'human', label: 'Review in dashboard', sub: 'Human check', icon: 'eye', shape: 'card', ports: { in: true, out: true }, ownerKind: 'human', hours: 1, fields: [F.select('who', 'Reviewer', ['Operator', 'Team member'])] },
  'human-task': { cat: 'human', label: 'Manual task', sub: 'Done by a person', icon: 'user', shape: 'card', ports: { in: true, out: true }, ownerKind: 'human', hours: 4, fields: [F.select('who', 'Owner', ['Operator', 'Team member', 'Editor']), F.number('hours', 'Hours per week', 4, 'h')] },
};


export const HUE: Record<string, string> = { 'trigger-gmail': 'red', 'trigger-telegram': 'blue', 'trigger-schedule': 'mint', 'trigger-webhook': 'mint', 'trigger-form': 'blue', 'trigger-crm': 'amber', 'ai-model': 'mint', 'ai-memory': 'blue', 'ai-vector': 'violet', 'ai-classify': 'mint', 'ai-qualify': 'mint', 'app-gsend': 'mint', 'app-telegram': 'blue', 'app-sheets': 'mint', 'app-instagram': 'violet', 'app-youtube': 'red', 'app-linkedin': 'blue', 'app-attio': 'amber', 'app-calendar': 'blue', 'human-approve': 'violet', 'human-review': 'violet', 'human-task': 'violet' };
export const SUB_LABEL: Record<string, string> = { model: 'Model', memory: 'Memory', tool: 'Tool', embed: 'Embeddings' };
export const RULE_LABEL: Record<string, string> = { pass_below: 'pass threshold', qual_criteria: 'qualification criteria', draft_rules: 'drafting rules', unique_hints: 'UNIQUE hints', deal_hints: 'deal hints', audit_every_days: 'audit cadence', stale_days: 'stale after', max_retry_attempts: 'max retries' };
