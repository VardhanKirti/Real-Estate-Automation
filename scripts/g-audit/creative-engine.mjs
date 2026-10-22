// g-audit route plugin: the Creative Engine (docs/projects/glados-ui/SPEC.md GP1, ACGP1.4, GP4 FR-GP4.3).
// Opens every sheet, drawer, popover and menu the engine has, so the Classic-control guard and the page
// checks see them too. Nothing here sends: every step only opens a surface (non-GET /api requests are failed
// by the audit anyway). Steps run in order on one page; each starts by closing whatever the last one opened.
// The same steps run for /creative-engine and /creative-engine?engine=console; each acts only on its own.

/** Click the first element matching `selector` whose text includes `text` (any when omitted). */
const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => ${JSON.stringify(text ?? '')} === '' || (e.textContent || '').includes(${JSON.stringify(text ?? '')}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text ?? ''}"`)});
  el.click();
  return 1;
})()`);

const isConsole = (ctx) => ctx.ev(`location.search.includes('engine=console')`);

/** Escape twice: the top layer closes first (shared escape stack), then the next. */
const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(250); };

const dashboard = (name, run) => ({ name, run: async (ctx) => { if (await isConsole(ctx)) return; await closeAll(ctx); await run(ctx); } });
const consoleStep = (name, run) => ({ name, run: async (ctx) => { if (!(await isConsole(ctx))) return; await run(ctx); } });

const SHEETS = ['Creative generator', 'Ad scripter', 'Briefings', 'UGC studio', 'Proof library', 'Runs', 'Credits & health'];

export const interactions = {
  '/creative-engine': [
    dashboard('campaign switcher', (ctx) => ctx.click("[data-g='GPill'][aria-haspopup]")),
    dashboard('campaign actions menu', (ctx) => ctx.click("[aria-label='Campaign actions']")),
    dashboard('delete confirm', async (ctx) => { await ctx.click("[aria-label='Campaign actions']"); await ctx.sleep(200); await clickText(ctx, "[role='menuitem']", 'Delete campaign'); }),
    ...SHEETS.map((label) => dashboard(`sheet: ${label}`, (ctx) => clickText(ctx, '.ae-dash-pills button', label))),
    dashboard('sheet: Connect Arcads', (ctx) => ctx.ev(`(() => { const u = new URL(location.href); u.searchParams.set('engine', 'connect'); history.replaceState(null, '', u); return 1; })()`).then(() => clickText(ctx, '.ae-dash-pills button', 'Credits & health')).then(() => ctx.sleep(400)).then(() => clickText(ctx, "[data-g='GDrawer'] button", 'Settings').catch(() => clickText(ctx, "[data-g='GDrawer'] button", 'Connect')))),
    dashboard('runs tab', (ctx) => clickText(ctx, "[role='tab']", 'Runs')),
    consoleStep('console menu', (ctx) => ctx.click("[aria-label='Console menu']")),
    consoleStep('column menu', async (ctx) => { await ctx.press('Escape'); await clickText(ctx, '.ae-o-colhead button', 'Shot'); }),
    consoleStep('presets tab', async (ctx) => { await ctx.press('Escape'); await clickText(ctx, "[role='tab']", 'Presets'); }),
    consoleStep('refs tab', (ctx) => clickText(ctx, "[role='tab']", 'Refs')),
    consoleStep('shortcuts panel', (ctx) => ctx.click("[aria-label='Console menu']").then(() => ctx.sleep(200)).then(() => clickText(ctx, "[role='menuitem']", 'Keyboard shortcuts'))),
    consoleStep('cost preview', (ctx) => ctx.click("[aria-label='Cost preview']")),
  ],
};
