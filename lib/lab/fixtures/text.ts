/**
 * Hand-written fictional text for the v2 fixture layers (08.7.2): launch names, ping titles,
 * comments, test hooks and brief lines. Full sentences. Every name here is invented; launch names
 * start with "Sample" so a fixture event is never mistaken for a real one (05 18).
 * Changing any string here changes no number (each concern draws its own stream).
 */

/** Fictional launches, E1 to E8 (05 radarFixtures naming rule: names start with "Sample"). */
export const LAUNCH_NAMES = [
  'Sample Astra 2',
  'Sample Corvid 5',
  'Sample Lumen 1.2',
  'Sample Quill Voice',
  'Sample Relay Agents',
  'Sample Atlas Browser',
  'Sample Prism MCP Kit',
  'Sample Ember Small',
] as const;

export const LAUNCH_VENDORS = ['Sample Labs', 'Sample Research', 'Sample Labs', 'Sample Audio', 'Sample Systems', 'Sample Research', 'Sample Systems', 'Sample Labs'] as const;

/** Fictional X watch-list accounts (kind 'watch', platform 'x'). */
export const WATCH_HANDLES = [
  'samplelabs', 'sampleresearch', 'sampleaudio', 'samplesystems', 'astra_devrel', 'corvid_team',
  'lumen_notes', 'quillvoice_hq', 'relay_builders', 'atlas_browser', 'prism_toolkit', 'ember_models',
] as const;

/** Fictional commenter handles: only ever hashed (07 7.13.3); never stored, never shown. */
export const COMMENTER_HANDLES = Array.from({ length: 40 }, (_, i) => `fan_${String(i + 1).padStart(2, '0')}_sample`);

export const COMMENT_TEXT: Record<'request' | 'question' | 'praise' | 'objection' | 'bait' | 'other', string[]> = {
  request: [
    'What tool is that in the second clip?',
    'Which app did you use for the captions?',
    'Can you make a full tutorial on this setup?',
    'Where can I get the template you showed?',
    'Do one on the memory file next, please.',
    'How did you set up the trigger at the start?',
  ],
  question: [
    'Does this still work on the free plan?',
    'Is the local model fast enough on an older laptop?',
    'Would this break if the page layout changes?',
  ],
  praise: [
    'Thanks, this saved me an afternoon.',
    'This is so good, the cost breakdown especially.',
    'Love this, clear and quick.',
    'Really helpful walkthrough.',
  ],
  objection: [
    'This did not work for me, the export step fails.',
    'Feels misleading, the demo skips the setup.',
  ],
  bait: ['AGENT', 'MEMORY', 'GUIDE'],
  other: ['First time seeing your videos.', 'The music in this one is great.', 'Watching from the train.'],
};

/** Seed clusters (07 7.13.5): the same ask on several posts, so two comment seeds form. */
export const SEED_ASKS = [
  ['What tool is that in the second clip?', 'Which tool is that in the second clip?', 'What tool is that clip using?'],
  ['Can you make a full tutorial on this setup?', 'Can you make a full tutorial on this exact setup?', 'Could you make a full tutorial on the setup?'],
] as const;

export const TEST_HOOKS = [
  ['I gave my agent a memory and the bill doubled', 'Nobody shows you this part of the bill'],
  ['The local model that beat my paid plan', 'I cancelled my paid plan for this'],
  ['Three steps, no code, it runs every morning', 'This runs every morning while I sleep'],
  ['Prompt caching cut my bill by 80 percent', 'Stop paying full price for the same prompt'],
  ['MCP explained with one real build', 'One config file gave my assistant my tools'],
  ['Browser agents: the cost nobody shows', 'Screenshots are the whole bill'],
] as const;

export const YT_TITLES = [
  ['The Local Model That Beat My Paid Plan', 'I Replaced My Paid Plan With a Laptop Model'],
] as const;

export const BRIEF_LINES = {
  new_launch: (name: string) => `${name} shipped overnight. No tracked creator has covered it yet.`,
  creator_breakout: (creator: string) => `${creator} broke out on a launch post, well above their normal.`,
  window_closing: (name: string) => `${name} is closing. Most tracked creators are in.`,
};
