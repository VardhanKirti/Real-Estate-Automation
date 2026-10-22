'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WizardProject } from '@/lib/wizard/store';
import type { CrewSnapshot } from '@/lib/wizard/crew';
import type { WizardTab } from './WizardHeader';

const POLL_MS = 20_000;

/**
 * The Wizard workspace's state and real calls (projects, send, rename,
 * status, tasks, delete, 20 s polling), shared by the Classic
 * WizardWorkspace and the GladOS WizardG (glados-ui SPEC X5: the two trees
 * never fork behaviour, only presentation).
 */
export function useWizardWorkspace(initialProjects: WizardProject[], initialCrew: CrewSnapshot) {
  const [projects, setProjects] = useState(initialProjects);
  const [crew, setCrew] = useState(initialCrew);
  const [activeId, setActiveId] = useState<string | null>(initialProjects.find((p) => p.status === 'active')?.id ?? initialProjects[0]?.id ?? null);
  const [tab, setTab] = useState<WizardTab>('workspace');
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Real elapsed seconds while a send is in flight.
  const pendingStart = useRef<number | null>(null);
  useEffect(() => {
    if (!pending) return;
    pendingStart.current = Date.now();
    const id = setInterval(() => setPendingSeconds(Math.floor((Date.now() - (pendingStart.current ?? Date.now())) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  // Real polling — projects + crew every 20 s. Silent on transient failures.
  useEffect(() => {
    const id = setInterval(async () => {
      setNow(Date.now());
      try {
        const [pRes, cRes] = await Promise.all([fetch('/api/wizard/projects'), fetch('/api/wizard/crew')]);
        if (pRes.ok) {
          const b = await pRes.json();
          if (b.ok) setProjects(b.projects as WizardProject[]);
        }
        if (cRes.ok) {
          const b = await cRes.json();
          if (b.ok) setCrew(b.crew as CrewSnapshot);
        }
      } catch {
        /* keep last known state */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const replace = useCallback((project: WizardProject) => {
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
  }, []);

  const newProject = useCallback(async () => {
    const res = await fetch('/api/wizard/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();
    if (body.ok) {
      replace(body.project);
      setActiveId(body.project.id);
      setTab('workspace');
    }
  }, [replace]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/wizard/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json();
      if (out.ok) replace(out.project);
    },
    [replace],
  );

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/wizard/projects/${id}`, { method: 'DELETE' });
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      let id = activeId;
      if (!id) {
        const res = await fetch('/api/wizard/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const body = await res.json();
        if (!body.ok) return;
        replace(body.project);
        id = body.project.id as string;
        setActiveId(id);
      }
      setPending(true);
      setPendingSeconds(0);
      setEngineError(null);
      // optimistic user line so the message is on screen while the engine works
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, messages: [...p.messages, { role: 'user', text, at: new Date().toISOString() }] } : p)));
      try {
        const res = await fetch('/api/wizard/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, text }) });
        const body = await res.json().catch(() => ({ ok: false, error: `send failed (${res.status})` }));
        if (!body.ok) {
          setEngineError(res.status === 503 ? (body.error ?? 'Wizard engine unavailable on this host') : (body.error ?? `send failed (${res.status})`));
          return;
        }
        replace(body.project);
        fetch('/api/wizard/crew')
          .then((r) => r.json())
          .then((b) => b.ok && setCrew(b.crew))
          .catch(() => {});
      } catch (err) {
        setEngineError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [activeId, replace],
  );

  const active = projects.find((p) => p.id === activeId) ?? null;
  return {
    projects,
    crew,
    setCrew,
    activeId,
    setActiveId,
    active,
    tab,
    setTab,
    ownerFilter,
    setOwnerFilter,
    createOpen,
    setCreateOpen,
    pending,
    pendingSeconds,
    engineError,
    now,
    newProject,
    patch,
    remove,
    send,
  };
}
