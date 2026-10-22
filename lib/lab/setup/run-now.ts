/**
 * Detached `lab-sync tick` starts (09.4.3 follow-on stages, 09.5.4 Run now). Analysis and paid
 * jobs never run inside a page request: the route spawns the CLI detached and returns at once.
 * Tests replace the spawner.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { LabJobId } from '@/lib/schemas';

export type TickSpawn = (args: string[]) => void;

const realSpawn: TickSpawn = (args) => {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const child = spawn(tsx, ['scripts/lab-sync.ts', ...args], { cwd: process.cwd(), detached: true, stdio: 'ignore', env: process.env });
  child.unref();
};
let impl: TickSpawn = realSpawn;
export function setTickSpawn(fn: TickSpawn | null): void {
  impl = fn ?? realSpawn;
}

/** `lab-sync tick --only <job>... [--force] [--manual] [--override] [--batch <id>]`, detached. */
export function spawnTick(o: { only: LabJobId[]; force?: boolean; manual?: boolean; override?: boolean; batchId?: string | null }): string[] {
  const args = ['tick', ...o.only.flatMap((j) => ['--only', j]), ...(o.force ? ['--force'] : []), ...(o.manual ? ['--manual'] : []), ...(o.override ? ['--override'] : []), ...(o.batchId ? ['--batch', o.batchId] : [])];
  impl(args);
  return args;
}
