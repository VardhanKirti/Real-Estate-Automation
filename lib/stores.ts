import os from 'node:os';
import path from 'node:path';
import { dataPath, filmingMode } from '@/lib/paths';

/**
 * Every store that lives OUTSIDE the database: the brain, the skills folder,
 * the brand-deal daemon's files, the engine CLI. Normally each comes from its
 * setting or a default under the home folder. With Filming mode on, every one
 * of them points inside demo-data/ instead, so flipping the switch moves the
 * whole OS onto the demo world at once, with no restart and no settings file
 * hard-wired to demo paths.
 *
 * Functions, never module constants: the mode can change between requests.
 */

const home = () => os.homedir();

/** The markdown brain store. */
export function brainStoreDir(): string {
  if (filmingMode()) return dataPath('brain');
  return process.env.GBRAIN_STORE ?? path.join(home(), 'knowledge', 'brain-store');
}

/** The engine CLI. Filming uses demo-data's stub, which answers from the demo brain. */
export function gbrainBin(): string {
  if (filmingMode()) return dataPath('bin', 'gbrain');
  return process.env.GBRAIN_BIN ?? 'gbrain';
}

/** True when a gbrain binary is explicitly configured (Filming always is). */
export function gbrainConfigured(): boolean {
  return filmingMode() || Boolean(process.env.GBRAIN_BIN);
}

/** The skills folder (one sub-folder per skill, each with a SKILL.md). */
export function skillsDir(): string {
  if (filmingMode()) return dataPath('skills');
  return process.env.GLADOS_SKILLS_DIR || path.join(home(), '.claude', 'skills');
}

/** The brand-deal daemon's state file. */
export function bdpilotStatePath(): string {
  if (filmingMode()) return dataPath('bdpilot', 'state.json');
  return process.env.BDPILOT_STATE ?? path.join(home(), '.config', 'bdpilot', 'state.json');
}

/** The brand-deal daemon's log. */
export function bdpilotLogPath(): string {
  if (filmingMode()) return dataPath('bdpilot', 'bdpilot.log');
  return process.env.BDPILOT_LOG ?? path.join(home(), '.config', 'bdpilot', 'bdpilot.log');
}

/** The daemon's pending-list snapshot, when one is used instead of running it. */
export function bdpilotListFile(): string | undefined {
  if (filmingMode()) return dataPath('bdpilot', 'pending.tsv');
  return process.env.BDPILOT_LIST_FILE;
}

/** Which brain provider answers search. Filming always uses gbrain (the stub). */
export function brainProviderName(): string {
  if (filmingMode()) return 'gbrain';
  return process.env.BRAIN_PROVIDER ?? 'gbrain';
}

/** Whether the funnel reads a live CRM. Filming never does: it shows the seeded book. */
export function funnelProviderName(): string {
  if (filmingMode()) return 'seed';
  return process.env.FUNNEL_PROVIDER ?? 'attio';
}
