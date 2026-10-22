import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installAgent, installRefusal, renderPlist, type AgentDeps } from '@/lib/lab/setup/agent';

/** AC-08-12: the LaunchAgent installs on the private instance only; the rendered plist (no launchctl run). */
function deps(env: Record<string, string>, brandId = 'glados', platform: NodeJS.Platform = 'darwin') {
  const exec: { cmd: string; args: string[] }[] = [];
  const written: { p: string; c: string }[] = [];
  const log: string[] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-agent-home-'));
  const d: AgentDeps = {
    exec: (cmd, args) => (exec.push({ cmd, args }), { status: 0 }),
    log: (l) => log.push(l),
    home,
    uid: 501,
    repo: process.cwd(),
    env,
    platform,
    brandId,
    writeFile: (p, c) => written.push({ p, c }),
    markScheduled: () => log.push('marked'),
  };
  return { d, exec, written, log, home };
}

describe('AC-08-12: LaunchAgent private-only, rendered plist', () => {
  test('refuses on the demo data dir, on FounderOS, off macOS and without a data dir', () => {
    const demo = deps({ GLADOS_DATA_DIR: '/x/demo-data' });
    expect(installAgent(demo.d)).toBe(1);
    expect(demo.log[0]).toBe('Refused: GLADOS_DATA_DIR points at demo-data: the demo instance stays on fixtures.');
    expect(demo.exec).toEqual([]);
    expect(demo.written).toEqual([]);
    const client = deps({ GLADOS_DATA_DIR: '/x/data' }, 'founderos');
    expect(installAgent(client.d)).toBe(1);
    expect(client.log[0]).toMatch(/client build/);
    expect(client.exec).toEqual([]);
    expect(installRefusal({ GLADOS_DATA_DIR: '/x/data' }, 'linux', 'glados')).toBe('The LaunchAgent is macOS only.');
    expect(installRefusal({}, 'darwin', 'glados')).toMatch(/GLADOS_DATA_DIR is not set/);
  });

  // The plist template is private to the operator's host and not part of the public release.
  test.skipIf(!fs.existsSync(path.join(process.cwd(), 'deploy', 'glados.agent.lab.plist')))('the rendered plist: every 900 s, no __HOME__ placeholders, the given data dir; then bootstrap', () => {
    const ok = deps({ GLADOS_DATA_DIR: '/srv/glados/data', GLADOS_AUTOMATION_DIR: '/srv/brain/Automation', PATH: '/usr/bin' });
    expect(installAgent(ok.d)).toBe(0);
    const plist = ok.written[0].c;
    expect(ok.written[0].p).toBe(path.join(ok.home, 'Library', 'LaunchAgents', 'glados.agent.lab.plist'));
    expect(plist).toContain('<integer>900</integer>');
    expect(plist).not.toContain('__HOME__');
    expect(plist).not.toContain('__PATH__');
    expect(plist).toContain('<string>/srv/glados/data</string>');
    expect(plist).toContain('<string>/srv/brain/Automation</string>');
    expect(plist).toContain(`<string>${process.cwd()}/deploy/lab-sync.sh</string>`);
    expect(ok.exec).toEqual([{ cmd: 'launchctl', args: ['bootstrap', 'gui/501', path.join(ok.home, 'Library', 'LaunchAgents', 'glados.agent.lab.plist')] }]);
    expect(ok.log).toContain('marked');
  });

  test.skipIf(!fs.existsSync(path.join(process.cwd(), 'deploy', 'glados.agent.lab.plist')))('renderPlist replaces every placeholder in the template', () => {
    const t = fs.readFileSync(path.join(process.cwd(), 'deploy', 'glados.agent.lab.plist'), 'utf8');
    const out = renderPlist(t, { home: '/home/sample', repo: '/home/sample/glados', dataDir: '/home/sample/glados/data', automationDir: '/home/sample/Sync/brain/Automation' });
    expect(out).not.toMatch(/__[A-Z]+__/);
    expect(out).toContain('<key>WorkingDirectory</key>\n  <string>/home/sample/glados</string>');
  });
});
