// g-audit route plugin: Revenue (docs/projects/glados-ui/SPEC.md S02, C42, GP4 FR-GP4.3).
// Opens the drawers, menus and filter states of /brand-deals, /finances and /funnel so the Classic-control
// guard and the page checks see them. Nothing here sends: Send is only armed, never confirmed, and every
// non-GET /api request is failed by the audit anyway.

/** Click the first element matching `selector` whose text includes `text` (any when omitted). */
const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => ${JSON.stringify(text ?? '')} === '' || (e.textContent || '').includes(${JSON.stringify(text ?? '')}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text ?? ''}"`)});
  el.click();
  return 1;
})()`);

const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(250); };
const step = (name, run) => ({ name, run: async (ctx) => { await closeAll(ctx); await run(ctx); } });

export const interactions = {
  '/brand-deals': [
    step('closed: lost segment', (ctx) => ctx.click("[data-seg='lost']")),
    step('chain depth filter', (ctx) => clickText(ctx, "[data-g='GDotMatrix'] button", '2-3')),
    step('deal drawer (needs approval), Send armed', async (ctx) => {
      await clickText(ctx, "[role='radio']", 'Needs approval');
      await ctx.sleep(200);
      await ctx.click('.bd-g-row .g-row-main');
      await ctx.sleep(400);
      await clickText(ctx, "[data-g='GDrawer'] button", 'Send as the verified sender');
    }),
  ],
  '/finances': [
    step('second category selected', (ctx) => clickText(ctx, "[data-g='GBarChart'] [role='radio']", 'Course')),
    step('business metric: net', (ctx) => clickText(ctx, "[data-g='GSegmented'] [role='radio']", 'Net')),
    step('values hidden', (ctx) => clickText(ctx, "[data-g='GButton'][aria-pressed]", 'Visible')),
    step('values shown again', (ctx) => clickText(ctx, "[data-g='GButton'][aria-pressed]", 'Hidden')),
  ],
  '/funnel': [
    step('period menu', (ctx) => ctx.click("[aria-label^='Period:']")),
    step('slash token menu', async (ctx) => {
      await ctx.click("[data-g='GAskInput']");
      await ctx.ev(`(() => { const i = document.querySelector("[data-g='GAskInput']"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '/'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    }),
    step('view: push and save', (ctx) => clickText(ctx, "[aria-label='Funnel views'] [role='radio']", 'Save now')),
    step('view: journeys', (ctx) => clickText(ctx, "[aria-label='Funnel views'] [role='radio']", 'Journeys')),
    step('lead drawer', (ctx) => ctx.click("[data-g='GTable'] tbody tr[data-action]")),
    step('view: archive', (ctx) => clickText(ctx, "[aria-label='Funnel views'] [role='radio']", 'Archive')),
    step('back to overview', (ctx) => clickText(ctx, "[aria-label='Funnel views'] [role='radio']", 'Overview')),
  ],
};
