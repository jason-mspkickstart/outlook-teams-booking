export interface Env {
  DB: D1Database;
  MS_TENANT_ID: string;
  MS_CLIENT_ID: string;
  MS_CLIENT_SECRET: string;
  MAILBOX: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
  SIGNING_KEY: string;
}

export const REQUIRED = [
  'MS_TENANT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MAILBOX',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET',
  'SIGNING_KEY',
] as const;

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Matches an origin against a comma separated list. Supports https://*.example.com wildcards. */
export function originAllowed(list: string, origin: string): boolean {
  return list
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .some((entry) => {
      if (entry === origin) return true;
      const m = entry.match(/^(https?:\/\/)\*\.(.+)$/);
      return !!m && origin.startsWith(m[1]) && origin.endsWith('.' + m[2]);
    });
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return b64url(new Uint8Array(sig)).slice(0, 32);
}

export async function signToken(key: string, id: string): Promise<string> {
  return `${id}.${await hmac(key, 'booking:' + id)}`;
}

export async function verifyToken(key: string, token: unknown): Promise<string | null> {
  const [id, sig] = String(token ?? '').split('.');
  if (!id || !sig) return null;
  const expected = await hmac(key, 'booking:' + id);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? id : null;
}

export function formatWhen(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
}
