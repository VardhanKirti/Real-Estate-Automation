/**
 * Retention onto beats (06 9.3): YouTube's audience watch ratio curve, or Instagram's skip rate
 * and average watch time, laid on the post's beats; aggregates by hook form and beat type.
 */
import type { LabBeat, LabBeatType, LabRetention } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { median } from '@/lib/lab/measures';

export type BeatRetention = { beatIndex: number; type: LabBeatType; startPct: number; endPct: number; start: number | null; end: number | null; keep: number | null; dropPer10: number | null; rrp: number | null };
export type PostRetention = { postId: string; platform: 'youtube' | 'instagram'; ageH: number; capturedAt: string; hookHold: number | null; avgPctWatched: number | null; beats: BeatRetention[]; steepestBeat: number | null; partial: boolean };
export type RetentionByHookFormRow = { hookForm: string; /** the form as a reader sees it: "Number stat" */ label: string; medianHookHold: number | null; n: number; enough: boolean; vsAll: number | null };
export type RetentionByBeatTypeRow = { type: LabBeatType; medianDropPer10: number | null; n: number; enough: boolean };

type Curve = NonNullable<LabRetention['curve']>;

/** audienceWatchRatio at x (0..1), linear between points; x under the first point uses it (the 0.01 point). */
export function awr(curve: Curve, x: number): number | null {
  if (!curve.length) return null;
  const pts = [...curve].sort((a, b) => a.x - b.x);
  if (x <= pts[0].x) return pts[0].awr;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].x) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.awr + ((b.awr - a.awr) * (x - a.x)) / (b.x - a.x || 1);
    }
  }
  return pts[pts.length - 1].awr;
}

/** awr(hook end) / awr(0.01). */
export function hookHold(curve: Curve, beats: readonly LabBeat[]): number | null {
  const hook = beats.find((b) => b.type === 'hook');
  const a0 = awr(curve, 0.01);
  const a1 = hook ? awr(curve, hook.endPct / 100) : null;
  return hook && a0 && a1 !== null ? a1 / a0 : null;
}

/** 06 9.3: per-beat keep and drop per tenth of the runtime; Instagram uses skip rate and average watch. */
export function beatRetention(row: LabRetention, beats: readonly LabBeat[], durationS: number | null): PostRetention {
  const base = { postId: row.postId, platform: row.platform, ageH: row.ageH, capturedAt: row.capturedAt, partial: row.partial };
  if (row.platform === 'youtube' && row.curve?.length) {
    const curve = row.curve;
    const out: BeatRetention[] = beats.map((b, i) => {
      const start = awr(curve, b.startPct / 100);
      const end = awr(curve, b.endPct / 100);
      const inside = curve.filter((p) => p.x >= b.startPct / 100 && p.x <= b.endPct / 100 && p.rrp !== null).map((p) => p.rrp!);
      const span = (b.endPct - b.startPct) / 10;
      return {
        beatIndex: i, type: b.type, startPct: b.startPct, endPct: b.endPct, start, end,
        keep: start !== null && end !== null && start > 0 ? end / start : null,
        dropPer10: start !== null && end !== null && span > 0 ? (start - end) / span : null,
        rrp: inside.length ? inside.reduce((s, x) => s + x, 0) / inside.length : null,
      };
    });
    const steep = out.filter((b) => b.dropPer10 !== null).sort((a, b) => b.dropPer10! - a.dropPer10!)[0];
    return { ...base, hookHold: hookHold(curve, beats), avgPctWatched: row.avgViewPct !== null ? row.avgViewPct / 100 : null, beats: out, steepestBeat: steep ? steep.beatIndex : null };
  }
  const hold = row.skipRate !== null ? 1 - row.skipRate / 100 : null;
  const avg = row.avgWatchTimeMs !== null && durationS ? row.avgWatchTimeMs / 1000 / durationS : null;
  const out: BeatRetention[] = beats.map((b, i) => ({ beatIndex: i, type: b.type, startPct: b.startPct, endPct: b.endPct, start: null, end: null, keep: null, dropPer10: null, rrp: null }));
  return { ...base, hookHold: hold, avgPctWatched: avg, beats: out, steepestBeat: null };
}

/** The beat containing min(avgPctWatched, 1) x 100 (Instagram copy). */
export function avgWatchedBeat(beats: readonly LabBeat[], avgPctWatched: number | null): number | null {
  if (avgPctWatched === null) return null;
  const at = Math.min(avgPctWatched, 1) * 100;
  const i = beats.findIndex((b) => at >= b.startPct && at <= b.endPct);
  return i >= 0 ? i : null;
}

