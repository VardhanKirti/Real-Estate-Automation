import {
  ConsoleControlsSchema,
  INTROS,
  TONES,
  type ConsoleControls,
  type Intro,
  type Preset,
  type Tone,
} from '@/lib/creative-engine/schemas';
import { countWords } from '@/lib/creative-engine/duration';

/**
 * Prompt composer for the Motion Console. Every "composed" control writes a
 * sentence; `composePrompt` assembles them in the Seedance order (Subject,
 * Action, Camera, Style, Constraints), appends the no-captions rule, and
 * returns lints instead of silently fixing things the operator should see.
 * Pure — the tests feed control states in and check the prose out.
 *
 * Option banks are ported from the arcads-claude-code prompt library
 * (seedance-2-ugc, ugc-selfie-style, ugc-product-selfie): the words below
 * are the ones that made real generations look unposed.
 */

export const FORBIDDEN_WORDS = ['cinematic', 'professional', 'stunning', '8k', 'studio', 'perfect'] as const;

export const TONE_BANK: Record<Tone, { label: string; cue: string; pacing: string }> = {
  'excited-fan': { label: 'Excited fan', cue: 'genuinely excited, leaning in, eyes lit up, talking a little fast then catching herself', pacing: 'quick then settles, natural pauses to breathe' },
  'chill-recommender': { label: 'Chill recommender', cue: 'relaxed, half-smile, like recommending it to a friend over coffee', pacing: 'unhurried, conversational, one beat of silence before the point' },
  'skeptic-converted': { label: 'Skeptic converted', cue: 'started doubtful, now convinced, a small shrug of admission', pacing: 'measured, a pause before the turn' },
  'best-friend': { label: 'Best friend sharing', cue: 'warm, direct to camera, the voice you use when you actually mean it', pacing: 'easy, real pauses, no rush' },
  'morning-routine': { label: 'Morning routine casual', cue: 'just woke up energy, hair not done, coffee in the other hand', pacing: 'slow start, casual, trailing sentences' },
  considered: { label: 'Considered appreciation', cue: 'thoughtful, weighing it, nodding at the detail that mattered', pacing: 'deliberate, spaced, lets a line land' },
  'quiet-pride': { label: 'Quiet pride', cue: 'understated, pleased with the result, not selling', pacing: 'calm, even, short sentences' },
};

export const INTRO_BANK: Record<Intro, string> = {
  show: 'She picks the product up and holds it to the camera, label readable, then sets it back down',
  using: 'The product is already in use mid-frame, she only glances at it while talking',
  unboxing: 'She opens the box on camera, pulls the product out, turns it once in her hand',
  'in-hand': 'The product stays casually in one hand the whole time, never presented',
  'before-after': 'A quick before state, then the product, then the after state, all in the same frame',
};

export const SETTING_BANK: Record<ConsoleControls['setting'], string> = {
  'bedroom desk': 'a bedroom desk with a laptop half open, a charging cable, a mug ring on the wood, unmade bed soft in the background',
  kitchen: 'a kitchen counter with a dish rack, a fruit bowl, a paper towel roll, morning light on the tiles',
  car: 'the driver seat of a parked car, seatbelt off, sunlight through the windshield, a phone mount in frame',
  'bathroom mirror': 'a bathroom mirror selfie angle, toothbrush cup and a bottle or two on the sink, slightly fogged edge of the mirror',
  'living room': 'a living room couch with a throw blanket, a remote on the cushion, a lamp on, a plant just out of focus',
  office: 'an office corner with a monitor arm, sticky notes on the frame, a water bottle, a chair with a jacket on it',
  outdoors: 'outside on a sidewalk or patio, wind moving hair slightly, passing background movement, uneven daylight',
};

export const LIGHTING_BANK: Record<ConsoleControls['lighting'], { clause: string; flaw: string }> = {
  'window daylight': { clause: 'soft window daylight from one side', flaw: 'slight blue cast from the window' },
  'overhead kitchen': { clause: 'flat overhead kitchen light', flaw: 'faint shadow under the brow' },
  'golden hour': { clause: 'warm low golden hour light', flaw: 'one side slightly blown out' },
  'ring light': { clause: 'a ring light straight on', flaw: 'the ring reflected in the eyes' },
  'mixed practicals': { clause: 'mixed lamps and screen glow', flaw: 'mixed colour temperature across the face' },
};

const IMPERFECTIONS = [
  'slight handheld shake',
  'phone camera grain in the shadows',
  'a moment of autofocus hunting',
  'exposure adjusting when she moves',
  'a fingerprint smudge softening one corner',
  'rolling shutter wobble on a quick move',
  'audio with a little room echo',
  'a lens flare from the window',
  'framing slightly off centre',
] as const;

