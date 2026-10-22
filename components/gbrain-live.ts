'use client';

/**
 * Live retrieval glue for the Optimal Engine observatory variants: real searches
 * against GET /api/brain?q= (gbrain hybrid search, local brain-store grep
 * fallback) plus mapping of results back onto the rendered clusters.
 */
import { useEffect, useRef, useState } from 'react';
import type { ObservatoryData } from '@/lib/gbrain-observatory';

export type LiveResult = { title: string; snippet: string; source: string };

/**
 * Auto-cycle queries: short phrases so BOTH search paths hit — gbrain's
 * hybrid search handles anything, but the offline fallback is a literal
 * substring match. Keep these to words that actually live in the store.
 */
export const AUTO_QUERIES = ['pipeline', 'brand deal', 'daily briefing', 'sender'];

export async function brainSearch(q: string): Promise<LiveResult[] | null> {
  try {
    const res = await fetch(`/api/brain?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: LiveResult[] };
    return json.results ?? [];
  } catch {
    return null;
  }
}

/** Basename a result title down to the store filename look ("msa-canon.md"). */
export function resultFile(title: string): string {
  const base = title.split('/').pop() ?? title;
  return base.endsWith('.md') ? base : `${base}.md`;
}

/**
 * Which rendered clusters did the results come from? Titles arrive either as
 * "folder/slug" (local fallback) or bare slugs (engine CLI) — match against
 * the real note filenames, folder prefix as a second chance.
 */
export function matchClusters(results: LiveResult[], data: ObservatoryData): number[] {
  const byFile = new Map<string, number>();
  data.notes.forEach((n) => {
    const base = n.t.split('/').pop()!.toLowerCase();
    if (!byFile.has(base)) byFile.set(base, n.c);
  });
  const byFolder = new Map(data.clusters.map((c, i) => [c.key.toLowerCase(), i]));
  const out: number[] = [];
  for (const r of results) {
    const file = resultFile(r.title).toLowerCase();
    const folder = r.title.includes('/') ? r.title.split('/')[0].toLowerCase() : null;
    const ci = byFile.get(file) ?? (folder != null ? byFolder.get(folder) : undefined);
    if (ci != null && !out.includes(ci)) out.push(ci);
  }
  return out;
}

/** Trim a raw store line into an answer-card snippet. */
export function cleanSnippet(s: string): string {
  const cleaned = s.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 219)}…` : cleaned;
}

export type GBrainPhase = 'idle' | 'typing' | 'scan' | 'retrieve' | 'answer' | 'fade';

/**
 * The live thought cycle, shared by both observatory variants. Auto mode
 * types a canned query, runs it FOR REAL through /api/brain, lights the
 * clusters the results came from, and streams the top snippet. Focusing the
 * prompt bar stops auto for good — Enter runs your own query the same way.
 */
export function useGBrainThoughts(data: ObservatoryData) {
  const [typed, setTyped] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [phase, setPhase] = useState<GBrainPhase>('idle');
  const [manual, setManual] = useState(false);
  const litRef = useRef<Set<number>>(new Set());
  const primaryRef = useRef<number | null>(null);
  const phaseRef = useRef<GBrainPhase>('idle');
  phaseRef.current = phase;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const aliveRef = useRef(true);
  const manualRef = useRef(false);
  const autoIdxRef = useRef(0);
  const runRef = useRef<(q: string, animate: boolean) => void>(() => {});

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  const later = (ms: number, fn: () => void) =>
    timersRef.current.push(setTimeout(() => aliveRef.current && fn(), ms));
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  runRef.current = (q: string, animate: boolean) => {
    clearTimers();
    setAnswer('');
    setSources([]);
    litRef.current = new Set();
    primaryRef.current = null;
    let tScan = 250;
    if (animate) {
      setTyped('');
      setPhase('typing');
      q.split('').forEach((_, i) => later(i * 55, () => setTyped(q.slice(0, i + 1))));
      tScan = q.length * 55 + 250;
    }
    later(tScan, () => {
      setPhase('scan');
      const started = performance.now();
      void brainSearch(q).then((results) => {
        if (!aliveRef.current) return;
        // hold the scan beat at least 1.1s so the retrieval reads on camera
        later(Math.max(0, 1100 - (performance.now() - started)), () => reveal(results));
      });
    });
  };

  const reveal = (results: LiveResult[] | null) => {
    const scheduleNext = (holdMs: number) => {
      if (manualRef.current) return;
      later(holdMs, () => setPhase('fade'));
      later(holdMs + 800, () => {
        autoIdxRef.current += 1;
        runRef.current(AUTO_QUERIES[autoIdxRef.current % AUTO_QUERIES.length], true);
      });
    };
    if (!results || results.length === 0) {
      setPhase('answer');
      const msg = results == null ? 'the brain is unreachable right now.' : 'no matches in the brain-store.';
      setAnswer(msg);
      scheduleNext(3600);
      return;
    }
    const lit = matchClusters(results, data);
    litRef.current = new Set(lit);
    primaryRef.current = lit[0] ?? null;
    setPhase('retrieve');
    const text = cleanSnippet(results[0].snippet);
    later(1400, () => {
      setPhase('answer');
      setSources([...new Set(results.map((r) => resultFile(r.title)))].slice(0, 4));
      text.split('').forEach((_, i) => later(i * 22, () => setAnswer(text.slice(0, i + 1))));
    });
    scheduleNext(1400 + text.length * 22 + 4200);
  };

  // auto cycle — only when the store is real and motion is welcome
  useEffect(() => {
    if (!data.mounted) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    later(1800, () => {
      if (!manualRef.current) runRef.current(AUTO_QUERIES[0], true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inputProps = {
    value: typed,
    onFocus: () => {
      manualRef.current = true;
      setManual(true);
      clearTimers();
      litRef.current = new Set();
      primaryRef.current = null;
      setTyped('');
      setAnswer('');
      setSources([]);
      setPhase('idle');
    },
    onChange: (e: { target: { value: string } }) => setTyped(e.target.value),
    onKeyDown: (e: { key: string }) => {
      if (e.key === 'Enter' && typed.trim().length > 0) runRef.current(typed.trim(), false);
    },
  };

  /** Programmatic query (e.g. an "ask the brain" button) — stops auto like a focus would. */
  const ask = (q: string) => {
    manualRef.current = true;
    setManual(true);
    setTyped(q);
    runRef.current(q, false);
  };

  const statusWord =
    phase === 'scan' ? 'scanning…' : phase === 'retrieve' ? 'linking…' : phase === 'answer' ? 'answered' : manual ? 'ready' : 'auto';
  const showAnswer = phase === 'answer' || (phase === 'fade' && answer.length > 0);

  return { typed, answer, sources, phase, phaseRef, litRef, primaryRef, manual, inputProps, statusWord, showAnswer, ask };
}
