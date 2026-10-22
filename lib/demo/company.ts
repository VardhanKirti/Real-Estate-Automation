import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { GladosDb } from '@/lib/db';
import { dataPath } from '@/lib/paths';
import type { Agent, AgentCron, AgentRun, AgentTaskInput, FunnelContact, FunnelTouch, Skill, SopTask, Workflow } from '@/lib/schemas';

/**
 * FounderOS site snapshot: the site's demo company (fos/lib/demo on the site,
 * exported by scripts/glados/export-demo.ts) laid over the GladOS demo store.
 *
 * The site's Agents and Social screens draw this company directly, so every
 * GladOS screen around them has to show the same agents, clients and numbers.
 * Tables the site models are cleared and refilled from it; tables it does not
 * (tools, people, phases, the email list) keep the FounderOS demo seed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Site = any;

/** The site's departments onto GladOS's pillar ids (the ids are load-bearing in
 *  GladOS: lenses, setup and the graph key on them). Names come from the site. */
export const DEPT: Record<string, string> = {
  'dept-growth': 'dept-sales',
  'dept-content': 'dept-marketing-growth',
  'dept-ops': 'dept-tech',
  'dept-finance': 'dept-finance',
  'dept-client': 'dept-clients',
  'dept-intel': 'dept-comms',
};
const dept = (id: string): string => DEPT[id] ?? id;

const REPLACED = [
  'agents',
  'agent_tasks',
  'agent_runs',
  'agent_crons',
  'agent_messages',
  'cron_runs',
  'sop_tasks',
  'workflows',
  'workflow_versions',
  'skills',
  'roadmap_items',
  'funnel_contacts',
  'funnel_touches',
  'social_accounts',
  'social_snapshots',
  'social_dms',
  'social_dm_messages',
  'social_dm_snapshots',
  'trading_snapshots',
  'trading_positions',
  'trading_activity',
];

const DAY = 86_400_000;
const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10);

