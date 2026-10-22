// g-audit route plugin: the workforce pages (docs/projects/glados-ui/SPEC.md S04, GP4 FR-GP4.3, C42).
// Opens the sheets, drawers, dialogs, popovers, menus and toasts each page has, so the Classic-control
// guard and the page checks see them too. Nothing here sends: steps only open surfaces, and the audit fails
// every non-GET /api request anyway (the Tasks complete step starts a 5 s Undo window and the PATCH that
// would follow is failed). Each step starts by closing what the last one opened.

/** Click the first element matching `selector` whose text includes `text` (any when omitted). */
const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => ${JSON.stringify(text ?? '')} === '' || (e.textContent || '').includes(${JSON.stringify(text ?? '')}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text ?? ''}"`)});
  el.click();
  return 1;
})()`);

/** Escape twice: the top layer closes first (shared escape stack), then the next. */
const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(250); };
const step = (name, run) => ({ name, run: async (ctx) => { await closeAll(ctx); await run(ctx); } });

const agentSheet = step('agent sheet', (ctx) => ctx.click("[data-g='GCard'][aria-label^='Open ']"));

export const interactions = {
  '/agents': [
    agentSheet,
    step('agent sheet: schedules tab', async (ctx) => { await ctx.click("[data-g='GCard'][aria-label^='Open ']"); await ctx.sleep(300); await clickText(ctx, "[data-g='GDrawer'] [role='radio']", 'Schedules'); }),
  ],
  '/tasks': [
    step('cell add popover', async (ctx) => { await clickText(ctx, 'button', 'Show hours').catch(() => 0); await ctx.sleep(200); await ctx.click("[aria-label^='Add a task at']"); }),
    step('complete with undo toast', (ctx) => ctx.click("[data-g='GCheck']")),
    step('workload row opens the agent sheet', (ctx) => ctx.click('table[data-g="GTable"] tbody [data-g="GButton"]')),
  ],
  '/chats': [
    step('new chat roster', (ctx) => clickText(ctx, "[data-g='GButton']", 'New chat')),
    step('open a direct thread', (ctx) => ctx.click(".ch-g-rail [data-g='GRow']:nth-child(2) .g-row-main")),
    step('collapse the rail', (ctx) => ctx.click("[aria-label='Collapse the conversation list']")),
  ],
  '/wizard': [
    step('delete confirm', (ctx) => ctx.click("[aria-label='Delete project']")),
    step('new agent sheet', (ctx) => clickText(ctx, "[data-g='GButton']", 'New agent')),
    step('crew row opens the agent sheet', (ctx) => ctx.click(".wg-wz-crew [data-g='GCard']")),
    step('sessions tab', (ctx) => clickText(ctx, "[role='radio']", 'Sessions')),
  ],
  '/inbox': [
    step('open a thread', (ctx) => ctx.click("[data-g='GRow'] .g-row-main")),
    step('sort menu', (ctx) => ctx.click(".wg-ib-list [aria-haspopup='menu']")),
  ],
  '/skills': [
    step('reader', (ctx) => ctx.click(".wg-sk-card")),
    step('new skill sheet', (ctx) => clickText(ctx, "[data-g='GButton']", 'New skill')),
  ],
  '/org': [
    step('agent row opens the agent sheet', (ctx) => ctx.click(".wg-org-col [data-g='GRow'] .g-row-main")),
    step('last broadcast sheet', (ctx) => clickText(ctx, "[data-g='GButton']", 'Last broadcast').catch(() => 0)),
  ],
  '/workflows': [
    step('open a workflow', (ctx) => ctx.click('.lib-card')),
    step('more menu', async (ctx) => { await ctx.click('.lib-card').catch(() => 0); await ctx.sleep(600); await ctx.click('#btnMore'); }),
    step('new workflow modal', (ctx) => ctx.click('#btnNewWorkflow')),
  ],
};
