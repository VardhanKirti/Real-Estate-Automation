/**
 * The one place the engine's user-visible name and route live (S02 FR-1).
 * Every surface (nav, palette, page H1, AdPilot link, blueprint) reads these,
 * so a future rename is one edit. Module paths, the API prefix and env names
 * were renamed in S02 phase B; the `ae-` CSS prefix and stored ids were not
 * (docs/THEMES.md).
 */
export const ENGINE_NAME = 'Creative Engine';
/** Sentence-case form for headings and inline links. */
export const ENGINE_NAME_SENTENCE = 'Creative engine';
export const ENGINE_HREF = '/creative-engine';
/** API prefix; `next.config.mjs` rewrites the pre-rename `/api/ad-engine/*` here. */
export const ENGINE_API = '/api/creative-engine';
/** The pre-rename route; `next.config.mjs` 308s it to ENGINE_HREF. */
export const LEGACY_ENGINE_HREF = '/ad-engine';
/** ⌘K search terms, so "ad engine" muscle memory still finds the page. */
export const ENGINE_KEYWORDS = 'ad engine ads creative ugc arcads motion console scripts scripter briefs angles campaigns video';
