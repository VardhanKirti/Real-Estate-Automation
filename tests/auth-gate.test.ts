import { describe, expect, test } from 'vitest';
import { decideGate, hostnameOf, isLoopbackHost, isOpenPath, parseTrustedHosts, requestOriginOf, type GateInput } from '@/lib/auth-gate';

const base: GateInput = {
  pathname: '/',
  method: 'GET',
  hostname: 'localhost',
  origin: null,
  requestOrigin: 'http://localhost:4100',
  configured: true,
  authed: false,
};
const gate = (over: Partial<GateInput>) => decideGate({ ...base, ...over }).kind;

describe('isLoopbackHost', () => {
  test('accepts the loopback spellings a browser can produce', () => {
    for (const h of ['localhost', 'LOCALHOST', 'glados.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });
  test('rejects everything else, including private and Tailscale ranges', () => {
    for (const h of ['192.168.1.20', '100.64.0.10', '10.0.0.2', '0.0.0.0', 'glados.example.com', '']) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });
});

describe('reading the real Host (self-hosted Next reports its internal host on nextUrl)', () => {
  test('hostnameOf strips the port and IPv6 brackets', () => {
    expect(hostnameOf('localhost:4100')).toBe('localhost');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:4100')).toBe('::1');
    expect(hostnameOf('100.64.0.10:4100')).toBe('100.64.0.10');
    expect(hostnameOf('')).toBe('');
    expect(hostnameOf(null)).toBe('');
  });
  test('requestOriginOf prefers forwarded headers and defaults to http', () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
    expect(requestOriginOf(h({ host: '127.0.0.1:4811' }))).toEqual({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:4811' });
    expect(requestOriginOf(h({ host: 'internal:4100', 'x-forwarded-host': 'os.example.com', 'x-forwarded-proto': 'https' }))).toEqual({
      hostname: 'os.example.com',
      origin: 'https://os.example.com',
    });
  });
});

describe('open paths', () => {
  test('login, its endpoint, the status probe and webhooks skip the gate', () => {
    expect(isOpenPath('/login')).toBe(true);
    expect(isOpenPath('/api/auth/login')).toBe(true);
    expect(isOpenPath('/api/auth/check')).toBe(true);
    expect(isOpenPath('/api/webhooks/manychat')).toBe(true);
    expect(isOpenPath('/api/auth/password')).toBe(false);
    expect(isOpenPath('/setup')).toBe(false);
  });
  test('open paths pass even when locked and remote', () => {
    expect(gate({ pathname: '/login', hostname: '192.168.1.5', configured: false })).toBe('pass');
    expect(gate({ pathname: '/api/auth/check', configured: true, authed: false })).toBe('pass');
  });
});

describe('no password set (fresh download)', () => {
  test('loopback requests pass straight through, pages and APIs alike', () => {
    expect(gate({ configured: false, pathname: '/' })).toBe('pass');
    expect(gate({ configured: false, pathname: '/setup', hostname: '127.0.0.1' })).toBe('pass');
    expect(gate({ configured: false, pathname: '/api/agents', hostname: '[::1]' })).toBe('pass');
    expect(gate({ configured: false, pathname: '/api/auth/password', method: 'POST' })).toBe('pass');
  });
  test('any non-loopback Host is refused until a password exists', () => {
    expect(gate({ configured: false, hostname: '192.168.1.20' })).toBe('unconfigured-remote');
    expect(gate({ configured: false, hostname: '100.64.0.10', pathname: '/api/keys' })).toBe('unconfigured-remote');
  });
  test('a cross-site POST cannot set the password on an open install', () => {
    expect(
      gate({
        configured: false,
        pathname: '/api/auth/password',
        method: 'POST',
        origin: 'https://evil.example',
      }),
    ).toBe('cross-origin');
    expect(
      gate({ configured: false, pathname: '/api/auth/password', method: 'POST', origin: 'http://localhost:4100' }),
    ).toBe('pass');
  });
});

describe('password set', () => {
  test('without a session: APIs get 401, pages go to /login', () => {
    expect(gate({ pathname: '/api/keys' })).toBe('unauthorized-api');
    expect(gate({ pathname: '/setup' })).toBe('redirect-login');
    expect(gate({ pathname: '/', hostname: '192.168.1.20' })).toBe('redirect-login');
  });
  test('with a session everything passes, from any host', () => {
    expect(gate({ authed: true, pathname: '/setup' })).toBe('pass');
    expect(gate({ authed: true, pathname: '/api/keys', method: 'POST', hostname: '100.64.0.10' })).toBe('pass');
  });
  test('a session does not excuse a cross-origin mutation', () => {
    expect(gate({ authed: true, pathname: '/api/keys', method: 'POST', origin: 'https://evil.example' })).toBe('cross-origin');
    expect(gate({ authed: true, pathname: '/api/keys', method: 'GET', origin: 'https://evil.example' })).toBe('pass');
    expect(gate({ authed: true, pathname: '/api/keys', method: 'DELETE', origin: 'http://localhost:4100' })).toBe('pass');
  });
});

describe('trusted hosts (filming aliases)', () => {
  test('parses a comma list, trims, lowercases and drops blanks', () => {
    expect(parseTrustedHosts(' GladOS.com , demo.local ,, ')).toEqual(['glados.com', 'demo.local']);
    expect(parseTrustedHosts(null)).toEqual([]);
    expect(parseTrustedHosts('')).toEqual([]);
  });

  test('an unconfigured install still refuses an unlisted host', () => {
    expect(gate({ configured: false, hostname: 'glados.com' })).toBe('unconfigured-remote');
  });

  test('a listed host is treated as this machine while no password is set', () => {
    expect(gate({ configured: false, hostname: 'glados.com', trustedHosts: ['glados.com'] })).toBe('pass');
    expect(gate({ configured: false, hostname: 'GLADOS.COM', trustedHosts: ['glados.com'] })).toBe('pass');
  });

  test('the list does not weaken a configured install — login still required', () => {
    expect(gate({ configured: true, authed: false, hostname: 'glados.com', trustedHosts: ['glados.com'] })).toBe(
      'redirect-login',
    );
    expect(
      gate({ configured: true, authed: false, pathname: '/api/agents', hostname: 'glados.com', trustedHosts: ['glados.com'] }),
    ).toBe('unauthorized-api');
  });

  test('the list does not disable the CSRF origin check', () => {
    expect(
      gate({
        configured: false,
        method: 'POST',
        hostname: 'glados.com',
        trustedHosts: ['glados.com'],
        origin: 'http://evil.example',
      }),
    ).toBe('cross-origin');
  });
});
