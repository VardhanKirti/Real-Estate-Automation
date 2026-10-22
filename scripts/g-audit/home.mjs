// g-audit route plugin: Home (docs/projects/glados-ui/SPEC.md S01, C42, GP4 FR-GP4.3).
// Opens the G-Brain Details drawer and the chart's keyboard readout so the Classic-control guard and the
// page checks see them. Nothing here sends; Copy is never clicked.

const clickText = (ctx, selector, text) => ctx.ev(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.textContent || '').includes(${JSON.stringify(text)}));
  if (!el) throw new Error('no ' + ${JSON.stringify(`${selector} "${text}"`)});
  el.click();
  return 1;
})()`);

export const interactions = {
  '/': [
    { name: 'details drawer', run: (ctx) => clickText(ctx, "[data-g='GButton']", 'Details') },
    {
      name: 'chart keyboard readout',
      run: async (ctx) => {
        await ctx.press('Escape');
        await ctx.sleep(250);
        await ctx.ev(`(() => { const el = document.querySelector('[data-h6-chart]'); if (!el) throw new Error('no chart'); el.focus(); return 1; })()`);
        await ctx.press('End');
      },
    },
  ],
};
