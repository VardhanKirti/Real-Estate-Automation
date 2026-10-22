// g-audit route plugin: Knowledge and System (docs/projects/glados-ui/SPEC.md S05, C42, GP4 FR-GP4.3).
// Opens the sheets, drawers, disclosures and sub-views of lane K's routes so the Classic-control guard
// and the page checks see them too. Nothing here sends or writes: every step only opens or reveals a
// surface, and the audit fails every non-GET /api request anyway.

/** Click the first element matching `selector` whose text includes `text` (any when omitted). */
const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => ${JSON.stringify(text ?? '')} === '' || (e.textContent || '').includes(${JSON.stringify(text ?? '')}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text ?? ''}"`)});
  el.click();
  return 1;
})()`);

/** Dispatch a click on an SVG element (no HTMLElement.click on SVG). */
const clickSvg = (ctx, selector) => ctx.ev(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error('no ' + ${JSON.stringify(selector)});
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return 1;
})()`);

const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(250); };
const step = (name, run) => ({ name, run: async (ctx) => { await closeAll(ctx); await run(ctx); await ctx.sleep(400); } });

export const interactions = {
  '/setup': [
    step('about sheet', (ctx) => ctx.click("[aria-label='About this page']")),
    step('done steps disclosure', (ctx) => clickText(ctx, '.kg-done-toggle', 'done')),
    step('password form', (ctx) => clickText(ctx, '#security button', 'password')),
  ],
  '/drift': [
    step('occurrence excerpt', (ctx) => ctx.click('.kg-drift [data-g=GChip]')),
    step('update canon diff', (ctx) => clickText(ctx, '.kg-drift button', 'Update canon')),
    step('draft correction', (ctx) => clickText(ctx, '.kg-drift button', 'Draft correction')),
    step('resolved row', (ctx) => ctx.click('[data-g=GRow] .g-row-main')),
  ],
  '/integrations': [
    step('category open', (ctx) => ctx.click('.kg-cat-toggle')),
    step('connect sheet', (ctx) => clickText(ctx, '.kg-conn button', 'Connect')),
    step('key group expand', (ctx) => clickText(ctx, '.kg-keygroup button', 'more')),
    step('key set field', (ctx) => clickText(ctx, '.kg-key button', 'Set')),
  ],
  '/integrations/whatsapp': [
    step('connect sheet', (ctx) => clickText(ctx, '.kg-connect button', 'Connect')),
  ],
  '/database': [
    step('kind filter', (ctx) => ctx.click('.kg-chips [data-g=GChip]')),
    step('drill into a folder', (ctx) => ctx.click('tr[data-g=GTableRow]')),
    step('search results', (ctx) => ctx.ev(`(() => {
      const i = document.querySelector('.kg-db-search input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(i, 'read'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1;
    })()`)),
  ],
  '/knowledge': [
    step('about sheet', (ctx) => ctx.click("[aria-label='About this page']")),
    step('record drawer', (ctx) => ctx.click('#ranking tr[data-g=GTableRow]')),
    step('more ranking rows', (ctx) => clickText(ctx, '#ranking button', 'more')),
    step('findings expand', (ctx) => ctx.click('.kg-finding-head')),
    step('all clusters sheet', (ctx) => clickText(ctx, '#matrix button', 'clusters')),
  ],
  '/brain': [
    step('about sheet', (ctx) => ctx.click("[aria-label='About this page']")),
    step('doctor sheet', (ctx) => ctx.click('[data-g=GHeroCard]')),
    step('capture card', (ctx) => ctx.click('.kg-dock-line')),
    step('radial folder view', (ctx) => clickSvg(ctx, '.kg-radial .gbr-fnode')),
    step('graph detail card', (ctx) => ctx.click('.kg-dir-row')),
    step('graph fullscreen', (ctx) => clickText(ctx, '.kg-graph-stage > button', 'Fullscreen')),
  ],
  '/blueprint': [
    step('search panel', (ctx) => ctx.click('.bh-search-pill')),
    step('kind filter', (ctx) => ctx.click('.bh-kind')),
    step('inspector', (ctx) => ctx.click('.bh-node .bh-card')),
  ],
};
