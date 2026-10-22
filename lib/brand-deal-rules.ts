/**
 * The bridge between GladOS and the brand-deal daemon's tunables.
 *
 * bdpilot (the Telegram approval daemon on the mini, ~/.config/bdpilot/
 * bdpilot.py) reads `rules.json` next to itself every cycle and applies it
 * over its built-in constants: the pass threshold, qualification criteria,
 * the drafting rules (rate card included), the UNIQUE/deal hint lists
 * and the audit cadence. This module is the ONLY writer of that file from
 * the GladOS side. Every write snapshots the previous file to
 * `rules.json.bak-<stamp>` and records a `config_versions` row, so the
 * version-history button has something real behind it.
 *
 * On a machine without the daemon (the MacBook, tests) `readRules()` reports
 * `configured: false` and the UI shows Not configured + Set up — never a
 * fabricated rule set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrandDealRulesSchema, type BrandDealRules, type ConfigVersion } from '@/lib/schemas';
import type { GladosDb } from '@/lib/db';
import { dataPath, filmingMode } from '@/lib/paths';

export const BRAND_DEAL_RULES_TARGET = 'bdpilot-rules';

export function rulesPath(): string {
  // Filming mode always edits the demo copy, so a recording can never reach
  // the daemon's real config. Otherwise BDPILOT_RULES (the mini sets it), or a
  // local file in the data directory when no daemon is wired here.
  if (filmingMode()) return dataPath('demo-bdpilot-rules.json');
  return process.env.BDPILOT_RULES ?? dataPath('demo-bdpilot-rules.json');
}

export type RulesRead =
  | { configured: true; rules: BrandDealRules; path: string; updatedAt: string }
  | { configured: false; path: string; reason: string };

/** Reads the live rules file. Missing or malformed → not configured, with the reason. */
export function readRules(): RulesRead {
  const p = rulesPath();
  if (!fs.existsSync(path.dirname(p))) return { configured: false, path: p, reason: 'bdpilot is not installed on this machine' };
  if (!fs.existsSync(p)) return { configured: false, path: p, reason: 'rules.json has not been generated yet (run bdpilot.py --dump-rules > rules.json)' };
  try {
    const parsed = BrandDealRulesSchema.safeParse(JSON.parse(fs.readFileSync(p, 'utf8')));
    if (!parsed.success) return { configured: false, path: p, reason: `rules.json failed validation: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
    return { configured: true, rules: parsed.data, path: p, updatedAt: fs.statSync(p).mtime.toISOString() };
  } catch (e) {
    return { configured: false, path: p, reason: `rules.json unreadable: ${(e as Error).message}` };
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
}

/**
 * Writes a full rule set: validates, backs up the current file, writes
 * atomically (tmp + rename so the daemon never reads a half file), and
 * records a config version. Returns the version row.
 */
export function writeRules(db: GladosDb, next: BrandDealRules, note: string): ConfigVersion {
  const rules = BrandDealRulesSchema.parse(next);
  const p = rulesPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) throw new Error('bdpilot is not installed on this machine; refusing to create its config dir');
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak-${stamp()}`);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rules, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
  return db.configVersions.record(BRAND_DEAL_RULES_TARGET, rules, note);
}

/** Merges a partial edit over the live rules and writes. */
export function patchRules(db: GladosDb, patch: Partial<BrandDealRules>, note: string): { rules: BrandDealRules; version: ConfigVersion } {
  const current = readRules();
  if (!current.configured) throw new Error(current.reason);
  const merged = BrandDealRulesSchema.parse({ ...current.rules, ...patch });
  const version = writeRules(db, merged, note);
  return { rules: merged, version };
}

/** Lists the backup files next to rules.json, newest first — the hand-made
 *  history that predates config_versions, surfaced honestly. */
export function listRuleBackups(): { file: string; at: string }[] {
  const p = rulesPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${path.basename(p)}.bak-`))
    .map((f) => ({ file: f, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Which canvas step fields are BOUND to a daemon rule. A step declares
 * `config.bindings = { <fieldKey>: <ruleKey> }`; the canvas shows the live
 * rule value for that field and a save routes through PUT /api/brand-deals/
 * rules instead of the workflow row. Kept here so the seed, the API and the
 * canvas agree on the vocabulary.
 */
export const RULE_KEYS = ['pass_below', 'qual_criteria', 'draft_rules', 'unique_hints', 'deal_hints', 'audit_every_days', 'stale_days', 'max_retry_attempts'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export function isRuleKey(k: string): k is RuleKey {
  return (RULE_KEYS as readonly string[]).includes(k);
}
