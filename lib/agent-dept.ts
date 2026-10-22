import type { Department } from '@/lib/schemas';

/**
 * `/agents?dept=<id|slug|name>`: the department a link asks the Agents page to
 * show (the Social content crew card links `/agents?dept=growth`, lib/social-crew.ts).
 * Exact id, slug or name first (case-insensitive); otherwise the one department
 * whose slug or name contains the term ("growth" → Marketing/Growth). Null when
 * the URL names none; `department: null` when it names one this install does not
 * have, so the page can say so instead of quietly showing everyone.
 */
export type DeptFilter = { param: string; department: Pick<Department, 'id' | 'name'> | null } | null;

export function departmentFromParam(departments: Department[], raw: string | string[] | null | undefined): DeptFilter {
  const param = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!param) return null;
  const q = param.toLowerCase();
  const exact = departments.find((d) => d.id.toLowerCase() === q || d.slug.toLowerCase() === q || d.name.toLowerCase() === q);
  const loose = exact ? [exact] : departments.filter((d) => d.slug.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  const hit = loose.length === 1 ? loose[0] : null;
  return { param, department: hit ? { id: hit.id, name: hit.name } : null };
}
