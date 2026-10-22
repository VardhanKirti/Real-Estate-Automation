import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WIZARD_OPEN_EVENT,
  groupBroadcastReplies,
  mergeDraft,
  nextBroadcast,
  openWizard,
  sendEndpoint,
} from '@/lib/wizard-dock';

/** GP2: the Wizard dock's prefill and broadcast API (docs/projects/glados-ui/SPEC.md). */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('mergeDraft (FR-GP2.4, ACGP2.3)', () => {
  it('an empty draft takes the incoming text, trimmed', () => {
    expect(mergeDraft('', '  status of brand deals ')).toBe('status of brand deals');
    expect(mergeDraft('   ', 'hi')).toBe('hi');
  });
  it('an existing draft is kept and the text appended on a new line', () => {
    expect(mergeDraft('draft one', 'status of brand deals')).toBe('draft one\nstatus of brand deals');
    expect(mergeDraft('draft one  ', 'two')).toBe('draft one\ntwo');
  });
  it('a single-line composer joins with its own separator', () => {
    expect(mergeDraft('draft one', 'status of brand deals', ' ')).toBe('draft one status of brand deals');
  });
  it('blank or missing text never touches the draft', () => {
    expect(mergeDraft('keep me', undefined)).toBe('keep me');
    expect(mergeDraft('keep me', '   ')).toBe('keep me');
  });
});

describe('broadcast chip and routing (FR-GP2.2, ACGP2.2)', () => {
  it('an explicit flag sets the chip; omitted keeps it', () => {
    expect(nextBroadcast(false, true)).toBe(true);
    expect(nextBroadcast(true, false)).toBe(false);
    expect(nextBroadcast(true, undefined)).toBe(true);
    expect(nextBroadcast(false, undefined)).toBe(false);
  });
  it('on sends to the broadcast route, off to the conductor', () => {
    expect(sendEndpoint(true)).toBe('/api/agents/broadcast');
    expect(sendEndpoint(false)).toBe('/api/agents/conductor/chat');
  });
  it('the routes exist with a POST handler', () => {
    expect(read('app/api/agents/broadcast/route.ts')).toMatch(/export async function POST/);
    // /api/agents/conductor/chat is the [id] chat route with id = conductor
    expect(read('app/api/agents/[id]/chat/route.ts')).toMatch(/export async function POST/);
  });
});

describe('groupBroadcastReplies', () => {
  it('groups by agent in first-seen order and keeps failures', () => {
    const groups = groupBroadcastReplies([
      { agentId: 'a', ok: true, reply: 'one' },
      { agentId: 'b', ok: false, reply: 'boom' },
      { agentId: 'a', ok: true, reply: 'two' },
    ]);
    expect(groups.map((g) => g.agentId)).toEqual(['a', 'b']);
    expect(groups[0].replies.map((r) => r.reply)).toEqual(['one', 'two']);
    expect(groups[1].replies[0]).toEqual({ agentId: 'b', ok: false, reply: 'boom' });
  });
  it('drops malformed rows and survives a non-array', () => {
    expect(groupBroadcastReplies(null)).toEqual([]);
    expect(groupBroadcastReplies([null, 3, { ok: true }, { agentId: '', reply: 'x' }])).toEqual([]);
    expect(groupBroadcastReplies([{ agentId: 'a' }])).toEqual([{ agentId: 'a', replies: [{ agentId: 'a', ok: false, reply: '' }] }]);
  });
});

describe('openWizard (FR-GP2.1)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('dispatches wizard:open with the detail', () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener(WIZARD_OPEN_EVENT, (e) => seen.push((e as CustomEvent).detail));
    vi.stubGlobal('window', target);
    openWizard({ text: 'status of brand deals', broadcast: true, source: 'test' });
    expect(seen).toEqual([{ text: 'status of brand deals', broadcast: true, source: 'test' }]);
  });
  it('the dock listens for it, never sends on prefill, and resets the chip after a send', () => {
    const src = read('components/ConductorPanel.tsx');
    expect(src).toContain('window.addEventListener(WIZARD_OPEN_EVENT');
    // the prefill handler only sets state and opens; send() is never called from it
    const handler = src.slice(src.indexOf('const onWizard'), src.indexOf('window.addEventListener(WIZARD_OPEN_EVENT'));
    expect(handler).not.toMatch(/send\(/);
    expect(src).toMatch(/setBroadcast\(false\); \/\/ the chip resets after each send/);
    expect(src).toContain('fetch(sendEndpoint(toAll)');
    // both trees offer the chip (FR-GP2.4: the dock is shell, both styles)
    expect(src.match(/Send to every agent\s*</g)?.length).toBe(2);
  });
});
