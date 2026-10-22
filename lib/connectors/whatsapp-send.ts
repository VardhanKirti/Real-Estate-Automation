import { resolveCred } from '@/lib/creds';
import { BRAND } from '@/lib/brand';

/**
 * Sending on WhatsApp, via Meta's WhatsApp Business Cloud API.
 *
 * This is deliberately a separate module from the read connector. Reading
 * comes from the local desktop database, which is read-only — writing a row
 * there transmits nothing, because the encryption session lives in a separate
 * store the app owns. Sending therefore needs its own transport and its own
 * credentials, and being connected for reading says nothing about whether you
 * can send.
 *
 * Cloud API limits worth knowing, because they decide what the UI may offer:
 *   - it sends from a business number, not the personal account being read
 *   - the recipient must be an E.164 phone number, so chats whose id is a LID
 *     (@lid) or a group (@g.us) cannot be addressed at all
 *   - free-form replies are only allowed within 24 hours of their last
 *     message; outside that window only approved templates go through
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export type SendCreds = { phoneNumberId: string; token: string };

/** Credentials, or null when the business line has not been set up. */
export function sendCreds(): SendCreds | null {
  const phoneNumberId = resolveCred('WHATSAPP_PHONE_NUMBER_ID', []);
  const token = resolveCred('WHATSAPP_ACCESS_TOKEN', []);
  return phoneNumberId && token ? { phoneNumberId, token } : null;
}

export type SendReadiness =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'not_addressable'; detail: string };

/**
 * The E.164 number for a chat, when one exists. Only "<number>@s.whatsapp.net"
 * carries a real phone number: "@lid" is an opaque linked id and "@g.us" is a
 * group, and the Cloud API can address neither.
 */
export function sendableNumber(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [head, domain] = String(jid).split('@');
  if (domain !== 's.whatsapp.net') return null;
  return /^[0-9]{7,15}$/.test(head) ? head : null;
}

/** Whether this specific chat can be replied to right now, and why not. */
export function canSend(jid: string | null | undefined): SendReadiness {
  if (!sendCreds()) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: `Connect a WhatsApp Business number to send from ${BRAND.name}.`,
    };
  }
  if (!sendableNumber(jid)) {
    return {
      ok: false,
      reason: 'not_addressable',
      detail: 'The Cloud API can only reply to a phone number, and this chat has none.',
    };
  }
  return { ok: true };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Send one text message. Never throws — a failure comes back as honest state. */
export async function sendWhatsAppMessage(jid: string, text: string): Promise<SendResult> {
  const creds = sendCreds();
  if (!creds) return { ok: false, error: 'WhatsApp Business is not configured' };
  const to = sendableNumber(jid);
  if (!to) return { ok: false, error: 'this chat has no phone number the Cloud API can address' };

  try {
    const res = await fetch(`${GRAPH}/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      // 131047 is Meta's "outside the 24-hour window" code — say so plainly.
      const code = body.error?.code;
      if (code === 131047) {
        return { ok: false, error: 'outside the 24-hour window — only an approved template can be sent now' };
      }
      return { ok: false, error: body.error?.message ?? `Cloud API returned ${res.status}` };
    }
    const id = body.messages?.[0]?.id;
    return id ? { ok: true, id } : { ok: false, error: 'Cloud API accepted the call but returned no message id' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}
