import path from 'node:path';
import fs from 'node:fs';
import { parseEnvFile } from '../lib/creds';
import { createForeplayClient } from '../lib/foreplay/client';
import { runSyncCycle } from '../lib/foreplay/sync';
import { buildBrandDossier, renderDossier } from '../lib/foreplay/dossier';
import { adStore } from '../lib/foreplay/store';
import { hookLine, winners } from '../lib/foreplay/signals';

/**
 * Adscout CLI — the headless entry points (launchd on the mini calls sync).
 *
 *   npm run adscout -- sync              one watchlist sync cycle
 *   npm run adscout -- brand <domain>    sponsor ad dossier (spends credits)
 *   npm run adscout -- hooks             hook bank from stored watchlist winners
 *   npm run adscout -- status            store + credit state, no API calls
 */

// tsx doesn't auto-load .env.local the way Next does.
try {
  const env = parseEnvFile(fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8'));
  for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
} catch {
  /* no .env.local — resolveCred still checks the canonical cred files */
}

function requireClient() {
  const client = createForeplayClient();
  if (!client) {
    console.error('FOREPLAY_API_KEY not set — add it to .env.local');
    process.exit(1);
  }
  return client;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'sync') {
    const result = await runSyncCycle(requireClient());
    console.log(`Synced ${result.brands} brands · ${result.adsSeen} ads · ${result.apiCalls} API calls`);
    if (result.remainingCredits != null) console.log(`Credits remaining: ${result.remainingCredits}`);
    console.log(result.signals.length > 0 ? `Signals:\n  ${result.signals.map((s) => s.message).join('\n  ')}` : 'No new signals.');
    return;
  }

  if (cmd === 'brand') {
    if (!arg) {
      console.error('Usage: npm run adscout -- brand <domain>');
      process.exit(1);
    }
    const dossier = await buildBrandDossier(requireClient(), arg);
    console.log(dossier ? renderDossier(dossier) : `No Foreplay brand profiles found for ${arg}`);
    return;
  }

  if (cmd === 'hooks') {
    const brands = adStore.readWatchlist();
    if (brands.length === 0) {
      console.log('Store is empty — run `npm run adscout -- sync` first.');
      return;
    }
    for (const brand of brands) {
      const proven = winners(adStore.readBrandAds(brand.id), 21);
      const hooks = proven.map(hookLine).filter((h): h is string => h !== null);
      if (hooks.length === 0) continue;
      console.log(`\n${brand.name} — hooks surviving 21+ days of paid traffic:`);
      for (const hook of [...new Set(hooks)].slice(0, 10)) console.log(`  · ${hook}`);
    }
    return;
  }

  if (cmd === 'status') {
    const meta = adStore.readMeta();
    const usage = adStore.readUsage();
    const brands = adStore.readWatchlist();
    console.log(`Watchlist: ${brands.length} brands (${brands.map((b) => b.name).join(', ') || 'empty'})`);
    console.log(`Last sync: ${meta.lastSyncAt ?? 'never'} (${meta.lastSyncCalls} calls)`);
    console.log(usage ? `Credits: ${usage.remaining_credits}/${usage.total_credits}` : 'Credits: unknown until first sync');
    console.log(`Signals stored: ${adStore.readSignals().length}`);
    return;
  }

  console.error('Usage: npm run adscout -- <sync | brand <domain> | hooks | status>');
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
