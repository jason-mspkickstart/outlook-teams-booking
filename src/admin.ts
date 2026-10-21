import { Env, HttpError, json, isTimeZone } from './util';
import * as graph from './graph';
import { ADMIN_HTML } from './admin-page';

// ---------- Cloudflare Access check ----------
// Access sits in front of /admin, but we also verify its signed token here so the
// admin can't be reached by any route that skips Access (e.g. the workers.dev URL).

let certCache: { at: number; team: string; keys: JsonWebKey[] } | null = null;

function teamUrl(env: Env): string {
  return 'https://' + String(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function accessEmail(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

    const team = teamUrl(env);
    if (!certCache || certCache.team !== team || Date.now() - certCache.at > 3_600_000) {
      const r = await fetch(`${team}/cdn-cgi/access/certs`);
      const j = (await r.json()) as { keys: JsonWebKey[] };
      certCache = { at: Date.now(), team, keys: j.keys };
    }
    const jwk = certCache.keys.find((k: any) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;

    const aud: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(String(env.ACCESS_AUD))) return null;
    if (payload.iss !== team) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload.email ?? 'unknown';
  } catch {
    return null;
  }
}

// ---------- tables the admin can edit ----------

type Col = 'text' | 'textnull' | 'int' | 'intnull' | 'bool';
interface TableDef {
  pk: string;
  pkType: 'text' | 'int';
  order: string;
  cols: Record<string, Col>;
}

const TABLES: Record<string, TableDef> = {
  sites: {
    pk: 'key', pkType: 'text', order: 'name',
    cols: { key: 'text', name: 'text', host_name: 'textnull', allowed_origins: 'text', sender_email: 'textnull', sender_name: 'textnull', manage_url: 'textnull', logo_url: 'textnull', active: 'bool' },
  },
  schedules: {
    pk: 'key', pkType: 'text', order: 'name',
    cols: { key: 'text', name: 'text', timezone: 'text' },
  },
  blocked_dates: {
    pk: 'id', pkType: 'int', order: 'start_date',
    cols: { schedule_key: 'textnull', start_date: 'text', end_date: 'text', note: 'textnull' },
  },
  meeting_types: {
    pk: 'id', pkType: 'int', order: 'site_key, sort_order, id',
    cols: {
      site_key: 'text', slug: 'text', name: 'text', description: 'textnull', duration_mins: 'int',
      buffer_before_mins: 'int', buffer_after_mins: 'int', min_notice_hours: 'int', max_days_ahead: 'int',
      slot_step_mins: 'int', daily_limit: 'intnull', schedule_key: 'text', invite_subject: 'textnull', email_message: 'textnull',
      sort_order: 'int', active: 'bool',
    },
  },
  questions: {
    pk: 'id', pkType: 'int', order: 'meeting_type_id, sort_order, id',
    cols: { meeting_type_id: 'int', field_key: 'text', label: 'text', type: 'text', options: 'textnull', required: 'bool', sort_order: 'int' },
  },
};

function coerce(v: unknown, t: Col, name: string): string | number | null {
  switch (t) {
    case 'text': {
      const s = String(v ?? '').trim();
      if (!s) throw new HttpError(400, `${name.replace(/_/g, ' ')} is required`);
      return s;
    }
    case 'textnull': {
      const s = String(v ?? '').trim();
      return s || null;
    }
    case 'int': {
      const n = Number(v);
      if (v === '' || v == null || !Number.isFinite(n)) throw new HttpError(400, `${name.replace(/_/g, ' ')} must be a number`);
      return Math.round(n);
    }
    case 'intnull': {
      if (v === '' || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `${name.replace(/_/g, ' ')} must be a number`);
      return Math.round(n);
    }
    case 'bool':
      return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function extraChecks(table: string, row: Record<string, any>) {
  if (table === 'sites' && !SLUG.test(row.key)) throw new HttpError(400, 'Site key must be lowercase letters, numbers and hyphens');
  if (table === 'sites' && row.logo_url && !/^https:\/\//.test(row.logo_url)) throw new HttpError(400, 'Logo URL must start with https://');
  if (table === 'schedules') {
    if (!SLUG.test(row.key)) throw new HttpError(400, 'Schedule key must be lowercase letters, numbers and hyphens');
    if (!isTimeZone(row.timezone)) throw new HttpError(400, `'${row.timezone}' isn't a valid time zone, e.g. Europe/London`);
  }
  if (table === 'meeting_types') {
    if (!SLUG.test(row.slug)) throw new HttpError(400, 'Slug must be lowercase letters, numbers and hyphens');
    if (row.duration_mins < 5) throw new HttpError(400, 'Duration must be at least 5 minutes');
  }
  if (table === 'blocked_dates') {
    if (!DATE.test(row.start_date) || !DATE.test(row.end_date)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
    if (row.end_date < row.start_date) throw new HttpError(400, 'End date is before start date');
  }
  if (table === 'questions') {
    if (!['text', 'textarea', 'select'].includes(row.type)) throw new HttpError(400, 'Type must be text, textarea or select');
    if (!/^[a-z0-9_]+$/.test(row.field_key)) throw new HttpError(400, 'Field key must be lowercase letters, numbers and underscores');
  }
}

async function upsert(env: Env, table: string, body: Record<string, any>) {
  const def = TABLES[table];
  const row: Record<string, any> = {};
  for (const [c, t] of Object.entries(def.cols)) row[c] = coerce(body[c], t, c);
  extraChecks(table, row);
  const cols = Object.keys(def.cols);

  if (def.pkType === 'text') {
    const sets = cols.filter((c) => c !== def.pk).map((c) => `${c} = excluded.${c}`).join(', ');
    await env.DB.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${def.pk}) DO UPDATE SET ${sets}`,
    ).bind(...cols.map((c) => row[c])).run();
    return;
  }

  const id = body[def.pk];
  if (id) {
    await env.DB.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${def.pk} = ?`)
      .bind(...cols.map((c) => row[c]), Number(id)).run();
  } else {
    await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...cols.map((c) => row[c])).run();
  }
}

async function remove(env: Env, table: string, pk: string) {
  const def = TABLES[table];
  const key = def.pkType === 'int' ? Number(pk) : pk;
  const stmts = [env.DB.prepare(`DELETE FROM ${table} WHERE ${def.pk} = ?`).bind(key)];
  if (table === 'meeting_types') stmts.push(env.DB.prepare('DELETE FROM questions WHERE meeting_type_id = ?').bind(key));
  if (table === 'schedules') stmts.push(env.DB.prepare('DELETE FROM schedule_hours WHERE schedule_key = ?').bind(key));
  await env.DB.batch(stmts);
}

async function everything(env: Env) {
  const q = (sql: string) => env.DB.prepare(sql).all().then((r) => r.results);
  const [sites, schedules, hours, blocked, types, questions, bookings] = await Promise.all([
    q(`SELECT * FROM sites ORDER BY ${TABLES.sites.order}`),
    q(`SELECT * FROM schedules ORDER BY ${TABLES.schedules.order}`),
    q('SELECT schedule_key, day, start_time, end_time FROM schedule_hours ORDER BY schedule_key, day, start_time'),
    q(`SELECT * FROM blocked_dates ORDER BY ${TABLES.blocked_dates.order}`),
    q(`SELECT * FROM meeting_types ORDER BY ${TABLES.meeting_types.order}`),
    q(`SELECT * FROM questions ORDER BY ${TABLES.questions.order}`),
    env.DB.prepare(
      `SELECT b.id, b.site_key, b.start_utc, b.end_utc, b.name, b.email, b.answers, b.status, b.join_url, m.name AS meeting
       FROM bookings b LEFT JOIN meeting_types m ON m.id = b.meeting_type_id
       WHERE b.start_utc > ? AND b.status != 'pending' ORDER BY b.start_utc LIMIT 300`,
    ).bind(Date.now() - 30 * 86_400_000).all().then((r) => r.results),
  ]);
  return { sites, schedules, hours, blocked_dates: blocked, meeting_types: types, questions, bookings };
}

async function saveHours(env: Env, scheduleKey: string, body: any) {
  const rows = Array.isArray(body?.hours) ? body.hours : [];
  for (const r of rows) {
    if (!(r.day >= 1 && r.day <= 7)) throw new HttpError(400, 'Invalid day');
    if (!TIME.test(r.start_time) || !TIME.test(r.end_time)) throw new HttpError(400, 'Times must be HH:MM');
    if (r.end_time <= r.start_time) throw new HttpError(400, 'An end time is before its start time');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM schedule_hours WHERE schedule_key = ?').bind(scheduleKey),
    ...rows.map((r: any) =>
      env.DB.prepare('INSERT INTO schedule_hours (schedule_key, day, start_time, end_time) VALUES (?, ?, ?, ?)')
        .bind(scheduleKey, Number(r.day), r.start_time, r.end_time),
    ),
  ]);
}

async function cancelBooking(env: Env, id: string) {
  const b = await env.DB.prepare('SELECT id, event_id, status FROM bookings WHERE id = ?').bind(id)
    .first<{ id: string; event_id: string | null; status: string }>();
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'confirmed') return;
  if (b.event_id) await graph.cancelEvent(env, b.event_id, 'Sorry, this meeting has been cancelled.');
  await env.DB.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = 'Cancelled by organiser', cancelled_at = ?, updated_at = ? WHERE id = ?")
    .bind(Date.now(), Date.now(), id).run();
}

