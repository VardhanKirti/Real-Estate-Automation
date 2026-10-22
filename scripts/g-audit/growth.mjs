// g-audit route plugin: Growth (docs/projects/glados-ui/SPEC.md S03, C42, GP4 FR-GP4.3).
// Opens the sheets of /social, /analytics and /adpilot so the Classic-control guard and the page checks
// see them. Nothing here sends: no reply, queue or refresh is pressed, and every non-GET /api request is
// failed by the audit anyway.

/** Click the first element matching `selector` whose text includes `text` (any when omitted). */
const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => ${JSON.stringify(text ?? '')} === '' || (e.textContent || '').includes(${JSON.stringify(text ?? '')}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text ?? ''}"`)});
  el.click();
  return 1;
})()`);

const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(250); };
const step = (name, run) => ({ name, run: async (ctx) => { await closeAll(ctx); await run(ctx); await ctx.sleep(900); } });

export const interactions = {
  '/social': [
    step('range 7d', (ctx) => clickText(ctx, "[data-g='GSegmented'] [role='radio']", '7d')),
    step('audience sheet', (ctx) => clickText(ctx, "[data-g='GHeroCard']", 'Total audience')),
    step('DM inbox sheet', (ctx) => clickText(ctx, "[data-g='GHeroCard']", 'Instagram DMs')),
    step('total DMs sheet', (ctx) => ctx.click('.soc-g-dms')),
    step('charts full size', (ctx) => ctx.click(".soc-g-chart [aria-label='Open full size']")),
  ],
  '/adpilot': [
    step('campaign selected', (ctx) => clickText(ctx, "[data-g='GSegmented'] [role='radio']", 'cold')),
    step('city card', (ctx) => clickText(ctx, '.ap-globe-chip', '')),
    step('library open: for you', (ctx) => ctx.click('.ap-g-slab')),
    step('library: search tab', async (ctx) => { await clickText(ctx, "[role='tab']", 'Search'); }),
    step('library: saved tab', (ctx) => clickText(ctx, "[role='tab']", 'Saved')),
    step('library: watchlist tab', (ctx) => clickText(ctx, "[role='tab']", 'Watchlist')),
    step('library: activity tab', (ctx) => clickText(ctx, "[role='tab']", 'Activity')),
    step('dossier', async (ctx) => { await clickText(ctx, "[role='tab']", 'For you'); await ctx.sleep(300); await ctx.click('.ap-g-adcard > .g-card'); }),
  ],
};
