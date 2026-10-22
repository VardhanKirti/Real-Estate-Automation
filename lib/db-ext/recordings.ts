/**
 * Call recordings (pages/feature-additions.md F4): Plaud pushes through
 * POST /api/plaud/ingest, Fathom is pulled (lib/connectors/fathom.ts). One
 * row per (source, external id), so a replayed push or a re-pull updates in
 * place instead of duplicating.
 */
import type Database from 'better-sqlite3';
import {
  CallRecordingSchema,
  CallRecordingSourceSchema,
  type CallRecording,
  type CallRecordingInput,
} from '@/lib/schemas';

type Raw = {
  id: string; source: string; external_id: string; title: string; started_at: string; duration_s: number | null;
  participants_json: string; summary: string; transcript_url: string | null;
};
const toRecording = (r: Raw): CallRecording =>
  CallRecordingSchema.parse({
    id: r.id, source: r.source, externalId: r.external_id, title: r.title, startedAt: r.started_at,
    durationS: r.duration_s, participants: JSON.parse(r.participants_json || '[]'), summary: r.summary,
    transcriptUrl: r.transcript_url,
  });

/** Stable id: one recording per source and external id. */
export const recordingId = (source: string, externalId: string) => `${source}:${externalId}`;

export function callRecordingsRepo(db: InstanceType<typeof Database>) {
  return {
    upsert(input: Omit<CallRecordingInput, 'id'> & { id?: string }): CallRecording {
      const r = CallRecordingSchema.parse({ ...input, id: input.id ?? recordingId(input.source, input.externalId) });
      db.prepare(
        `INSERT INTO call_recordings (id, source, external_id, title, started_at, duration_s, participants_json, summary, transcript_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, external_id) DO UPDATE SET
           title = excluded.title, started_at = excluded.started_at, duration_s = excluded.duration_s,
           participants_json = excluded.participants_json, summary = excluded.summary,
           transcript_url = excluded.transcript_url`,
      ).run(r.id, r.source, r.externalId, r.title, r.startedAt, r.durationS, JSON.stringify(r.participants), r.summary, r.transcriptUrl);
      return r;
    },
    /** Newest first, optionally one source. */
    recent(limit = 100, source?: CallRecording['source']): CallRecording[] {
      if (source) CallRecordingSourceSchema.parse(source);
      const rows = source
        ? db.prepare('SELECT * FROM call_recordings WHERE source = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(source, limit)
        : db.prepare('SELECT * FROM call_recordings ORDER BY started_at DESC, rowid DESC LIMIT ?').all(limit);
      return (rows as Raw[]).map(toRecording);
    },
    count(source?: CallRecording['source']): number {
      const row = source
        ? db.prepare('SELECT COUNT(*) AS n FROM call_recordings WHERE source = ?').get(source)
        : db.prepare('SELECT COUNT(*) AS n FROM call_recordings').get();
      return (row as { n: number }).n;
    },
  };
}