const SKIN_CUES = [
  'natural skin texture with visible pores',
  'a few faint freckles',
  'slight redness around the nose',
  'uneven skin tone under the eyes',
] as const;

const MOTION_CUES = [
  'eyes drift off camera then come back',
  'a small head tilt on the key point',
  'she shifts her weight',
  'a hand gesture that stops mid air',
  'the selfie arm adjusts the framing',
  'a blink and a half laugh',
] as const;

const FRAMING_CLAUSE: Record<ConsoleControls['framing'], string> = {
  wide: 'wide shot, full setting visible',
  medium: 'medium shot from the waist up',
  'close-up': 'close-up on the face and hands',
  macro: 'macro detail of the product',
};

const HEIGHT_CLAUSE: Record<ConsoleControls['height'], string> = {
  low: 'camera low, looking slightly up',
  chest: 'phone propped at chest height',
  'eye level': 'camera at eye level',
  'slightly above': 'camera slightly above eye level, angled down',
  overhead: 'overhead top-down angle',
};

const INTENSITY_ADVERBS = ['slowly', 'gently', 'casually', 'quickly', 'deliberately'] as const;

function lensClause(mm: number): string {
  const dof = mm >= 50 ? 'shallow depth of field, background softly out of focus' : 'deep focus, background readable';
  return `${mm} mm feel, ${dof}`;
}

export type Lint = { level: 'warn' | 'error'; message: string };

export type Composed = { prompt: string; wordCount: number; lints: Lint[]; parts: { subject: string; action: string; camera: string; style: string; constraints: string } };

export function composePrompt(input: Partial<ConsoleControls>): Composed {
  const c = ConsoleControlsSchema.parse({ ...input, noCaptions: true });
  const lints: Lint[] = [];

  const tone = TONE_BANK[c.tone];
  const subjectBits = [
    c.subject.trim() || 'a real person in their late twenties, plain t-shirt, hair not styled',
    `${tone.cue}.`,
    c.skinRealism > 0 ? SKIN_CUES.slice(0, c.skinRealism).join(', ') + '.' : '',
  ].filter(Boolean);
  const subject = subjectBits.join(' ');

  const adverb = INTENSITY_ADVERBS[c.intensity - 1];
  // the Dialogue check off keeps the text but leaves it out of the prompt and its lints (S05a FR-11)
  const spoken = c.omitDialogue ? '' : c.dialogue.trim();
  const actionBits = [
    `${INTRO_BANK[c.intro]}, ${adverb}.`,
    c.action.trim() ? `${c.action.trim()}.` : '',
    MOTION_CUES.slice(0, c.motionCues).join(', ') + '.',
    spoken ? `Dialogue: "${spoken}"` : '',
    `Pacing: ${tone.pacing}.`,
  ].filter(Boolean);
  const action = actionBits.join(' ');

  const camera = `Camera: ${FRAMING_CLAUSE[c.framing]}, ${c.movement}, ${HEIGHT_CLAUSE[c.height]}, ${lensClause(c.lensMm)}.`;

  const light = LIGHTING_BANK[c.lighting];
  const styleBits = [
    `Style: ${c.style}, ${light.clause}, ${light.flaw}.`,
    `Setting: ${SETTING_BANK[c.setting]}.`,
    c.imperfection > 0 ? `Camera flaws: ${IMPERFECTIONS.slice(0, c.imperfection).join(', ')}.` : '',
  ].filter(Boolean);
  const style = styleBits.join(' ');

  const constraintBits = [
    c.onScreenText.trim() ? `[Text overlay: "${c.onScreenText.trim()}" ${c.textReveal}]` : '',
    'No subtitles, no captions, no text overlays unless specified above.',
    'No celebrity likeness, no real person by name.',
  ].filter(Boolean);
  const constraints = constraintBits.join(' ');

  const omit = new Set(c.omit);
  const prompt = [omit.has('subject') ? '' : subject, omit.has('action') ? '' : action, omit.has('camera') ? '' : camera, omit.has('style') ? '' : style, constraints].filter(Boolean).join('\n');
  const wordCount = countWords(prompt);

  const lower = prompt.toLowerCase();
  for (const w of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) lints.push({ level: 'error', message: `"${w}" is on the Seedance forbidden list; it produces staged output` });
  }
  const window = c.model === 'veo31' ? { min: 75, max: 125 } : { min: 100, max: 260 };
  if (wordCount < window.min) lints.push({ level: 'warn', message: `${wordCount} words is under the ${window.min}-word floor for ${c.model}: the model will guess the gaps` });
  if (wordCount > window.max) lints.push({ level: 'warn', message: `${wordCount} words is over the ${window.max}-word ceiling for ${c.model}: it loses focus` });
  if (omit.size) lints.push({ level: 'warn', message: `${[...omit].join(', ')} hidden from the prompt by the scene tree` });
  if (c.motionCues < 3 && !omit.has('action')) lints.push({ level: 'error', message: 'fewer than 3 human motion cues reads as a mannequin' });
  if (/\b(acne|pimples?|breakouts?|blemish(es)?|rosacea)\b/.test(lower)) lints.push({ level: 'error', message: 'dermatology words are banned: real is not dermatological' });
  if (spoken) {
    const words = countWords(spoken);
    const budget = Math.floor(c.duration * 2.5);
    if (words > budget) lints.push({ level: 'error', message: `${words} spoken words do not fit ${c.duration}s (budget ${budget})` });
  }
  if (c.model !== 'seedance-2.0' && c.model !== 'veo31' && !c.model.startsWith('sora') && spoken) {
    lints.push({ level: 'warn', message: `${c.model} is silent: dialogue will not be spoken` });
  }

  return { prompt, wordCount, lints, parts: { subject, action, camera, style, constraints } };
}

