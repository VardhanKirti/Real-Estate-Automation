/**
 * Voice skill routing (07 7.10). Skills are read through v1's readSkillMarkdown; a missing
 * skill is reported (`found: false`) and the draft is written without it, never faked.
 */
import { readSkillMarkdown } from '@/lib/skills-catalog';

export const LONG_FORM_S = 180;

export const VOICE_ROUTES = {
  long: ['brody-voice-youtube', 'brody-voice-speaking'],
  skit: ['brody-satirical-video', 'reel'],
  linkedinText: ['brody-voice-writing'],
  short: ['reel', 'brody-voice-speaking'],
} as const;

/** 7.10, first matching case in order. */
export function voiceSkillsFor(idea: { formatFamily: string } | null, body: { durationS: number; platform?: string | null }): string[] {
  const family = idea?.formatFamily ?? '';
  if (body.durationS > LONG_FORM_S || family === 'long_form') return [...VOICE_ROUTES.long];
  if (family === 'skit') return [...VOICE_ROUTES.skit];
  if (body.platform === 'linkedin' && (family === 'text_post' || family === 'carousel')) return [...VOICE_ROUTES.linkedinText];
  return [...VOICE_ROUTES.short];
}

/** Each routed slug and whether this host has it. */
export function skillPresence(slugs: readonly string[], read: (slug: string) => string | null = (s) => readSkillMarkdown(s)): { slug: string; found: boolean }[] {
  return slugs.map((slug) => {
    let md: string | null = null;
    try {
      md = read(slug);
    } catch {
      md = null;
    }
    return { slug, found: Boolean(md) };
  });
}

/** Sheet copy for one missing skill (7.8 states). */
export const missingSkillCopy = (slug: string) => `Voice skill ${slug} is not on this host. This draft was written without it.`;
