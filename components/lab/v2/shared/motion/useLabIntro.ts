'use client';
/**
 * The once-per-session load sequence (03.3). A hard load arrives with `data-lab-intro` already on
 * <html> (LabIntroScript); a client navigation into /lab gets the same attributes here, in a layout
 * effect, before paint. Either way the attributes are mirrored onto the `.lab` root (the CSS selectors
 * read the root) and removed at 760 ms (700 + 60 slack). Marking happens when the intro starts, so an
 * interrupted intro never replays.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { INTRO_KEYS, shouldPlayIntro, type LabIntroScope } from '@/lib/lab/motion';
import { prefersReducedMotion } from './useReducedMotion';

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
/** Module memory: at most one intro per scope per document, even when storage throws. */
const played = new Set<LabIntroScope>();
export const INTRO_CLEAR_MS = 760;

export type LabIntroState = { playing: boolean; t0: number | null };

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function mark(scope: LabIntroScope) {
  played.add(scope);
  try {
    window.sessionStorage.setItem(INTRO_KEYS[scope], '1');
  } catch {
    /* module memory still limits it to once per document */
  }
}

function labRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.lab[data-lab-root]') ?? document.querySelector<HTMLElement>('.lab');
}

/** Start (or adopt from the inline script) the intro for `scope`. Returns whether it plays. */
export function useLabIntro(scope: LabIntroScope): LabIntroState {
  const [state, setState] = useState<LabIntroState>({ playing: false, t0: null });
  useIso(() => {
    const html = document.documentElement;
    const root = labRoot();
    const fromScript = html.getAttribute('data-lab-intro') === 'play';
    const scriptScopes = (html.getAttribute('data-lab-intro-scope') ?? '').split(' ').filter(Boolean);
    let plays = false;
    let t0: number | null = null;
    if (fromScript) {
      plays = scriptScopes.includes(scope) && !played.has(scope);
      t0 = Number(html.getAttribute('data-lab-intro-t0')) || 0;
    } else {
      plays = shouldPlayIntro(scope, {
        reducedMotion: prefersReducedMotion(),
        hidden: document.visibilityState === 'hidden',
        storage: storage(),
        memory: played,
      });
      t0 = performance.now();
    }
    if (!plays) {
      if (scope === 'aurora') played.add('aurora');
      return;
    }
    mark(scope);
    const scopes = new Set((root?.getAttribute('data-lab-intro-scope') ?? '').split(' ').filter(Boolean));
    scopes.add(scope);
    root?.setAttribute('data-lab-intro', 'play');
    root?.setAttribute('data-lab-intro-scope', [...scopes].join(' '));
    setState({ playing: true, t0 });
    const elapsed = performance.now() - (t0 ?? performance.now());
    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      root?.removeAttribute('data-lab-intro');
      root?.removeAttribute('data-lab-intro-scope');
      html.removeAttribute('data-lab-intro');
      html.removeAttribute('data-lab-intro-scope');
      html.removeAttribute('data-lab-intro-t0');
      setState((s) => (s.playing ? { playing: false, t0: s.t0 } : s));
    };
    const id = window.setTimeout(clear, Math.max(0, INTRO_CLEAR_MS - elapsed));
    // A route change unmounts the page: the attribute goes at once and every intro animation ends (03.3.3).
    return () => {
      window.clearTimeout(id);
      clear();
    };
  }, [scope]);
  return state;
}
