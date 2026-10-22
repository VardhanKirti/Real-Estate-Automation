import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const URL = 'http://localhost/api/skills/propose';
const post = (body: unknown) =>
  new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-propose-'));
  fs.mkdirSync(path.join(dir, 'invoice-nudge'));
  fs.writeFileSync(
    path.join(dir, 'invoice-nudge', 'SKILL.md'),
    '---\nname: invoice-nudge\ndescription: Follow up on overdue client invoices and payment reminders.\n---\n',
  );
  fs.writeFileSync(path.join(dir, 'invoice-nudge', 'GROUP'), 'Finance/Collections\n');
  process.env.GLADOS_SKILLS_DIR = dir;
});

afterEach(() => {
  delete process.env.GLADOS_SKILLS_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/skills/propose', () => {
  it('proposes the real matching group from the catalog on disk', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({ description: 'chase overdue client invoices for payment' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposed).toEqual({ domain: 'Finance', group: 'Collections', path: expect.any(String) });
    expect(body.name).toBeTruthy();
    expect(body.proposed.path).toBe(`Finance/Collections/${body.name}`);
  });

  it('derives a kebab-case name when none is given', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({ description: 'Chases overdue client invoices automatically every week' }));
    const body = await res.json();
    expect(body.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('honors an explicit name, kebab-casing it', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({ description: 'Chases overdue client invoices', name: 'Invoice Chaser!!' }));
    const body = await res.json();
    expect(body.name).toBe('invoice-chaser');
  });

  it('rejects a missing description with 400', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it('rejects a too-short description with 400', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({ description: 'hi' }));
    expect(res.status).toBe(400);
  });

  it('rejects unparseable JSON with 400', async () => {
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(new Request(URL, { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('falls back to General/Uncategorised when the skills dir is empty', async () => {
    delete process.env.GLADOS_SKILLS_DIR;
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'glados-skills-empty-'));
    process.env.GLADOS_SKILLS_DIR = emptyDir;
    const { POST } = await import('@/app/api/skills/propose/route');
    const res = await POST(post({ description: 'anything at all goes here' }));
    const body = await res.json();
    expect(body.proposed).toEqual({ domain: 'General', group: 'Uncategorised', path: expect.any(String) });
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