export function clearSiteTables(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.pragma('foreign_keys = OFF');
  const have = new Set((raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  for (const t of REPLACED) if (have.has(t)) raw.prepare(`DELETE FROM ${t}`).run();
  raw.close();
}

export function seedFromSite(db: GladosDb, site: Site): void {
  const now = Date.now();

  // ── Departments: GladOS ids, the site's names ─────────────────────────────
  for (const d of site.roster.OS_DEPARTMENTS as { id: string; name: string; tagline: string }[]) {
    const current = db.departments.all().find((x) => x.id === dept(d.id));
    if (current) db.departments.insert({ ...current, name: d.name, tagline: d.tagline });
  }

  // ── Agents: the site's roster, as its Agents screen shows it ──────────────
  for (const a of site.roster.OS_AGENTS as Agent[]) {
    db.agents.insert({
      ...a,
      departmentId: dept(a.departmentId),
      tier: a.id === 'ag-atlas' ? 'lead' : 'specialist',
      // The site says paused and draft; GladOS says idle and planned.
      status: ({ paused: 'idle', draft: 'planned' } as Record<string, Agent['status']>)[a.status as string] ?? a.status,
    });
  }
  // The Wizard (conductor) sits above the roster, as on the site's org chart.
  const conductor = site.org.CONDUCTOR as Agent;
  db.agents.insert({ ...conductor, departmentId: dept(conductor.departmentId), id: 'conductor', status: 'active', tier: 'lead', parentId: null });
  for (const t of site.roster.SOP_TASKS as SopTask[]) db.sopTasks.insert({ ...t, departmentId: dept(t.departmentId) });

  // ── Work: tasks, crons, runs, chats ───────────────────────────────────────
  (site.work.TASKS as AgentTaskInput[]).forEach((t, i) => {
    db.agentTasks.insert({
      ...t,
      // The site's board has a review lane; GladOS reads that as waiting on you.
      status: (t.status as string) === 'review' ? 'blocked' : t.status,
      priority: i % 5 === 0 ? 'high' : i % 3 === 0 ? 'low' : 'normal',
      dueAt: t.status === 'done' ? null : new Date(now + ((i % 6) - 1) * DAY).toISOString(),
    });
  });
  const crons = site.work.CRONS as AgentCron[];
  for (const c of crons) db.agentCrons.insert(c);
  (site.work.CRON_RUNS as { startedAt: string; ok: boolean }[]).forEach((r, i) => {
    const c = crons[i % crons.length];
    db.cronRuns.insert({
      id: `cron-run-${i}`,
      cronId: c.id,
      agentId: c.agentId,
      startedAt: r.startedAt,
      finishedAt: new Date(Date.parse(r.startedAt) + 40_000 + (i % 9) * 7_000).toISOString(),
      ok: r.ok,
      summary: r.ok ? `${c.description}: done.` : `${c.description}: failed, retried on the next tick.`,
      trigger: 'schedule',
    });
  });
  for (const r of site.work.AGENT_RUNS as AgentRun[]) db.agentRuns.insert(r);
  for (const [, thread] of Object.entries(site.chats.CHAT_THREADS as Record<string, unknown[]>)) {
    for (const m of thread) db.agentMessages.insert(m as Parameters<GladosDb['agentMessages']['insert']>[0]);
  }

  // ── Roadmap and phases: the site's plan, same rows as its Roadmap screen ─
  for (const { phaseId: _phase, ...r } of site.reference.ROADMAP_ITEMS as (Parameters<GladosDb['roadmap']['insert']>[0] & { phaseId?: string })[]) db.roadmap.insert(r);
  for (const p of site.reference.PHASES as Parameters<GladosDb['phases']['insert']>[0][]) db.phases.insert(p);

  // ── Workflows and skills ──────────────────────────────────────────────────
  for (const w of site.work.WORKFLOWS as Workflow[]) db.workflows.insert(w, 'site demo');
  for (const s of site.work.SKILLS as Skill[]) db.skills.insert(s);

  // ── Funnel: the site's sixteen clients and their journeys ─────────────────
  type Journey = FunnelContact & { touches: FunnelTouch[] };
  const journeys = [...(site.business.FUNNEL_JOURNEYS as Journey[]), ...(site.funnelArchive.ARCHIVED_JOURNEYS as Journey[])];
  for (const j of journeys) {
    const { touches, ...contact } = j;
    const first = touches[0]?.at ?? ymd(now);
    db.funnel.insertContact({ ...contact, createdAt: contact.createdAt ?? `${first}T09:00:00.000Z` } as FunnelContact);
    for (const t of touches ?? []) db.funnel.insertTouch(t);
  }

  // ── Social: accounts, 90 days of follower history ending at today's count ─
  const dash = site.analytics.DASH.platforms as { platform: 'youtube' | 'instagram' | 'twitter' | 'tiktok' | 'linkedin'; handle: string; followers: number }[];
  dash.forEach((p, i) => {
    db.social.upsertAccount({ platform: p.platform, handle: p.handle, url: null, order: i });
    const weekly = site.analytics.SNAPSHOTS[p.platform] as number[];
    const end = p.followers;
    const start = Math.round(weekly[0] * (end / weekly[weekly.length - 1]) * 0.86);
    for (let d = 89; d >= 0; d--) {
      const f = (89 - d) / 89;
      const wobble = Math.sin((89 - d) * 0.7 + i) * 0.004 * end;
      const followers = d === 0 ? end : Math.max(0, Math.round(start + (end - start) * f * f * 0.4 + (end - start) * f * 0.6 + wobble));
      db.social.insertSnapshot({ platform: p.platform, capturedAt: ymd(now - d * DAY), followers, source: 'zernio' });
    }
  });
  const dms = site.social.DM_INBOX as { messages: Parameters<GladosDb['social']['upsertDmMessage']>[0][] }[];
  for (const t of dms) for (const m of t.messages) db.social.upsertDmMessage(m);
  const dmTotal = site.social.DM_GROWTH.allTime as number;
  db.social.upsertDm({ platform: 'instagram', count: dmTotal, updatedAt: new Date(now).toISOString() });
  for (let d = 59; d >= 0; d--) {
    db.social.insertDmSnapshot({ platform: 'instagram', capturedAt: ymd(now - d * DAY), count: Math.round(dmTotal * (1 - d * 0.0065)), source: 'manychat' });
  }

  // ── Trading ───────────────────────────────────────────────────────────────
  const tp = site.trading.TRADING_PAYLOAD;
  for (const acct of tp.accounts as { accountId: string }[]) {
    db.trading.recordSnapshot(
      acct as Parameters<GladosDb['trading']['recordSnapshot']>[0],
      (tp.positions as { accountId: string }[]).filter((p) => p.accountId === acct.accountId) as Parameters<GladosDb['trading']['recordSnapshot']>[1],
    );
  }
  for (const a of tp.activity as Parameters<GladosDb['trading']['recordActivity']>[0][]) db.trading.recordActivity(a);
}

/** Files outside the database that GladOS screens read in filming mode. */
export function writeSiteFiles(site: Site): void {
  const now = Date.now();

  // AdPilot: the site's three campaigns.
  fs.writeFileSync(dataPath('adpilot-campaigns.json'), JSON.stringify({ campaigns: site.business.AD_CAMPAIGNS, syncedAt: new Date(now - 40 * 60_000).toISOString() }, null, 2));

  // Skills on disk: one SKILL.md per skill, grouped like the site's catalog.
  for (const s of site.work.SKILLS as Skill[]) {
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const dir = dataPath('skills', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${s.description}\n---\n\n${s.markdown}\n`);
  }

  // Brand deals: the approval daemon's state, log and pending drafts, from the site's deals.
  const deals = site.business.BRAND_DEALS as { brand: string; status: string; dealValueUsd: number | null; contactName: string; lastEdited: string }[];
  const announced: Record<string, number> = {};
  const tags: Record<string, [string, string]> = {};
  const summaries: Record<string, string> = {};
  const chains: Record<string, string[]> = {};
  const done: string[] = [];
  const log: string[] = [];
  const pending: string[] = [];
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mail = (brand: string) => `partnerships@${brand.toLowerCase().replace(/[^a-z]+/g, '')}.example`;
  deals.forEach((d, i) => {
    const id = `r-${1040 + i}`;
    const at = Date.parse(d.lastEdited);
    const sent = !['New', 'Negotiating', 'Aligned'].includes(d.status);
    announced[id] = Math.floor(at / 1000);
    tags[id] = (d.dealValueUsd ?? 0) >= 12000 ? ['UNIQUE', 'Category fit and a budget above the floor'] : ['NORMAL', ''];
    summaries[id] = `${d.brand} wants a ${['YouTube integration', 'newsletter feature', 'podcast read'][i % 3]}. ${d.status === 'Declined' ? 'Declined on timing.' : d.dealValueUsd ? `Budget around $${d.dealValueUsd.toLocaleString('en-US')}.` : 'No budget named yet.'}`;
    const day = new Date(at - DAY).toUTCString().slice(0, 22);
    const ask = d.dealValueUsd ? `For an integration in the main video we are at $${d.dealValueUsd.toLocaleString('en-US')}, which includes the newsletter mention.` : 'Happy to share rates once we know the format you have in mind.';
    chains[id] = [
      `Full chain, 2 messages\n<b>${esc(d.contactName)}</b> <i>${day}</i> <blockquote expandable>Hi, we have been following the channel and think ${esc(d.brand)} fits your audience. Would you be open to a partnership this quarter?</blockquote>\n<b>Operator</b> <i>${new Date(at).toUTCString().slice(0, 22)}</i> <blockquote expandable>Thanks for reaching out. ${esc(ask)}</blockquote>`,
    ];
    log.push(`${new Date(at - 3 * 3_600_000).toISOString()}\tannounced ${id} -> "${d.brand}" <${mail(d.brand)}>`);
    if (sent) {
      done.push(id);
      log.push(`${new Date(at).toISOString()}\t${d.status === 'Declined' ? 'skipped' : 'sent'} ${id}`);
    } else {
      pending.push(`${id}\t"${d.brand}" <${mail(d.brand)}>\tRe: ${d.brand} x FounderOS partnership`);
    }
  });
  // Drift: claims from calls and threads that contradict the canon, with the evidence.
  const dayAgo = (n: number) => new Date(now - n * DAY).toISOString().slice(0, 10);
  const drift = [
    {
      id: 'drift-onboarding-days',
      claim: 'Onboarding takes three weeks',
      confidence: 'high',
      state: 'new',
      detectedAt: new Date(now - 5 * 3_600_000).toISOString(),
      canon: { file: 'writing/sop-sop-10.md', passage: 'Prepare an onboarding pack: assemble the scope, book the kickoff, send day one. Live inside ten working days.' },
      occurrences: [
        { source: 'Call with Halden & Roe', speaker: 'Pike', date: dayAgo(2), excerpt: 'Realistically you are looking at three weeks before the inboxes are live.' },
        { source: 'Email to Calder Supply', speaker: 'Vera', date: dayAgo(4), excerpt: 'Onboarding usually runs about three weeks end to end.' },
        { source: 'Slack #client-northwind', speaker: 'Koda', date: dayAgo(6), excerpt: 'told them three weeks for onboarding, same as last time' },
      ],
    },
    {
      id: 'drift-retainer-floor',
      claim: 'The retainer starts at $3,500 a month',
      confidence: 'high',
      state: 'reviewed',
      detectedAt: new Date(now - 2 * DAY).toISOString(),
      canon: { file: 'writing/skill-skill-1.md', passage: 'Retainers start at $4,500 a month. Hold the price; trade scope, not rate.' },
      occurrences: [
        { source: 'Call with Ossington Partners', speaker: 'Beacon', date: dayAgo(3), excerpt: 'Retainers start around three and a half a month.' },
        { source: 'DM thread, Kestrel Health', speaker: 'Lark', date: dayAgo(5), excerpt: 'Monthly support starts at $3.5k.' },
        { source: 'Proposal draft, Dunmore Foods', speaker: 'Nomad', date: dayAgo(8), excerpt: 'Ongoing retainer: $3,500 per month.' },
      ],
    },
    {
      id: 'drift-newsletter-day',
      claim: 'The newsletter goes out on Fridays',
      confidence: 'medium',
      state: 'new',
      detectedAt: new Date(now - 9 * 3_600_000).toISOString(),
      canon: { file: 'projects/workflow-wf-content.md', passage: 'Wren writes the weekly newsletter from what shipped; it sends Tuesday at 9am.' },
      occurrences: [
        { source: 'Content standup notes', speaker: 'Juno', date: dayAgo(1), excerpt: 'Friday send, so the hooks need to be in by Thursday.' },
        { source: 'Reply to a reader', speaker: 'Lark', date: dayAgo(3), excerpt: 'It lands every Friday morning.' },
        { source: 'Sponsor brief, Hollis Audio', speaker: 'Wren', date: dayAgo(7), excerpt: 'Placement runs in the Friday issue.' },
      ],
    },
    {
      id: 'drift-reconcile-cadence',
      claim: 'Books are reconciled weekly',
      confidence: 'medium',
      state: 'resolved',
      detectedAt: new Date(now - 11 * DAY).toISOString(),
      canon: { file: 'writing/sop-sop-8.md', passage: 'Reconcile the day: match charges to the ledger every night and raise the exceptions as work.' },
      occurrences: [
        { source: 'Board pack draft', speaker: 'Tessel', date: dayAgo(12), excerpt: 'Ledger reconciled weekly against the bank feed.' },
        { source: 'Call with the bookkeeper', speaker: 'Sable', date: dayAgo(13), excerpt: 'We close the books every Friday.' },
        { source: 'Slack #finance', speaker: 'Brisk', date: dayAgo(14), excerpt: 'weekly recon is done, two exceptions' },
      ],
    },
  ];
  fs.writeFileSync(dataPath('drift.json'), JSON.stringify(drift, null, 2));

  // Wizard: three projects the operator handed over, in their own words.
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const task = (id: string, title: string, ownerId: string, ownerName: string, doneH: number | null, h: number) => ({
    id, title, ownerId, ownerName, state: doneH == null ? 'open' : 'done', createdAt: at(h), doneAt: doneH == null ? null : at(doneH),
  });
  const project = (id: string, name: string, status: 'active' | 'done', h: number, ask: string, reply: string, tasks: ReturnType<typeof task>[]) => ({
    id, name, status, sessionId: null, model: 'claude-sonnet-5',
    messages: [
      { role: 'user', text: ask, at: at(h) },
      { role: 'wizard', text: reply, at: at(h - 0.05), receipts: tasks.map((t) => ({ kind: 'task', label: `${t.ownerName}: ${t.title}` })) },
    ],
    tasks, lastUsage: { inputTokens: 18400, outputTokens: 2900, costUsd: 0.098, durationMs: 21400, turns: 4 }, totalCostUsd: 0.31,
    createdAt: at(h), updatedAt: at(Math.max(1, h - 6)),
  });
  const projects = [
    project('wp-halden', 'Get Halden & Roe live by the 14th', 'active', 30,
      'Halden & Roe signed. I want them live by the 14th without me chasing anyone.',
      'Split it three ways: Pike builds the onboarding pack, Vera takes the scope change reply, Atlas puts the kickoff on the plan. I will move it to done when all three close.',
      [task('wt-1', 'Assemble the onboarding pack', 'ag-pike', 'Pike', 20, 30), task('wt-2', 'Reply on the scope change', 'ag-vera', 'Vera', null, 30), task('wt-3', 'Book the kickoff and add it to the plan', 'ag-atlas', 'Atlas', 26, 30)]),
    project('wp-september', 'Close September', 'active', 54,
      'Close the books for September and tell me what changed against plan.',
      'Sable reconciles the month against the bank feed, Brisk chases the two invoices past thirty days, and Tessel writes the board pack once both are in.',
      [task('wt-4', 'Reconcile September against the bank export', 'ag-sable', 'Sable', 40, 54), task('wt-5', 'Chase the two overdue invoices', 'ag-brisk', 'Brisk', null, 54), task('wt-6', 'Write the September board pack', 'ag-tessel', 'Tessel', null, 54)]),
    project('wp-launch', 'Launch week content', 'done', 140,
      'Turn the launch call into a week of content.',
      'Quill drafts the article from the transcript, Ember cuts six clips, Cinder schedules them across the week and Wren writes the newsletter around it.',
      [task('wt-7', 'Draft the article from the launch call', 'ag-quill', 'Quill', 120, 140), task('wt-8', 'Cut six clips', 'ag-ember', 'Ember', 110, 140), task('wt-9', 'Schedule the week', 'ag-cinder', 'Cinder', 100, 140), task('wt-10', 'Write the launch newsletter', 'ag-wren', 'Wren', 96, 140)]),
  ];
  fs.mkdirSync(dataPath('wizard'), { recursive: true });
  fs.writeFileSync(dataPath('wizard', 'projects.json'), JSON.stringify(projects, null, 2));

  fs.mkdirSync(dataPath('bdpilot'), { recursive: true });
  fs.writeFileSync(dataPath('bdpilot', 'state.json'), JSON.stringify({ announced, done, tags, summaries, chains }, null, 2));
  fs.writeFileSync(dataPath('bdpilot', 'bdpilot.log'), `${log.sort().join('\n')}\n`);
  fs.writeFileSync(dataPath('bdpilot', 'pending.tsv'), `${pending.join('\n')}\n`);
}
