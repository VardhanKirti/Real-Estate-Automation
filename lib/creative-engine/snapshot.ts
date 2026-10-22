import { readCreditsSnapshot, readHealth, readLedger, readSettings } from '@/lib/creative-engine/store';
import { adStore } from '@/lib/foreplay/store';
import { resolveArcadsAuth } from '@/lib/arcads/client';
import { createForeplayClient } from '@/lib/foreplay/client';
import { engineStatus } from '@/lib/wizard/claude';
import { dryEnvName, envDry, isDry } from '@/lib/creative-engine/dry';
import { filmingMode } from '@/lib/paths';
import { sessionSpend } from '@/lib/creative-engine/generate';
import { setupHrefFor } from '@/lib/integrations-catalog';
import type { HealthSnapshot } from '@/lib/creative-engine/schemas';

/** Everything the Credits & health surfaces show, from stored facts only. One builder for the page and the route. */
export async function buildHealthSnapshot(): Promise<HealthSnapshot> {
  const ledger = readLedger();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const month = Math.round(ledger.filter((e) => !e.dry && new Date(e.at) >= monthStart).reduce((s, e) => s + e.creditsCharged, 0) * 100) / 100;
  const usage = adStore.readUsage();
  const engine = await engineStatus();
  const settings = readSettings();
  const session = sessionSpend();
  // S03 FR-18 / S04 B24: a stored usage figure is shown only while Foreplay
  // is configured; otherwise it is stale and would contradict "Set up".
  const foreplayConfigured = isDry() || !!createForeplayClient();
  return {
    ok: true,
    dry: isDry(),
    dryEnv: envDry(),
    dryEnvName: dryEnvName(),
    filming: filmingMode(),
    foreplay: { configured: foreplayConfigured, remaining: foreplayConfigured ? usage?.remaining_credits ?? null : null, total: foreplayConfigured ? usage?.total_credits ?? null : null, lastSyncAt: adStore.readMeta().lastSyncAt, setupHref: setupHrefFor('foreplay') },
    arcads: {
      configured: isDry() || !!resolveArcadsAuth(),
      health: readHealth(),
      creditsThisMonth: month,
      sessionSpent: session.spent,
      sessionCap: session.cap,
      sessionSince: session.since,
      ledgerEntries: ledger.length,
      balance: readCreditsSnapshot(),
      productId: settings.arcadsProductId,
      productName: settings.arcadsProductName,
      ugcPath: settings.ugcPath,
      setupHref: setupHrefFor('arcads'),
    },
    claude: { present: engine.present, version: engine.version },
  };
}
