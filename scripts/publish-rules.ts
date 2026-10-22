/**
 * What the client repo never receives. Shared by scripts/publish-oss.ts (the
 * publisher, private-only) and tests/no-personal-data.test.ts (the guard,
 * published), so the guard scans exactly the files a publish would ship.
 *
 * Exclusions are a DENYLIST of paths that must never leave, backed by a hard
 * rule: anything under data/, demo-data/, filming/ or operator/ is refused
 * outright, whatever the lists say, so a future edit cannot quietly start
 * publishing the operator's stores.
 */

/**
 * Never published: the operator's data, the filming world, this machine's
 * deployment, and the internal project board. The client repo gets the code
 * and a blank install, nothing else.
 */
export const EXCLUDE_EXACT: ReadonlySet<string> = new Set([
  '.env.demo', // filming profile
  '.glados-mode', // per-machine toggle state (gitignored anyway)
  'DEMO.md', // filming notes (older layout; now filming/DEMO.md)
  'docs/PROJECTS.md', // the operator's project board
  'docs/CONTEXT.md',
  'docs/MINI-DEPLOY.md', // the operator's mac mini
  'scripts/mini-install.sh',
  'scripts/mini-backup.sh',
  'scripts/publish-oss.ts', // this publisher lives with the private repo
  // internal specs and history from the private lineage
  'docs/AD-INTEL-SCAFFOLD.md',
  'docs/ADPILOT-V2-SCAFFOLD.md',
  'docs/BRAND-DEALS-SPEC.md',
  'docs/CONTENT-V3-SCAFFOLD.md',
  'docs/DESIGN-CONSOLE.md',
  'docs/DESIGN-GBRAIN.md',
  'docs/REAL-DATA-IMPORT.md',
  'docs/REVERT-v1.md',
  'docs/SECURITY.md',
  'docs/UI-AUDIT-2026-08-13.md',
  'docs/WIZARD-BLUEPRINT-SCAFFOLD.md',
  'docs/WIZARD-BLUEPRINT-V2-SCAFFOLD.md',
  'docs/handoff-wizard.md',
  'docs/workflows-canvas.md',
  'public/content-media/hf-thumb-01.jpg', // the operator's own production thumbnail
]);

/** Never published, by prefix. */
export const EXCLUDE_PREFIX: readonly string[] = [
  'data/',
  'demo-data/',
  'filming/', // the demo world and its snapshot
  'operator/', // starter files for the operator's real data directory
  'deploy/', // the operator's launchd service
  'docs/projects/', // internal project folders
];

/** Never published, by pattern: the operator's photos and design screenshots. */
export const EXCLUDE_PATTERN: readonly RegExp[] = [
  /^public\/agents\/.+\.(png|jpe?g|webp)$/i,
  /^public\/content-media\/identity\//, // the operator's identity stills
  /^docs\/workflows-canvas-.+\.png$/,
];

/** Directories refused outright, whatever the lists above say. */
export const NEVER_PUBLISH_DIRS: readonly string[] = ['data', 'demo-data', 'filming', 'operator'];

/** Files the OSS repo owns that this repo does not, and must keep. */
export const OSS_KEEP: ReadonlySet<string> = new Set(['LICENSE']);

export function excluded(rel: string): boolean {
  if (EXCLUDE_EXACT.has(rel)) return true;
  if (EXCLUDE_PATTERN.some((re) => re.test(rel))) return true;
  return EXCLUDE_PREFIX.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p));
}

/** Hard stop: data/ may never be published, regardless of the lists above. */
export function assertPublishable(rel: string): void {
  for (const dir of NEVER_PUBLISH_DIRS) {
    if (rel === dir || rel.startsWith(`${dir}/`)) {
      throw new Error(`publish-oss: refusing to publish ${rel} — ${dir}/ never leaves this repo`);
    }
  }
}

/** The subset of `files` (repo-relative paths) a publish would ship. */
export function publishable(files: readonly string[]): string[] {
  const out = files.filter((f) => !excluded(f));
  out.forEach(assertPublishable);
  return out;
}
