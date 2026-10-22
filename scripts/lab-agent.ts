import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnvFile } from '../lib/creds';
import { resolveLab } from '../lib/lab/context';
import { markScheduled } from '../lib/lab/schedule';
import { healthResults } from '../lib/lab/setup/health';
import { agentStatus, installAgent, uninstallAgent, type AgentDeps } from '../lib/lab/setup/agent';

/**
 * The Content Lab LaunchAgent (v2 spec 08.5.5), private instance only.
 *   npm run lab-agent -- install     render deploy/glados.agent.lab.plist, write it to
 *                                    ~/Library/LaunchAgents, bootstrap it, record the schedule
 *   npm run lab-agent -- uninstall   bootout, delete the plist, delete the `schedule` prior
 *   npm run lab-agent -- status      launchctl print plus the scheduler heartbeat
 * Install refuses on FounderOS, in Filming, in dry and on the demo data dir.
 */
try {
  const env = parseEnvFile(fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8'));
  for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
} catch {
  /* no .env.local */
}

const deps: AgentDeps = {
  exec: (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout };
  },
  log: (line) => console.log(line),
  markScheduled: () => markScheduled(resolveLab().store, new Date()),
  clearSchedule: () => {
    resolveLab().store.priors.remove('schedule');
  },
  heartbeat: () => {
    const h = healthResults(resolveLab().store).find((x) => x.id === 'schedule.heartbeat');
    return h ? `Heartbeat: ${h.state}, ${h.detail}` : 'Heartbeat: unknown';
  },
};

const cmd = process.argv[2];
const code = cmd === 'install' ? installAgent(deps) : cmd === 'uninstall' ? uninstallAgent(deps) : cmd === 'status' ? agentStatus(deps) : (console.error('Usage: npm run lab-agent -- install | uninstall | status'), 1);
process.exit(code);
