import { afterEach, describe, expect, test } from 'vitest';
import { webinarjamStatus, listRegistrants } from '@/lib/connectors/webinarjam';
import { trakyoStatus } from '@/lib/connectors/trakyo';

const WJ = 'WEBINARJAM_API_KEY';
const TK = 'TRAKYO_API_KEY';
const prevWj = process.env[WJ];
const prevTk = process.env[TK];

afterEach(() => {
  if (prevWj === undefined) delete process.env[WJ];
  else process.env[WJ] = prevWj;
  if (prevTk === undefined) delete process.env[TK];
  else process.env[TK] = prevTk;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('webinarjamStatus', () => {
  test('not_configured without a key — and makes no network call', async () => {
    delete process.env[WJ];
    let called = false;
    const status = await webinarjamStatus((async () => {
      called = true;
      return json({});
    }) as typeof fetch);
    expect(status.state).toBe('not_configured');
    expect(status.id).toBe('webinarjam');
    expect(status.kind).toBe('crm');
    expect(called).toBe(false);
  });

  test('connected when the key validates against the webinars endpoint', async () => {
    process.env[WJ] = 'wj_test';
    const status = await webinarjamStatus((async () =>
      json({ status: 'success', webinars: [{ webinar_id: 1 }, { webinar_id: 2 }] })) as typeof fetch);
    expect(status.state).toBe('connected');
    expect(status.detail).toContain('2');
  });

  test('error when the key is present but the API rejects it', async () => {
    process.env[WJ] = 'bad';
    const status = await webinarjamStatus((async () => json({ error: 'unauthorized' }, 401)) as typeof fetch);
    expect(status.state).toBe('error');
  });

  test('listRegistrants posts api_key + ids and returns the registrants', async () => {
    process.env[WJ] = 'wj_test';
    let sentBody = '';
    const regs = await listRegistrants('123', '456', (async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return json({ status: 'success', registrants: [{ name: 'Lead A' }] });
    }) as typeof fetch);
    expect(regs).toHaveLength(1);
    expect(sentBody).toContain('123'); // webinar_id in the form body
    expect(sentBody).toContain('456'); // schedule_id
  });
});

describe('trakyoStatus', () => {
  test('honest not_configured without a key, and no request is made', async () => {
    delete process.env[TK];
    let called = false;
    const status = await trakyoStatus((async () => {
      called = true;
      throw new Error('no request expected');
    }) as unknown as typeof fetch);
    expect(status.state).toBe('not_configured');
    expect(status.id).toBe('trakyo');
    expect(status.kind).toBe('crm');
    expect(status.detail).not.toMatch(/no (public )?API|until Trakyo/i); // the stale claim is gone (F6)
    expect(called).toBe(false);
  });

  test('connected once the key reads live metrics from Trakyo API v1', async () => {
    process.env[TK] = 'tky_test';
    let seen = '';
    let auth = '';
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = String(url);
      auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response(JSON.stringify({ totals: { clicks: 12, visits: 9, form_submissions: 3, bookings: 2, revenue: '4500.50' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const status = await trakyoStatus(fetchFn);
    expect(seen).toBe('https://api.trakyo.io/v1/metrics');
    expect(auth).toBe('Bearer tky_test');
    expect(status.state).toBe('connected');
    expect(status.meta?.revenueUsd).toBe(4500.5);
  });

  test('a key the API rejects is an error, never connected', async () => {
    process.env[TK] = 'tky_bad';
    const status = await trakyoStatus((async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
    expect(status.state).toBe('error');
    expect(status.detail).toMatch(/rejected the API key/);
  });
});
