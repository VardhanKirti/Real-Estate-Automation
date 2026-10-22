/**
 * Trakyo link studio (FounderOS merge F6): the form and workspace shapes shared
 * by the GladOS and Classic cards. Pure; the network lives in the cards, which
 * call GET and POST /api/trakyo/links (writes gated by GLADOS_WRITES + confirm).
 */

export type LinkRow = { key: string; url: string; shortLink: string; domainId: string; contentItemId: string | null; clicks: number };

/** GET /api/trakyo/links, as the cards read it. */
export type LinksWorkspace = {
  state: 'ready' | 'partial' | 'not_configured' | 'error';
  scopes: string[];
  domains: { id: string; hostname: string }[];
  links: LinkRow[];
  hasMore: boolean;
  messages: string[];
  writes: boolean;
  sample: boolean;
  setupHref?: string;
};

export type LinkForm = { url: string; source: string; campaign: string; contentId: string; domain: string };
export const EMPTY_LINK_FORM: LinkForm = { url: '', source: '', campaign: '', contentId: '', domain: '' };

export const WRITES_OFF_REASON = 'Outbound writes are off on this instance. Set GLADOS_WRITES=1 to create links.';
export const CONFIRM_TITLE = 'Create link in Trakyo?';

const httpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.host) && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** First problem with the form, worded for the field, or null when it can be sent. */
export function linkFormError(f: LinkForm): { field: keyof LinkForm; message: string } | null {
  if (!httpUrl(f.url.trim())) return { field: 'url', message: 'Use a full http or https address.' };
  const id = f.contentId.trim();
  if (id) {
    if (!/^ci_[A-Za-z0-9_-]+$/.test(id)) return { field: 'contentId', message: 'A Trakyo content id starts with ci_.' };
    return null;
  }
  const source = f.source.trim();
  if (!source) return { field: 'source', message: 'Name the source, for example Instagram, or give a content id.' };
  if (/^(youtube|other|\d+)$/i.test(source)) return { field: 'source', message: 'Trakyo tracks YouTube itself. Use a custom source such as Instagram.' };
  if (!f.campaign.trim()) return { field: 'campaign', message: 'Name the campaign or post this link belongs to.' };
  return null;
}

/**
 * The POST body. With a content id the link joins that content item; without
 * one, Trakyo first creates a content item named after the campaign under the
 * source. `confirm: true` is only ever added after the confirm dialog.
 */
export function linkRequestBody(f: LinkForm): Record<string, unknown> {
  const link: Record<string, unknown> = { url: f.url.trim() };
  if (f.domain) link.domain = f.domain;
  const id = f.contentId.trim();
  if (id) return { link: { ...link, contentItemId: id }, confirm: true };
  return { link, content: { source: f.source.trim(), name: f.campaign.trim() }, confirm: true };
}

export function hostPath(u: string): string {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
}

export const totalClicks = (links: readonly LinkRow[]) => links.reduce((n, l) => n + l.clicks, 0);