// ---------- entry ----------

export async function handleAdmin(req: Request, env: Env, onSitesChanged: () => void): Promise<Response> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return new Response(
      'The admin page is switched off. Put /admin behind Cloudflare Access, then add ACCESS_TEAM_DOMAIN and ACCESS_AUD to the Worker settings. See the README.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
  const email = await accessEmail(req, env);
  if (!email) return new Response('Not signed in through Cloudflare Access.', { status: 403 });

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (req.method === 'GET' && path === '/admin') {
    return new Response(ADMIN_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' },
    });
  }

  if (!path.startsWith('/admin/api/')) throw new HttpError(404, 'Not found');
  // Blocks cross-site form posts riding on the Access cookie.
  if (req.method !== 'GET' && req.headers.get('X-Admin') !== '1') throw new HttpError(403, 'Missing X-Admin header');

  const parts = path.slice('/admin/api/'.length).split('/').map(decodeURIComponent);
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : null;

  if (req.method === 'GET' && parts[0] === 'all') return json({ email, ...(await everything(env)) });

  if (req.method === 'PUT' && parts[0] === 'hours' && parts[1]) {
    await saveHours(env, parts[1], body);
    return json({ ok: true });
  }

  if (req.method === 'POST' && parts[0] === 'bookings' && parts[2] === 'cancel') {
    await cancelBooking(env, parts[1]);
    return json({ ok: true });
  }

  if (TABLES[parts[0]]) {
    if (req.method === 'POST' && parts.length === 1) {
      await upsert(env, parts[0], body ?? {});
      if (parts[0] === 'sites') onSitesChanged();
      return json({ ok: true });
    }
    if (req.method === 'DELETE' && parts[1]) {
      await remove(env, parts[0], parts[1]);
      if (parts[0] === 'sites') onSitesChanged();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}
