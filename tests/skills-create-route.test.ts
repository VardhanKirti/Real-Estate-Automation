import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const URL = 'http://localhost/api/skills/create';
const post = (body: unknown) =>
  new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-create-'));
  process.env.GLADOS_SKILLS_DIR = dir;
});

afterEach(() => {
  delete process.env.GLADOS_SKILLS_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/skills/create', () => {
  it('writes a real draft skill into GLADOS_SKILLS_DIR', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(
      post({ name: 'invoice-chaser', description: 'Chases overdue invoices automatically.', domain: 'Finance', group: 'Collections' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, slug: 'invoice-chaser', path: 'Finance/Collections/invoice-chaser' });

    const md = fs.readFileSync(path.join(dir, 'invoice-chaser', 'SKILL.md'), 'utf8');
    expect(md).toContain('Chases overdue invoices automatically.');
    const group = fs.readFileSync(path.join(dir, 'invoice-chaser', 'GROUP'), 'utf8').trim();
    expect(group).toBe('Finance/Collections');
  });

  it('kebab-cases a messy name before writing', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(
      post({ name: 'My Cool Skill!!', description: 'Does something useful for the team.', domain: 'General', group: 'Uncategorised' }),
    );
    const body = await res.json();
    expect(body.slug).toBe('my-cool-skill');
    expect(fs.existsSync(path.join(dir, 'my-cool-skill', 'SKILL.md'))).toBe(true);
  });

  it('never writes outside the skills dir for a path-traversal name', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ name: '../../evil', description: 'Escapes the skills dir.', domain: 'General', group: 'Uncategorised' }));
    // no literal "evil" directory ever appears as a sibling of the temp skills dir
    expect(fs.existsSync(path.join(dir, '..', 'evil'))).toBe(false);
    if (res.status === 200) {
      const body = await res.json();
      const resolved = path.resolve(dir, body.slug);
      expect(resolved.startsWith(path.resolve(dir) + path.sep)).toBe(true);
    } else {
      expect(res.status).toBe(400);
    }
  });

  it('rejects a missing name with 400', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ description: 'A description long enough.', domain: 'General', group: 'Uncategorised' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing domain/group with 400', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ name: 'x', description: 'A description long enough.' }));
    expect(res.status).toBe(400);
  });

  it('rejects a too-short description with 400', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ name: 'x', description: 'short', domain: 'General', group: 'Uncategorised' }));
    expect(res.status).toBe(400);
  });

  it('rejects unparseable JSON with 400', async () => {
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(new Request(URL, { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('refuses a collision with an existing skill directory', async () => {
    fs.mkdirSync(path.join(dir, 'taken'));
    fs.writeFileSync(path.join(dir, 'taken', 'SKILL.md'), '---\nname: taken\n---\n');
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ name: 'taken', description: 'A description long enough.', domain: 'General', group: 'Uncategorised' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/);
  });

  it('honestly errors, no pretend success, when the skills dir does not exist', async () => {
    delete process.env.GLADOS_SKILLS_DIR;
    process.env.GLADOS_SKILLS_DIR = path.join(tmpdir(), 'glados-skills-missing-' + Date.now());
    const { POST } = await import('@/app/api/skills/create/route');
    const res = await POST(post({ name: 'x', description: 'A description long enough.', domain: 'General', group: 'Uncategorised' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not found/);
  });
});
