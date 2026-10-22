'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { OsMark, Pressable } from '@/components/legacy';
import { useLogin } from '@/components/LoginForm';

/**
 * /login under Bennett Legacy (founderos-ui pages/login.md): one centred
 * 380px card on the Legacy ground, no shell. Same submit and endpoint as the
 * Classic and GladOS trees (useLogin, /api/auth/login); `<form>` keeps Enter.
 */
function Frame({ brandName, title, children }: { brandName: string; title: string; children: ReactNode }) {
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.host), []);
  return (
    <main data-l="Login" className="l-login">
      <div className="l-login-head l-rise">
        <OsMark size={40} />
        <div className="l-eyebrow">{'// OPERATOR CONSOLE'}</div>
        <h1 className="l-login-title">{title}</h1>
      </div>
      <section data-l="SlabCard" className="l-card l-login-card l-rise" aria-label={`${brandName} sign in`}>
        {children}
      </section>
      <p className="l-login-foot">
        {brandName}
        {host ? ` · ${host}` : ''}
      </p>
    </main>
  );
}

export function LoginFormL({ brandName }: { brandName: string }) {
  const { password, setPassword, error, busy, submit } = useLogin();
  return (
    <Frame brandName={brandName} title="Sign in">
      <form onSubmit={submit} className="l-login-form">
        <label htmlFor="login-password" className="l-login-label">
          Operator password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-invalid={Boolean(error)}
          className="l-login-input"
        />
        <Pressable tone="primary" type="submit" disabled={busy || password.length === 0} className="l-login-submit" title={password.length === 0 ? 'Type the password first' : undefined}>
          {busy ? 'Signing in' : 'Sign in'} <ArrowRight size={13} strokeWidth={2} aria-hidden />
        </Pressable>
        {error && (
          <p role="alert" className="l-login-error">
            {error}
          </p>
        )}
      </form>
      <p className="l-login-note">
        Set in Settings on the machine {brandName} runs on. Stored there as a hash in .env.local, never in git. Forgot it: delete the GLADOS_PASSWORD_HASH line, restart, and set a new one.
      </p>
    </Frame>
  );
}

export function NoPasswordL({ brandName }: { brandName: string }) {
  return (
    <Frame brandName={brandName} title="No password is set">
      <p className="l-login-note">Nothing is locked, so there is nothing to sign in to. Open the console directly, or set an operator password under Settings to turn sign-in on.</p>
      <div className="l-login-actions">
        <Pressable tone="primary" href="/">
          Open {brandName}
        </Pressable>
        <Pressable tone="secondary" href="/setup#security">
          Set a password
        </Pressable>
      </div>
    </Frame>
  );
}