/** Which control names contribute to which prompt part — the scene tree's dot rows. */
export const CONTRIBUTIONS: Record<keyof Composed['parts'], (keyof ConsoleControls)[]> = {
  subject: ['subject', 'tone', 'skinRealism'],
  action: ['intro', 'intensity', 'action', 'motionCues', 'dialogue', 'tone'],
  camera: ['framing', 'movement', 'height', 'lensMm'],
  style: ['style', 'lighting', 'setting', 'imperfection'],
  constraints: ['onScreenText', 'textReveal', 'noCaptions'],
};

/** Seeded presets: the skill pack's five templates as control states. */
export const BUILTIN_PRESETS: Preset[] = [
  { id: 'preset-ugc-selfie', name: 'UGC selfie', builtin: true, at: '2026-09-30T00:00:00.000Z', controls: { model: 'seedance-2.0', framing: 'medium', movement: 'handheld', height: 'chest', lensMm: 24, style: 'handheld phone', lighting: 'window daylight', setting: 'bedroom desk', imperfection: 4, skinRealism: 3, motionCues: 4, intro: 'show', tone: 'best-friend', aspectRatio: '9:16', duration: 12 } },
  { id: 'preset-premium-reveal', name: 'Premium reveal', builtin: true, at: '2026-09-30T00:00:00.000Z', controls: { model: 'seedance-2.0', framing: 'macro', movement: 'slow push-in', height: 'eye level', lensMm: 85, style: 'commercial', lighting: 'mixed practicals', setting: 'office', imperfection: 0, skinRealism: 0, motionCues: 3, intro: 'in-hand', tone: 'quiet-pride', aspectRatio: '9:16', duration: 8, audioEnabled: false } },
  { id: 'preset-product-hero', name: 'Product hero', builtin: true, at: '2026-09-30T00:00:00.000Z', controls: { model: 'seedance-2.0', framing: 'close-up', movement: '360 orbit', height: 'slightly above', lensMm: 65, style: 'photorealistic', lighting: 'golden hour', setting: 'kitchen', imperfection: 1, skinRealism: 0, motionCues: 3, intro: 'show', tone: 'considered', aspectRatio: '1:1', duration: 6 } },
  { id: 'preset-studio-lookbook', name: 'Studio lookbook', builtin: true, at: '2026-09-30T00:00:00.000Z', controls: { model: 'veo31', framing: 'wide', movement: 'pan', height: 'eye level', lensMm: 50, style: 'photorealistic', lighting: 'ring light', setting: 'living room', imperfection: 1, skinRealism: 2, motionCues: 3, intro: 'using', tone: 'considered', aspectRatio: '16:9' } },
  { id: 'preset-feature-walkthrough', name: 'Feature walkthrough', builtin: true, at: '2026-09-30T00:00:00.000Z', controls: { model: 'seedance-2.0', framing: 'medium', movement: 'static', height: 'chest', lensMm: 35, style: 'documentary', lighting: 'overhead kitchen', setting: 'office', imperfection: 3, skinRealism: 2, motionCues: 3, intro: 'using', tone: 'chill-recommender', aspectRatio: '9:16', duration: 15 } },
];

export const TONE_OPTIONS = TONES.map((t) => ({ value: t, label: TONE_BANK[t].label }));
export const INTRO_OPTIONS = INTROS.map((i) => ({ value: i, label: i.replace('-', ' ') }));
