/**
 * The run progress poller (03.8, 09.4.3, C20), as a plain controller so its timing is testable without
 * a browser (AC-09-20). `LabRunProvider` (useLabRun.tsx) wraps it in the /lab layout so it survives
 * navigation between the six pages.
 *
 * - 4 s while the batch is live, 8 s once it is 2 minutes old, 15 s after 10 minutes.
 * - A failed request doubles the interval up to 60 s; a success resets it.
 * - No polls while the tab is hidden; one immediate poll when it is shown again.
 * - Stops when the batch is `done`, `failed` or `stopped` (the caller then refreshes the page once).
 * - Nothing is kept in the browser: a reload resumes from `frame.run.activeBatch`.
 */
import type { BatchProgress } from '@/lib/lab/setup/progress';

export const POLL_MS = { base: 4000, after2m: 8000, after10m: 15000, max: 60000 } as const;
const TWO_MIN = 120_000;
const TEN_MIN = 600_000;

/** The interval before the next poll for a batch of this age, after `failures` failed requests in a row. */
export function pollDelay(ageMs: number, failures: number): number {
  const base = ageMs >= TEN_MIN ? POLL_MS.after10m : ageMs >= TWO_MIN ? POLL_MS.after2m : POLL_MS.base;
  if (failures <= 0) return base;
  return Math.min(POLL_MS.max, base * 2 ** failures);
}

export function isTerminalBatch(b: Pick<BatchProgress, 'state'> | null): boolean {
  return !b || b.state === 'done' || b.state === 'failed' || b.state === 'stopped';
}

export type RunPollerDeps = {
  fetchBatch: (batchId: string) => Promise<BatchProgress | null>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  hidden: () => boolean;
  onUpdate: (b: BatchProgress) => void;
  onEnd: (b: BatchProgress | null) => void;
};

export class RunPoller {
  private batchId: string | null = null;
  private startedAt: number | null = null;
  private failures = 0;
  private timer: unknown = null;
  private inFlight = false;
  private waitingForVisible = false;
  /** Every delay the poller scheduled, newest last (read by tests and the motion audit). */
  readonly delays: number[] = [];

  constructor(private deps: RunPollerDeps) {}

  get active(): string | null {
    return this.batchId;
  }

  /** Start or resume polling a batch; a different batch replaces the current one. */
  resume(batchId: string | null): void {
    if (!batchId) return;
    if (batchId === this.batchId) return;
    this.stop();
    this.batchId = batchId;
    this.failures = 0;
    this.startedAt = null;
    void this.poll();
  }

  stop(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.batchId = null;
    this.waitingForVisible = false;
  }

  /** Call on `visibilitychange`. Hidden: drop the pending timer. Shown: one immediate poll. */
  visibilityChanged(): void {
    if (!this.batchId) return;
    if (this.deps.hidden()) {
      if (this.timer !== null) this.deps.clearTimer(this.timer);
      this.timer = null;
      this.waitingForVisible = true;
      return;
    }
    if (this.waitingForVisible || this.timer === null) {
      this.waitingForVisible = false;
      if (this.timer !== null) this.deps.clearTimer(this.timer);
      this.timer = null;
      void this.poll();
    }
  }

  private schedule(): void {
    if (!this.batchId) return;
    if (this.deps.hidden()) {
      this.waitingForVisible = true;
      return;
    }
    const age = this.startedAt === null ? 0 : this.deps.now() - this.startedAt;
    const ms = pollDelay(age, this.failures);
    this.delays.push(ms);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.poll();
    }, ms);
  }

  private async poll(): Promise<void> {
    const id = this.batchId;
    if (!id || this.inFlight) return;
    if (this.deps.hidden()) {
      this.waitingForVisible = true;
      return;
    }
    this.inFlight = true;
    try {
      const b = await this.deps.fetchBatch(id);
      if (id !== this.batchId) return;
      this.failures = 0;
      if (!b) {
        this.stop();
        this.deps.onEnd(null);
        return;
      }
      if (this.startedAt === null) {
        const t = Date.parse(b.startedAt);
        this.startedAt = Number.isFinite(t) ? this.deps.now() - Math.max(0, Date.now() - t) : this.deps.now();
      }
      this.deps.onUpdate(b);
      if (isTerminalBatch(b)) {
        this.stop();
        this.deps.onEnd(b);
        return;
      }
      this.schedule();
    } catch {
      if (id !== this.batchId) return;
      this.failures += 1;
      this.schedule();
    } finally {
      this.inFlight = false;
    }
  }
}
