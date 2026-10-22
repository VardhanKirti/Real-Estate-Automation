/**
 * The LaunchAgent install for the private instance only (08.5.5). `npm run lab-agent -- install`
 * renders deploy/glados.agent.lab.plist from the current env, writes it to
 * ~/Library/LaunchAgents, bootstraps it with launchctl and records the schedule. It refuses on
 * FounderOS, in Filming, in dry and on the demo data dir, printing the failing condition; any
 * failure exits 1 with nothing loaded. exec and the file system are injected for tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '@/lib/brand';
import { filmingMode } from '@/lib/paths';
import { isDry } from '@/lib/lab/dry';
import { LAB_AGENT_LABEL } from '@/lib/lab/schedule';

/** The PATH scripts/mini-install.sh writes for com.brody.glados. */
export const AGENT_PATH = (home: string, envPath = '') => `${home}/.local/share/fnm:${home}/.local/bin:${envPath}:/opt/homebrew/bin:/usr/local/bin:/usr/bin`;

/** Why this machine must not install the agent, or null. */
export function installRefusal(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, brandId: string = BRAND.id): string | null {
  if (platform !== 'darwin') return 'The LaunchAgent is macOS only.';
  if (brandId !== 'glados') return 'This is a client build: schedule your own runs with `npm run lab-sync -- tick` from cron or launchd.';
  if (filmingMode()) return 'Filming mode is on: the demo instance stays on fixtures.';
  if (isDry()) return 'LAB_DRY=1: a dry instance does not install the schedule.';
  if (!env.GLADOS_DATA_DIR) return 'GLADOS_DATA_DIR is not set: run this from the private instance.';
  if (/(^|\/)demo-data(\/|$)/.test(env.GLADOS_DATA_DIR)) return 'GLADOS_DATA_DIR points at demo-data: the demo instance stays on fixtures.';
  return null;
}

/** Render the template: __HOME__, __PATH__, the repo root, the data and automation dirs. */
export function renderPlist(template: string, o: { home: string; repo: string; dataDir: string; automationDir: string; envPath?: string }): string {
  return template
    .replaceAll('__HOME__/projects/glados/data', o.dataDir)
    .replaceAll('__HOME__/Sync/brain/Automation', o.automationDir)
    .replaceAll('__HOME__/projects/glados', o.repo)
    .replaceAll('__PATH__', AGENT_PATH(o.home, o.envPath ?? ''))
    .replaceAll('__HOME__', o.home);
}

export type AgentDeps = {
  exec: (cmd: string, args: string[]) => { status: number; stdout?: string };
  log: (line: string) => void;
  home?: string;
  uid?: number;
  repo?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  brandId?: string;
  writeFile?: (p: string, content: string) => void;
  markScheduled?: () => void;
  clearSchedule?: () => void;
  heartbeat?: () => string;
};

export const plistTarget = (home: string) => path.join(home, 'Library', 'LaunchAgents', `${LAB_AGENT_LABEL}.plist`);

/** install: returns the exit code; prints each step. */
export function installAgent(d: AgentDeps): number {
  const env = d.env ?? process.env;
  const refusal = installRefusal(env, d.platform ?? process.platform, d.brandId ?? BRAND.id);
  if (refusal) {
    d.log(`Refused: ${refusal}`);
    return 1;
  }
  const home = d.home ?? os.homedir();
  const uid = d.uid ?? process.getuid?.() ?? 501;
  const repo = d.repo ?? process.cwd();
  const template = fs.readFileSync(path.join(repo, 'deploy', `${LAB_AGENT_LABEL}.plist`), 'utf8');
  const dataDir = path.resolve(env.GLADOS_DATA_DIR!);
  const automationDir = env.GLADOS_AUTOMATION_DIR ? path.resolve(env.GLADOS_AUTOMATION_DIR) : path.join(home, 'Sync', 'brain', 'Automation');
  const plist = renderPlist(template, { home, repo, dataDir, automationDir, envPath: env.PATH });
  d.log(`1. Private instance: ${repo} with data in ${dataDir}`);
  const target = plistTarget(home);
  d.log(`2. Rendered the plist (every 900 s, lab-sync tick)`);
  const write = d.writeFile ?? ((p: string, c: string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c, { mode: 0o644 });
  });
  if (fs.existsSync(target)) d.exec('launchctl', ['bootout', `gui/${uid}/${LAB_AGENT_LABEL}`]);
  write(target, plist);
  d.log(`3. Wrote ${target}`);
  const boot = d.exec('launchctl', ['bootstrap', `gui/${uid}`, target]);
  if (boot.status !== 0) {
    d.log('4. launchctl bootstrap failed: nothing is loaded.');
    return 1;
  }
  d.log(`4. Loaded ${LAB_AGENT_LABEL}`);
  d.markScheduled?.();
  d.log('5. Recorded: Every 15 minutes on this machine');
  d.log(`6. Logs: ${path.join(home, 'Library', 'Logs', `${LAB_AGENT_LABEL}.out.log`)} and ${LAB_AGENT_LABEL}.err.log`);
  return 0;
}

export function uninstallAgent(d: AgentDeps): number {
  const home = d.home ?? os.homedir();
  const uid = d.uid ?? process.getuid?.() ?? 501;
  d.exec('launchctl', ['bootout', `gui/${uid}/${LAB_AGENT_LABEL}`]);
  fs.rmSync(plistTarget(home), { force: true });
  d.clearSchedule?.();
  d.log(`Removed ${LAB_AGENT_LABEL}.`);
  return 0;
}

export function agentStatus(d: AgentDeps): number {
  const uid = d.uid ?? process.getuid?.() ?? 501;
  const r = d.exec('launchctl', ['print', `gui/${uid}/${LAB_AGENT_LABEL}`]);
  d.log(r.status === 0 ? `${LAB_AGENT_LABEL} is loaded.` : `${LAB_AGENT_LABEL} is not loaded.`);
  if (d.heartbeat) d.log(d.heartbeat());
  return r.status === 0 ? 0 : 1;
}
