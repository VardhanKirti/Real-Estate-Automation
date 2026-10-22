/**
 * One Escape stack for the whole app (SPEC X1).
 *
 * Every layer that closes on Escape (dialog, sheet, drawer, popover, palette,
 * dock, a sidebar drag in progress) registers here when it opens. A single
 * `keydown` listener on `window` calls only the TOP handler, so "Escape closes
 * the innermost layer only" holds across surfaces: the order of the stack is
 * the order of opening.
 *
 * An element that has something of its own to clear on Escape (an input with
 * an answer to wipe, a menu inside a field) handles the key itself and calls
 * `preventDefault()`. The window listener runs in the bubble phase, after it,
 * sees `defaultPrevented` and does nothing; the next Escape reaches the stack.
 * A plain text input that does nothing with Escape does not swallow it, so
 * Escape inside a dialog's input closes the dialog.
 */

export type EscapeHandler = (event: KeyboardEvent) => void;

type Entry = { id: string; handler: EscapeHandler; token: symbol };

const stack: Entry[] = [];
let installed = false;
let anon = 0;

function onKeyDown(event: KeyboardEvent): void {
  dispatchEscape(event);
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  installed = true;
}

function uninstall(): void {
  if (!installed || typeof window === 'undefined') return;
  window.removeEventListener('keydown', onKeyDown);
  installed = false;
}

/**
 * Register an Escape handler on top of the stack. Returns the disposer that
 * removes exactly this registration (safe to call twice).
 *
 * Pushing an `id` that is already on the stack replaces that entry's handler
 * in place and keeps its position: a layer re-registering on re-render must
 * not jump above layers opened after it.
 */
export function pushEscape(handler: EscapeHandler, opts: { id?: string } = {}): () => void {
  const id = opts.id ?? `escape-${++anon}`;
  const token = Symbol(id);
  const existing = stack.findIndex((e) => e.id === id);
  if (existing >= 0) stack[existing] = { id, handler, token };
  else stack.push({ id, handler, token });
  install();
  return () => {
    const i = stack.findIndex((e) => e.token === token);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) uninstall();
  };
}

/**
 * Route one keyboard event. Returns true when a layer handled it. Exported
 * for tests and for surfaces that receive key events outside `window`
 * (an iframe or a canvas that stops propagation can forward them here).
 */
export function dispatchEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' && event.key !== 'Esc') return false;
  if (event.defaultPrevented || event.isComposing) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  event.preventDefault();
  top.handler(event);
  return true;
}

/** Number of open layers. */
export function escapeDepth(): number {
  return stack.length;
}

/** Id of the layer the next Escape closes, or null. */
export function topEscapeId(): string | null {
  return stack[stack.length - 1]?.id ?? null;
}

/** Whether `id` is currently the top layer. */
export function isTopEscape(id: string): boolean {
  return topEscapeId() === id;
}

/** Test hook: empty the stack and detach the listener. */
export function resetEscapeStackForTests(): void {
  stack.length = 0;
  uninstall();
  anon = 0;
}
