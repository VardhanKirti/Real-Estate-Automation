/**
 * Pure helpers behind the G kit (SPEC S00 §5.3, GP3, C6, C7). No React, no
 * DOM, so every rule the primitives apply is unit-tested in node
 * (tests/g-kit.test.ts).
 */

/* ── Dot numerals ─────────────────────────────────────────────────────── */

/**
 * 5×7 glyphs. Digits, `-`, `—` (not applicable: a full bar, never an
 * ellipsis), `.`, `,` come from the Creative Engine's DotNumeral; `$ % / + x
 * K M B` are the C7 additions, drawn in the same style. Units are uppercase
 * because lib/format-number.ts prints `10K`, `1M`, `2B`.
 */
export const DOT_GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '—': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '00100', '01000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
};

/** Every glyph C7 requires, in one string (tests iterate it). */
export const DOT_CHARSET = '0123456789-—.,$%/+xKMB';

export const DOT_SIZES = [3, 4, 5, 6, 7] as const;
export const DOT_MIN = 3;
export const DOT_MAX = 7;

/**
 * The string a dot numeral draws: units uppercased (`158k` → `158K`), `x`
 * kept lowercase (a multiplier, `2.29x`), surrounding spaces dropped. Returns
 * null when any character has no glyph, so the caller renders text instead
 * of silently dropping a character (`1.2 days` must never read `1.2`).
 */
export function dotText(value: string): string | null {
  const s = value.trim().replace(/[kmb]/g, (c) => c.toUpperCase()).replace(/X/g, 'x');
  if (s.length === 0) return null;
  for (const c of s) if (!DOT_GLYPHS[c]) return null;
  return s;
}

/** Gap between dots inside a glyph, in px, for a dot size. */
export function dotGap(size: number): number {
  return Math.max(2, Math.round(size * 0.55));
}

/** Exact rendered width in px of `chars` glyphs at `size`. */
export function dotWidth(chars: number, size: number): number {
  if (chars <= 0) return 0;
  const g = dotGap(size);
  const glyph = 5 * size + 4 * g;
  return chars * glyph + (chars - 1) * 2 * g;
}

/** Rendered height in px at `size`. */
export function dotHeight(size: number): number {
  return 7 * size + 6 * dotGap(size);
}

/**
 * Auto-fit (GP3, S01 §12): the largest dot size from 3 to 7 whose drawn
 * width fits `width`, or null when even size 3 overflows (the caller falls
 * back to 32px text). GP3 writes the rule as
 * `clamp(3, floor(width / (chars × 8.6)), 7)`; that estimate overflows at
 * size 3 for four or more characters (27 px per glyph, not 25.8), so the fit
 * uses the exact geometry instead and never overflows (ACGP3.2).
 */
export function fitDotSize(chars: number, width: number, max: number = DOT_MAX): number | null {
  if (!(width > 0) || chars <= 0) return null;
  for (let s = Math.min(DOT_MAX, Math.max(DOT_MIN, Math.floor(max))); s >= DOT_MIN; s--) {
    if (dotWidth(chars, s) <= width) return s;
  }
  return null;
}

/**
 * C6: a number renders in dots when its formatted text is at most six
 * characters and every character has a glyph; otherwise plain 300-weight
 * tabular text (GBigNumber style).
 */
export const DOTS_MAX_CHARS = 6;
export function prefersDots(text: string): boolean {
  const s = dotText(text);
  return s !== null && s.length <= DOTS_MAX_CHARS;
}

/* ── Keyboard models ──────────────────────────────────────────────────── */

/**
 * Roving focus for radiogroups, tablists and menus: the index the key moves
 * to, skipping disabled items, wrapping at the ends. Returns null for keys
 * the group does not handle. `orientation` picks which arrows move.
 */
export function rovingIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
  orientation: 'horizontal' | 'vertical' | 'both' = 'horizontal',
): number | null {
  const n = disabled.length;
  if (n === 0) return null;
  const enabled = (i: number) => !disabled[i];
  const step = (from: number, dir: 1 | -1): number => {
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (enabled(i)) return i;
    }
    return from;
  };
  const first = () => disabled.findIndex((d) => !d);
  const last = () => {
    for (let i = n - 1; i >= 0; i--) if (enabled(i)) return i;
    return -1;
  };
  const h = orientation !== 'vertical';
  const v = orientation !== 'horizontal';
  switch (key) {
    case 'ArrowRight':
      return h ? step(current, 1) : null;
    case 'ArrowLeft':
      return h ? step(current, -1) : null;
    case 'ArrowDown':
      return v ? step(current, 1) : null;
    case 'ArrowUp':
      return v ? step(current, -1) : null;
    case 'Home': {
      const i = first();
      return i < 0 ? null : i;
    }
    case 'End': {
      const i = last();
      return i < 0 ? null : i;
    }
    default:
      return null;
  }
}

/* ── Gestures ─────────────────────────────────────────────────────────── */

/** GP3: a swipe right of at least this many px closes a drawer on touch. */
export const SWIPE_CLOSE_PX = 80;

/**
 * Whether a touch drag closes a drawer: mostly horizontal, to the right, at
 * least SWIPE_CLOSE_PX. A vertical scroll that drifts right does not.
 */
export function swipeCloses(dx: number, dy: number): boolean {
  return dx >= SWIPE_CLOSE_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/* ── Tables ───────────────────────────────────────────────────────────── */

export type SortDir = 'asc' | 'desc';

/** Next sort state when a header is pressed: new column starts `desc` for numbers, `asc` for text. */
export function nextSort(
  current: { key: string; dir: SortDir } | null,
  key: string,
  numeric: boolean,
): { key: string; dir: SortDir } {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: numeric ? 'desc' : 'asc' };
}

/** Stable sort; nulls last in both directions. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const an = a.v == null || a.v === '';
      const bn = b.v == null || b.v === '';
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return (dir === 'asc' ? c : -c) || a.i - b.i;
    })
    .map((x) => x.row);
}

/* ── Text areas ───────────────────────────────────────────────────────── */

/** GTextarea grows with its content up to this many lines, then scrolls. */
export const TEXTAREA_MAX_LINES = 8;

/** Height in px for a textarea's content, capped at `maxLines`. */
export function textareaHeight(scrollHeight: number, lineHeight: number, padding: number, maxLines = TEXTAREA_MAX_LINES): number {
  const cap = lineHeight * maxLines + padding;
  return Math.min(Math.max(scrollHeight, lineHeight + padding), cap);
}
