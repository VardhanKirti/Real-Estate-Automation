// g-audit route plugin: Content Lab v2 (docs/projects/content-lab/v2/spec/02-components.md 15.3 item 8,
// lane U1). Opens surfaces only, nothing sends: the audit fails every non-GET /api request. On Today: the
// first Your posts tile (Post sheet), the Window card (Event sheet), the PlusButton menu, the Setup sheet via
// the RoundButton, focus in the SearchPill, the PeriodScrubber one step right, the Segmented to Ask the Lab
// and back. Each step first closes what the last one opened (Escape twice). The other five pages open their
// first sheet-opening row. `pixelContrast` gives every Lab route the pixel-sampled contrast check.

const closeAll = async (ctx) => { await ctx.press('Escape'); await ctx.sleep(150); await ctx.press('Escape'); await ctx.sleep(350); };
const step = (name, run) => ({ name, run: async (ctx) => { await closeAll(ctx); await run(ctx); await ctx.sleep(900); } });
const clickFirst = (ctx, selectors) => ctx.ev(`(() => {
  for (const s of ${JSON.stringify(selectors)}) { const el = document.querySelector(s); if (el) { el.click(); return s; } }
  throw new Error('none of ' + ${JSON.stringify(selectors.join(' | '))});
})()`);

const today = [
  step('post sheet', (ctx) => clickFirst(ctx, ["section[data-lab='TileRow'] a[data-lab='Tile']"])),
  step('event sheet', (ctx) => clickFirst(ctx, ["[data-lab='NarrativeCard'][data-kind='window'] a", "section[data-lab='TileRow'] a[data-lab='Tile'][href*='event=']"])),
  step('create menu', (ctx) => clickFirst(ctx, ["[data-lab='PlusButton'] button[aria-haspopup='menu']"])),
  step('setup sheet', (ctx) => clickFirst(ctx, ["a[data-lab-shared='setup-menu']", "[data-lab-shared='setup-menu']"])),
  step('search focus', (ctx) => ctx.ev("(() => { const i = document.querySelector('.lab2-search input'); if (!i) throw new Error('no search'); i.focus(); return 1; })()")),
  step('scrubber right', (ctx) => ctx.ev(`(() => {
    const s = document.querySelector("[data-lab='PeriodScrubber'] [role='slider']");
    if (!s) throw new Error('no scrubber');
    s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return 1;
  })()`)),
  step('ask the lab', async (ctx) => {
    await ctx.ev(`(() => { const t = [...document.querySelectorAll("[data-lab='Segmented'] [role='tab']")]; if (t.length < 2) throw new Error('no segmented'); t[1].click(); return 1; })()`);
    await ctx.sleep(700);
    await ctx.ev(`(() => { const t = document.querySelectorAll("[data-lab='Segmented'] [role='tab']"); t[0].click(); return 1; })()`);
  }),
];

const firstSheet = (selectors) => [step('first sheet', (ctx) => clickFirst(ctx, selectors))];

export const interactions = {
  '/lab': today,
  '/lab/radar': [
    ...firstSheet(['.lab2g-lane-link', "a[href*='event=']"]),
    // the Watching rows sit in a closed <details>: open it so their text is judged rendered (fo/fixups)
    step('watching open', (ctx) => ctx.ev(`(() => { const d = document.querySelector('details.lab2g-watching'); if (!d) return 0; d.open = true; d.scrollIntoView({ block: 'center' }); return 1; })()`)),
  ],
  '/lab/breakouts': firstSheet(['.lab2g-postcard', "a[href*='post=']"]),
  '/lab/playbook': firstSheet(['.lab2g-lift-main']),
  '/lab/studio': firstSheet(["a[href*='script=']"]),
  '/lab/ledger': firstSheet(["a[href*='test=']", "a[href*='post=']"]),
};

const PIXEL = ['[data-lab-ink]', '[data-lab-mark]'];
export const pixelContrast = Object.fromEntries(Object.keys(interactions).map((r) => [r, PIXEL]));
