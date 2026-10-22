import {
  Handshake,
  Megaphone,
  Cpu,
  Wallet,
  MessageSquare,
  Users,
  Box,
  type LucideIcon,
} from 'lucide-react';
import type { WizardProject } from './store';

/** Client-safe helpers for the Wizard surfaces (no fs, no Date.now() implicit). */

/** Runs per agent shown in the crew heatmap (two rows of 24). */
export const RUN_DOTS = 48;

const DEPT_ICONS: Record<string, LucideIcon> = {
  sales: Handshake,
  marketing: Megaphone,
  growth: Megaphone,
  tech: Cpu,
  finance: Wallet,
  comms: MessageSquare,
  communications: MessageSquare,
  clients: Users,
};

export function departmentIcon(departmentId: string | null | undefined): LucideIcon {
  const key = (departmentId ?? '').toLowerCase();
  for (const [needle, icon] of Object.entries(DEPT_ICONS)) if (key.includes(needle)) return icon;
  return Box;
}

/** Progress is structural: done/total tasks. Null when there are no tasks. */
export function projectProgress(p: Pick<WizardProject, 'tasks'>): { done: number; total: number } | null {
  if (p.tasks.length === 0) return null;
  return { done: p.tasks.filter((t) => t.state === 'done').length, total: p.tasks.length };
}

export type OwnerChip = { id: string | null; name: string };

/** Unique task owners on a project, in first-seen order. */
export function projectOwners(project: Pick<WizardProject, 'tasks'>): OwnerChip[] {
  const seen = new Set<string>();
  const out: OwnerChip[] = [];
  for (const t of project.tasks) {
    const key = t.ownerId ?? `name:${t.ownerName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: t.ownerId, name: t.ownerName });
  }
  return out;
}

/** The card's second line: the newest open task, else the last message. */
export function projectSubline(project: Pick<WizardProject, 'tasks' | 'messages'>): { label: string; text: string } {
  const open = [...project.tasks].reverse().find((t) => t.state === 'open');
  if (open) return { label: 'Task', text: open.title };
  const last = project.messages[project.messages.length - 1];
  if (last) return { label: last.role === 'user' ? 'You' : 'Wizard', text: last.text.replace(/\s+/g, ' ').slice(0, 90) };
  return { label: 'New', text: 'No messages yet' };
}

export function percent(fraction: number | null): string {
  if (fraction === null) return '—';
  return `${Math.round(fraction * 100)}%`;
}

export function tokensLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}
