import { Suspense } from 'react';
import Link from 'next/link';
import { isConfigured } from '@/lib/auth';
import { LoginForm } from '@/components/LoginForm';
import { BRAND } from '@/lib/brand';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { LoginFormG, NoPasswordG } from '@/components/login/LoginG';
import { LoginFormL, NoPasswordL } from '@/components/login/LoginL';

export const dynamic = 'force-dynamic';

/**
 * The one page reachable without a session.
 *
 * When no password exists there is nothing to sign in to: the form cannot
 * succeed, because there is no hash to check a password against. It says so
 * rather than showing a working-looking password box.
 *
 * It states this instead of redirecting home. The middleware fails CLOSED — if
 * its probe cannot answer it treats the host as locked and sends you here — so
 * a redirect out of this page would bounce against that and loop.
 */
export default function LoginPage() {
  // Two trees (glados-ui SPEC X5, S05 F05.101); both render without the shell (H37).
  const tree = treeFor(getAppearance(), '/login');
  if (tree === 'glados') {
    if (!isConfigured()) return <NoPasswordG brandName={BRAND.name} mark={BRAND.mark} />;
    return (
      <Suspense fallback={null}>
        <LoginFormG brandName={BRAND.name} mark={BRAND.mark} />
      </Suspense>
    );
  }
  // Bennett Legacy tree (founderos-ui pages/login.md).
  if (tree === 'legacy') {
    if (!isConfigured()) return <NoPasswordL brandName={BRAND.name} />;
    return (
      <Suspense fallback={null}>
        <LoginFormL brandName={BRAND.name} />
      </Suspense>
    );
  }
  if (!isConfigured()) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="w-full max-w-[340px]">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
            <span className="text-[15px] font-medium">{BRAND.name}</span>
          </div>
          <p className="mb-5 text-[12.5px] text-os-dim">No password is set on this install</p>
          <p className="text-[12.5px] leading-relaxed text-os-dim">
            Nothing is locked, so there is nothing to sign in to. Open the console directly, or set an
            operator password under Setup to turn sign-in on.
          </p>
          <div className="mt-5 flex gap-2.5">
            <Link href="/" className="c-btn c-btn-primary justify-center px-3.5 py-2 text-[13px]">
              Open {BRAND.name}
            </Link>
            <Link href="/setup" className="c-btn justify-center px-3.5 py-2 text-[13px]">
              Set a password
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center text-[12.5px] text-os-dim">Loading…</div>}>
      <LoginForm brandName={BRAND.name} />
    </Suspense>
  );
}