/** Beats from the dissection, else the published script's latest sections, else none. */
export function beatsFor(store: LabStore, postId: string): LabBeat[] {
  const d = store.dissections.get(postId);
  if (d?.beats.length) return d.beats;
  const script = store.scripts.all().find((s) => s.publishedPostId === postId);
  const v = script ? store.scripts.latestVersion(script.id) : null;
  return v ? v.body.sections.map((s) => ({ type: s.type, startPct: s.startPct, endPct: s.endPct, summary: '' })) : [];
}

/** The newest row at 7 d (within 12 h), else the newest row there is. */
export function rowAt7d(rows: readonly LabRetention[]): LabRetention | null {
  if (!rows.length) return null;
  const near = rows.filter((r) => Math.abs(r.ageH - 168) <= 12).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0];
  return near ?? [...rows].sort((a, b) => b.ageH - a.ageH || (a.capturedAt < b.capturedAt ? 1 : -1))[0];
}

function ownedRetention(store: LabStore, platform?: 'youtube' | 'instagram'): { row: LabRetention; post: PostRetention }[] {
  const by = new Map<string, LabRetention[]>();
  for (const r of store.retention.all()) if (!platform || r.platform === platform) by.set(r.postId, [...(by.get(r.postId) ?? []), r]);
  const out: { row: LabRetention; post: PostRetention }[] = [];
  for (const [postId, rows] of by) {
    const p = store.posts.get(postId);
    if (!p?.isOwned) continue;
    const row = rowAt7d(rows)!;
    out.push({ row, post: beatRetention(row, beatsFor(store, postId), p.durationS) });
  }
  return out;
}

/** Median hook hold per hook form (dissection), with n, enough (n >= 5) and the ratio to all owned posts on the platform. */
export function retentionByHookForm(store: LabStore, platform: 'youtube' | 'instagram'): RetentionByHookFormRow[] {
  const rows = ownedRetention(store, platform).filter((r) => r.post.hookHold !== null);
  const all = median(rows.map((r) => r.post.hookHold!));
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const form = store.dissections.get(r.row.postId)?.hookForm;
    if (!form) continue;
    by.set(form, [...(by.get(form) ?? []), r.post.hookHold!]);
  }
  return [...by.entries()]
    .map(([hookForm, holds]) => {
      const m = median(holds);
      return { hookForm, label: (hookForm.charAt(0).toUpperCase() + hookForm.slice(1)).replaceAll('_', ' '), medianHookHold: m, n: holds.length, enough: holds.length >= 5, vsAll: m !== null && all ? m / all : null };
    })
    .sort((a, b) => b.n - a.n || a.hookForm.localeCompare(b.hookForm));
}

/** Median drop per tenth of the runtime per beat type over owned YouTube posts. */
export function retentionByBeatType(store: LabStore): RetentionByBeatTypeRow[] {
  const by = new Map<LabBeatType, number[]>();
  for (const r of ownedRetention(store, 'youtube')) {
    for (const b of r.post.beats) if (b.dropPer10 !== null) by.set(b.type, [...(by.get(b.type) ?? []), b.dropPer10]);
  }
  return [...by.entries()].map(([type, xs]) => ({ type, medianDropPer10: median(xs), n: xs.length, enough: xs.length >= 5 })).sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
}

/** 06 9.3 Post sheet strand copy. */
export function retentionLine(r: PostRetention, beats: readonly LabBeat[]): string | null {
  const label = (t: LabBeatType) => t.replaceAll('_', ' ');
  if (r.platform === 'youtube') {
    const b = r.steepestBeat !== null ? r.beats[r.steepestBeat] : null;
    if (!b || b.dropPer10 === null) return null;
    return `Viewers left fastest during the ${label(b.type)} (${Math.round(b.startPct)}% to ${Math.round(b.endPct)}%): ${Math.round(b.dropPer10 * 100)}% of views per tenth of the video.`;
  }
  if (r.hookHold === null) return null;
  const i = avgWatchedBeat(beats, r.avgPctWatched);
  return `${Math.round(r.hookHold * 100)}% made it past the first seconds.${i !== null ? ` Average watch reached the ${label(beats[i].type)}.` : ''}`;
}
