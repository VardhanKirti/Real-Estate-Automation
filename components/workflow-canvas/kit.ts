/**
 * GladOS skin (glados-ui SPEC GP4.1, F-W1): DOM built here uses the kit's
 * control recipes by class. Classic control classes are swapped for kit ones
 * and every other control gets the kit class for its role; card-like buttons
 * (library and switcher cards, node chips) are marked as page composites.
 * Engine behaviour reads ids and data attributes, never these classes.
 */
const KIT_ICON = ['hud-btn', 'timer-btn', 'logs-toggle', 'ratio-collapse', 'chat-send', 'caret', 'sadd', 'add', 'sq', 'x', 'pill-set', 'pill-add'];
const KIT_CARD = ['lib-card', 'wf-card', 'ratio-mini', 'crumb', 'item'];
export function kitify(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').forEach((el) => {
    const c = el.classList;
    if ([...c].some((k) => k.startsWith('g-')) || el.hasAttribute('data-g')) return;
    const tag = el.tagName;
    if (c.contains('tb-btn')) {
      c.remove('tb-btn');
      c.add('g-btn');
      if (c.contains('tb-primary')) { c.remove('tb-primary'); c.add('g-btn-ink'); }
      if (c.contains('tb-icon')) c.add('g-btn-icon');
      return;
    }
    if (tag === 'SELECT') { c.add('g-select'); return; }
    if (tag === 'INPUT' || tag === 'TEXTAREA') { c.add('g-input'); return; }
    if (c.contains('tab')) { c.add('g-tab'); return; }
    if (KIT_ICON.some((k) => c.contains(k))) { c.add('g-btn', 'g-btn-icon', 'g-btn-sm'); return; }
    if (c.contains('btn')) { c.add('g-btn', 'g-btn-sm'); if (c.contains('primary')) c.add('g-btn-ink'); if (c.contains('danger')) c.add('g-btn-danger'); return; }
    if (c.contains('bar-btn')) { c.add('g-btn'); if (c.contains('bar-run')) c.add('g-btn-ink'); return; }
    if (el.parentElement?.classList.contains('seg')) { c.add('g-chip'); return; }
    if (KIT_CARD.some((k) => c.contains(k)) || tag === 'A') { el.setAttribute('data-g', 'WorkflowCard'); return; }
    const menu = el.closest('.menu');
    if (menu) { menu.classList.add('g-menu'); return; }
    if (el.closest('.modal-root')) { c.add('g-btn', 'g-btn-sm'); return; }
    // canvas surfaces that take focus (the canvas itself, nodes): page composites, not controls
    el.setAttribute('data-g', 'WorkflowSurface');
  });
}
