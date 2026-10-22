'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** The sign-in form itself. Only ever rendered when a password actually
    exists — app/login/page.tsx redirects away when one does not. */
export function LoginForm({ brandName }: { brandName: string }) {
  const { password, setPassword, error, busy, submit } = useLogin();
  return <LoginClassic {...{ brandName, password, setPassword, error, busy, submit }} />;
}

/** Sign-in state and submit, shared by both trees of /login (GladOS: components/login/LoginG.tsx). */
export function useLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(params.get('next') || '/');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'could not sign in');
    } catch {
      setError('could not reach the server');
    } finally {
      setBusy(false);
    }
  };
  return { password, setPassword, error, busy, submit };
}

function LoginClassic({ brandName, password, setPassword, error, busy, submit }: ReturnType<typeof useLogin> & { brandName: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
          <span className="text-[15px] font-medium">{brandName}</span>
        </div>
        <p className="mb-5 text-[12.5px] text-os-dim">Operator console · sign in to continue</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Operator password"
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-[9px] border border-os-border bg-os-surface px-3.5 py-2.5 text-[13px] text-os-text outline-none transition-colors focus:border-[var(--accent-line)]"
          style={{ caretColor: 'var(--accent)' }}
        />

        {error && (
          <div className="mt-2.5 flex items-center gap-2 text-[12px]" style={{ color: 'var(--err)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--err)' }} />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="c-btn c-btn-primary mt-4 w-full justify-center py-2.5 text-[13px] disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <p className="mt-5 text-[11px] leading-relaxed text-os-dim">
          Set in Setup on the machine {brandName} runs on. Stored there as a hash in
          <span className="font-mono"> .env.local</span>, never in git. Forgot it: delete the
          <span className="font-mono"> GLADOS_PASSWORD_HASH</span> line, restart, and set a new one.
        </p>
      </form>
    </div>
  );
}
