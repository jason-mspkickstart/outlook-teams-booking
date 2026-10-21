import {
  Env, REQUIRED, DAY, MIN, HttpError, json, escapeHtml, isEmail, isTimeZone,
  originAllowed, signToken, verifyToken, formatWhen,
} from './util';
import { computeSlots, localDate, localToUtc, addDays } from './slots';
import * as graph from './graph';
import { SCHEMA, MIGRATIONS } from './schema';
import { handleAdmin } from './admin';

interface Site {
  key: string;
  name: string;
  host_name: string;
  allowed_origins: string;
  sender_email: string | null;
  sender_name: string | null;
  manage_url: string | null;
  logo_url: string | null;
  active: number;
}

interface MeetingType {
  id: number;
  site_key: string;
  slug: string;
  name: string;
  description: string | null;
  duration_mins: number;
  buffer_before_mins: number;
  buffer_after_mins: number;
  min_notice_hours: number;
  max_days_ahead: number;
  slot_step_mins: number;
  daily_limit: number | null;
  schedule_key: string;
  invite_subject: string | null;
  email_message: string | null;
}

interface Schedule {
  key: string;
  timezone: string;
}

interface Booking {
  id: string;
  site_key: string;
  meeting_type_id: number;
  start_utc: number;
  end_utc: number;
  visitor_tz: string | null;
  name: string;
  email: string;
  event_id: string | null;
  join_url: string | null;
  status: string;
}

interface Answer {
  key: string;
  label: string;
  value: string;
}

// ---------- setup ----------

let schemaReady = false;
async function ensureSchema(env: Env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  for (const m of MIGRATIONS) {
    try {
      await env.DB.prepare(m).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  }
  schemaReady = true;
}

let originCache: { at: number; lists: string[] } | null = null;
async function anySiteAllows(env: Env, origin: string | null): Promise<boolean> {
  if (!origin) return false;
  if (!originCache || Date.now() - originCache.at > 60_000) {
    const r = await env.DB.prepare('SELECT allowed_origins FROM sites WHERE active = 1').all<{ allowed_origins: string }>();
    originCache = { at: Date.now(), lists: r.results.map((x) => x.allowed_origins) };
  }
  return originCache.lists.some((l) => originAllowed(l, origin));
}

function missingSecrets(env: Env): string[] {
  return REQUIRED.filter((k) => !(env as any)[k]);
}

// ---------- loaders ----------

async function loadSite(env: Env, key: unknown, origin: string | null): Promise<Site> {
  if (typeof key !== 'string' || !key) throw new HttpError(400, 'Missing site');
  const site = await env.DB.prepare('SELECT * FROM sites WHERE key = ? AND active = 1').bind(key).first<Site>();
  if (!site) throw new HttpError(404, `Unknown site '${key}'`);
  // Requests with no Origin header (server to server) are allowed. Browsers always send one.
  if (origin && !originAllowed(site.allowed_origins, origin)) {
    throw new HttpError(403, `Origin ${origin} is not allowed for site '${key}'`);
  }
  return site;
}

async function loadType(env: Env, siteKey: string, slug: unknown): Promise<MeetingType> {
  if (typeof slug !== 'string' || !slug) throw new HttpError(400, 'Missing meeting type');
  const t = await env.DB.prepare('SELECT * FROM meeting_types WHERE site_key = ? AND slug = ? AND active = 1')
    .bind(siteKey, slug)
    .first<MeetingType>();
  if (!t) throw new HttpError(404, `Unknown meeting type '${slug}'`);
  return t;
}

async function loadSchedule(env: Env, key: string): Promise<Schedule> {
  const s = await env.DB.prepare('SELECT key, timezone FROM schedules WHERE key = ?').bind(key).first<Schedule>();
  if (!s) throw new HttpError(500, `Schedule '${key}' does not exist. Add it to the schedules table.`);
  if (!isTimeZone(s.timezone)) throw new HttpError(500, `Schedule '${key}' has an invalid timezone '${s.timezone}'`);
  return s;
}

async function loadBookingByToken(env: Env, token: unknown): Promise<Booking> {
  const id = await verifyToken(env.SIGNING_KEY, token);
  if (!id) throw new HttpError(404, 'Booking not found');
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<Booking>();
  if (!b) throw new HttpError(404, 'Booking not found');
  return b;
}

async function loadQuestions(env: Env, typeId: number) {
  const r = await env.DB.prepare(
    'SELECT field_key, label, type, options, required FROM questions WHERE meeting_type_id = ? ORDER BY sort_order, id',
  ).bind(typeId).all<{ field_key: string; label: string; type: string; options: string | null; required: number }>();
  return r.results.map((q) => ({
    key: q.field_key,
    label: q.label,
    type: q.type,
    options: q.options ? q.options.split('|').map((o) => o.trim()).filter(Boolean) : [],
    required: !!q.required,
  }));
}

// ---------- availability ----------

async function availableSlots(
  env: Env,
  type: MeetingType,
  sched: Schedule,
  fromDate: string,
  toDate: string,
  ignore?: Booking,
): Promise<number[]> {
  const tz = sched.timezone;
  const now = Date.now();
  const today = localDate(now, tz);
  const lastDay = addDays(today, type.max_days_ahead);
  const from = fromDate < today ? today : fromDate;
  let to = toDate > lastDay ? lastDay : toDate;
  if (to > addDays(from, 42)) to = addDays(from, 42);
  if (from > to) return [];

  const rangeStart = localToUtc(from, '00:00', tz) - DAY;
  const rangeEnd = localToUtc(addDays(to, 1), '00:00', tz) + DAY;

  const [hours, blocked, dbBusy, perDay, calendarBusy] = await Promise.all([
    env.DB.prepare('SELECT day, start_time, end_time FROM schedule_hours WHERE schedule_key = ?')
      .bind(sched.key).all<{ day: number; start_time: string; end_time: string }>(),
    env.DB.prepare(
      'SELECT start_date, end_date FROM blocked_dates WHERE (schedule_key IS NULL OR schedule_key = ?) AND end_date >= ? AND start_date <= ?',
    ).bind(sched.key, from, to).all<{ start_date: string; end_date: string }>(),
    env.DB.prepare(
      "SELECT id, start_utc, end_utc FROM bookings WHERE status IN ('pending', 'confirmed') AND end_utc > ? AND start_utc < ?",
    ).bind(rangeStart, rangeEnd).all<{ id: string; start_utc: number; end_utc: number }>(),
    type.daily_limit
      ? env.DB.prepare(
          "SELECT local_date, COUNT(*) AS n FROM bookings WHERE meeting_type_id = ? AND status = 'confirmed' AND local_date BETWEEN ? AND ? AND id != ? GROUP BY local_date",
        ).bind(type.id, from, to, ignore?.id ?? '').all<{ local_date: string; n: number }>()
      : Promise.resolve({ results: [] as { local_date: string; n: number }[] }),
    graph.getBusy(env, rangeStart, rangeEnd),
  ]);

  let busy: [number, number][] = [
    ...calendarBusy,
    ...dbBusy.results.filter((b) => b.id !== ignore?.id).map((b) => [b.start_utc, b.end_utc] as [number, number]),
  ];
  // When rescheduling, the booking's own calendar entry should not block its new time.
  if (ignore) busy = busy.filter(([s, e]) => !(s === ignore.start_utc && e === ignore.end_utc));

  return computeSlots({
    from,
    to,
    tz,
    now,
    rules: type,
    hours: hours.results,
    blocked: blocked.results,
    busy,
    bookedPerDay: Object.fromEntries(perDay.results.map((r) => [r.local_date, r.n])),
  });
}

// ---------- helpers ----------

async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    if (b && typeof b === 'object') return b as Record<string, any>;
  } catch {}
  throw new HttpError(400, 'Request body must be JSON');
}

async function verifyTurnstile(env: Env, token: unknown, req: Request) {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'Missing turnstileToken');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: req.headers.get('CF-Connecting-IP') ?? '',
    }),
  });
  const j = (await res.json()) as { success: boolean };
  if (!j.success) throw new HttpError(403, 'Turnstile check failed, please try again');
}

function parseStart(v: unknown): number {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, 'start must be an ISO date time, e.g. 2026-11-03T14:00:00Z');
  return ms;
}

function validateAnswers(questions: Awaited<ReturnType<typeof loadQuestions>>, raw: unknown): Answer[] {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return questions.map((q) => {
    const value = String(input[q.key] ?? '').trim().slice(0, 2000);
    if (q.required && !value) throw new HttpError(400, `${q.label} is required`);
    if (q.type === 'select' && value && !q.options.includes(value)) throw new HttpError(400, `${q.label} has an invalid option`);
    return { key: q.key, label: q.label, value };
  });
}

function manageLink(site: Site, token: string): string | null {
  if (!site.manage_url) return null;
  const u = new URL(site.manage_url);
  u.searchParams.set('token', token);
  return u.toString();
}

interface VarCtx {
  name: string;
  email: string;
  start: number;
  tz: string;
}

/** Fills {meeting} {site} {host} {name} {email} {when} {duration} in a template. Plain text in, plain text out. */
function fillVars(tpl: string, type: MeetingType, site: Site, c: VarCtx): string {
  const vals: Record<string, string> = {
    meeting: type.name,
    site: site.name,
    host: site.host_name || site.name,
    name: c.name,
    email: c.email,
    when: formatWhen(c.start, c.tz),
    duration: `${type.duration_mins} minutes`,
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}

/** The meeting type's email message, filled in and turned into safe HTML paragraphs. */
function messageHtml(type: MeetingType, site: Site, c: VarCtx): string {
  if (!type.email_message?.trim()) return '';
  return fillVars(type.email_message.trim(), type, site, c)
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function inviteSubject(type: MeetingType, site: Site, c: VarCtx): string {
  return fillVars(type.invite_subject || '{meeting} with {name}', type, site, c);
}

function inviteHtml(site: Site, type: MeetingType, c: VarCtx, answers: Answer[], link: string | null): string {
  const rows = answers
    .filter((a) => a.value)
    .map((a) => `<p><strong>${escapeHtml(a.label)}</strong><br>${escapeHtml(a.value).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `
    ${messageHtml(type, site, c) || `<p>${escapeHtml(type.name)} with ${escapeHtml(site.host_name || site.name)}.</p>`}
    <p><strong>Booked by</strong><br>${escapeHtml(c.name)} (${escapeHtml(c.email)})</p>
    ${rows}
    ${link ? `<p>Need to change it? <a href="${escapeHtml(link)}">Reschedule or cancel</a></p>` : ''}
  `;
}

async function sendNotice(
  env: Env,
  site: Site,
  type: MeetingType,
  b: { name: string; email: string; start: number; tz: string; joinUrl: string | null; link: string | null },
  kind: 'booked' | 'moved' | 'cancelled',
) {
  if (!site.sender_email) return;
  const when = escapeHtml(formatWhen(b.start, b.tz));
  const host = escapeHtml(site.host_name || site.name);
  const subjects = {
    booked: `Confirmed: ${type.name} with ${site.host_name || site.name}`,
    moved: `Updated: ${type.name} with ${site.host_name || site.name}`,
    cancelled: `Cancelled: ${type.name} with ${site.host_name || site.name}`,
  };
  const intro = {
    booked: `Thanks ${escapeHtml(b.name)}, you're booked in for <strong>${escapeHtml(type.name)}</strong> with ${host}.`,
    moved: `Hi ${escapeHtml(b.name)}, your <strong>${escapeHtml(type.name)}</strong> with ${host} has moved.`,
    cancelled: `Hi ${escapeHtml(b.name)}, your <strong>${escapeHtml(type.name)}</strong> with ${host} has been cancelled.`,
  };
  const logo = site.logo_url && /^https:\/\//.test(site.logo_url)
    ? `<p><img src="${escapeHtml(site.logo_url)}" alt="${escapeHtml(site.name)}" style="max-height:48px;max-width:220px;height:auto"></p>`
    : '';
  const message = kind === 'cancelled' ? '' : messageHtml(type, site, { name: b.name, email: b.email, start: b.start, tz: b.tz });
  const html = `
    ${logo}
    <p>${intro[kind]}</p>
    ${kind === 'cancelled' ? '' : `<p><strong>When:</strong> ${when}</p>`}
    ${message}
    ${kind !== 'cancelled' && b.joinUrl ? `<p><a href="${escapeHtml(b.joinUrl)}">Join the Teams meeting</a></p>` : ''}
    ${kind !== 'cancelled' ? '<p>A calendar invite is on its way separately.</p>' : ''}
    ${kind !== 'cancelled' && b.link ? `<p>Need to change it? <a href="${escapeHtml(b.link)}">Reschedule or cancel</a></p>` : ''}
    <p>${escapeHtml(site.sender_name || site.name)}</p>
  `;
  try {
    await graph.sendMail(env, {
      fromEmail: site.sender_email,
      fromName: site.sender_name,
      to: b.email,
      toName: b.name,
      subject: subjects[kind],
      html,
    });
  } catch (e) {
    // The calendar invite has already gone, so a failed email should not fail the booking.
    console.error('Confirmation email failed', site.key, e);
  }
}

// ---------- routes ----------

async function getConfig(env: Env, url: URL, origin: string | null) {
  const site = await loadSite(env, url.searchParams.get('site'), origin);
  const types = await env.DB.prepare(
    'SELECT * FROM meeting_types WHERE site_key = ? AND active = 1 ORDER BY sort_order, id',
  ).bind(site.key).all<MeetingType>();
  const meetingTypes = await Promise.all(
    types.results.map(async (t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      durationMins: t.duration_mins,
      questions: await loadQuestions(env, t.id),
    })),
  );
  return json({
    site: { key: site.key, name: site.name, host: site.host_name || site.name },
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    meetingTypes,
  });
}

async function getAvailability(env: Env, url: URL, origin: string | null) {
  const site = await loadSite(env, url.searchParams.get('site'), origin);
  const type = await loadType(env, site.key, url.searchParams.get('type'));
  const sched = await loadSchedule(env, type.schedule_key);
  const today = localDate(Date.now(), sched.timezone);
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || addDays(from, 14);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HttpError(400, 'from and to must be dates like 2026-11-03');
  }
  const slots = await availableSlots(env, type, sched, from, to);
  return json({
    timezone: sched.timezone,
    durationMins: type.duration_mins,
    slots: slots.map((s) => new Date(s).toISOString()),
  });
}

async function postBook(env: Env, req: Request, ctx: ExecutionContext, origin: string | null) {
  const body = await readJson(req);
  const site = await loadSite(env, body.site, origin);
  const type = await loadType(env, site.key, body.type);
  await verifyTurnstile(env, body.turnstileToken, req);

  const name = String(body.name ?? '').trim().slice(0, 100);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Name is required');
  if (!isEmail(email)) throw new HttpError(400, 'A valid email is required');
  const answers = validateAnswers(await loadQuestions(env, type.id), body.answers);
  const visitorTz = isTimeZone(body.timezone) ? body.timezone : null;

  const sched = await loadSchedule(env, type.schedule_key);
  const start = parseStart(body.start);
  const end = start + type.duration_mins * MIN;
  const date = localDate(start, sched.timezone);
  const slots = await availableSlots(env, type, sched, date, date);
  if (!slots.includes(start)) throw new HttpError(409, 'Sorry, that time has just been taken. Please pick another.');

  const id = crypto.randomUUID();
  const token = await signToken(env.SIGNING_KEY, id);
  const link = manageLink(site, token);

  await env.DB.prepare(
    `INSERT INTO bookings (id, site_key, meeting_type_id, start_utc, end_utc, local_date, visitor_tz, name, email, answers, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).bind(id, site.key, type.id, start, end, date, visitorTz, name, email, JSON.stringify(answers), Date.now()).run();

  let event: { id: string; joinUrl: string | null };
  try {
    event = await graph.createEvent(env, {
      subject: inviteSubject(type, site, { name, email, start, tz: visitorTz ?? sched.timezone }),
      html: inviteHtml(site, type, { name, email, start, tz: visitorTz ?? sched.timezone }, answers, link),
      start,
      end,
      name,
      email,
      transactionId: id,
    });
  } catch (e) {
    await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
    throw e;
  }

  await env.DB.prepare("UPDATE bookings SET status = 'confirmed', event_id = ?, join_url = ?, updated_at = ? WHERE id = ?")
    .bind(event.id, event.joinUrl, Date.now(), id).run();

  ctx.waitUntil(
    sendNotice(env, site, type, { name, email, start, tz: visitorTz ?? sched.timezone, joinUrl: event.joinUrl, link }, 'booked'),
  );

  return json({
    id,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    joinUrl: event.joinUrl,
    manageToken: token,
    manageUrl: link,
  });
}

async function getBooking(env: Env, url: URL, origin: string | null) {
  const b = await loadBookingByToken(env, url.searchParams.get('token'));
  const site = await loadSite(env, b.site_key, origin);
  const type = await env.DB.prepare('SELECT slug, name, duration_mins FROM meeting_types WHERE id = ?')
    .bind(b.meeting_type_id).first<{ slug: string; name: string; duration_mins: number }>();
  return json({
    site: site.key,
    type: type?.slug ?? null,
    typeName: type?.name ?? null,
    name: b.name,
    start: new Date(b.start_utc).toISOString(),
    end: new Date(b.end_utc).toISOString(),
    status: b.status,
    joinUrl: b.status === 'confirmed' ? b.join_url : null,
  });
}

async function postReschedule(env: Env, req: Request, ctx: ExecutionContext, origin: string | null) {
  const body = await readJson(req);
  const b = await loadBookingByToken(env, body.token);
  const site = await loadSite(env, b.site_key, origin);
  if (b.status !== 'confirmed' || !b.event_id) throw new HttpError(409, 'This booking can no longer be changed');
  await verifyTurnstile(env, body.turnstileToken, req);

  const type = await env.DB.prepare('SELECT * FROM meeting_types WHERE id = ?').bind(b.meeting_type_id).first<MeetingType>();
  if (!type) throw new HttpError(404, 'Meeting type no longer exists');
  const sched = await loadSchedule(env, type.schedule_key);
  const start = parseStart(body.start);
  const end = start + type.duration_mins * MIN;
  const date = localDate(start, sched.timezone);
  const slots = await availableSlots(env, type, sched, date, date, b);
  if (!slots.includes(start)) throw new HttpError(409, 'Sorry, that time is not available. Please pick another.');

  await graph.moveEvent(env, b.event_id, start, end);
  await env.DB.prepare('UPDATE bookings SET start_utc = ?, end_utc = ?, local_date = ?, updated_at = ? WHERE id = ?')
    .bind(start, end, date, Date.now(), b.id).run();

  const link = manageLink(site, String(body.token));
  ctx.waitUntil(
    sendNotice(env, site, type, { name: b.name, email: b.email, start, tz: b.visitor_tz ?? sched.timezone, joinUrl: b.join_url, link }, 'moved'),
  );
  return json({ ok: true, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
}

async function postCancel(env: Env, req: Request, ctx: ExecutionContext, origin: string | null) {
  const body = await readJson(req);
  const b = await loadBookingByToken(env, body.token);
  const site = await loadSite(env, b.site_key, origin);
  if (b.status === 'cancelled') return json({ ok: true });
  if (b.status !== 'confirmed' || !b.event_id) throw new HttpError(409, 'This booking cannot be cancelled');

  const reason = String(body.reason ?? '').trim().slice(0, 500);
  await graph.cancelEvent(env, b.event_id, reason || 'Cancelled by the guest');
  await env.DB.prepare("UPDATE bookings SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, updated_at = ? WHERE id = ?")
    .bind(reason || null, Date.now(), Date.now(), b.id).run();

  const type = await env.DB.prepare('SELECT * FROM meeting_types WHERE id = ?').bind(b.meeting_type_id).first<MeetingType>();
  if (type) {
    ctx.waitUntil(
      sendNotice(env, site, type, { name: b.name, email: b.email, start: b.start_utc, tz: b.visitor_tz ?? 'UTC', joinUrl: null, link: null }, 'cancelled'),
    );
  }
  return json({ ok: true });
}

async function health(env: Env) {
  const missing = missingSecrets(env);
  let sites = 0;
  let dbOk = true;
  try {
    await ensureSchema(env);
    sites = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sites').first<{ n: number }>())?.n ?? 0;
  } catch {
    dbOk = false;
  }
  return json(
    {
      ok: missing.length === 0 && dbOk,
      missingSecrets: missing,
      database: dbOk ? 'ok' : 'not reachable, check the DB binding',
      sites,
    },
    missing.length === 0 && dbOk ? 200 : 500,
  );
}

// ---------- entry ----------

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');

    if (url.pathname === '/' || url.pathname === '/health') return health(env);

    let res: Response;
    try {
      // Fail loudly rather than half working when something is not set.
      const missing = missingSecrets(env);
      if (missing.length) {
        const visible = Object.keys(env).sort().join(', ') || 'none';
        throw new HttpError(500, `Missing required settings: ${missing.join(', ')}. Bindings this Worker can see: ${visible}`);
      }
      await ensureSchema(env);

      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        // Same origin only, so no CORS headers added.
        return await handleAdmin(req, env, () => { originCache = null; });
      }

      if (req.method === 'OPTIONS') {
        if (!(await anySiteAllows(env, origin))) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin!,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          },
        });
      }

      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/config': res = await getConfig(env, url, origin); break;
        case 'GET /api/availability': res = await getAvailability(env, url, origin); break;
        case 'POST /api/book': res = await postBook(env, req, ctx, origin); break;
        case 'GET /api/booking': res = await getBooking(env, url, origin); break;
        case 'POST /api/reschedule': res = await postReschedule(env, req, ctx, origin); break;
        case 'POST /api/cancel': res = await postCancel(env, req, ctx, origin); break;
        default: throw new HttpError(404, 'Not found');
      }
    } catch (e) {
      if (e instanceof HttpError) {
        res = json({ error: e.message }, e.status);
      } else {
        console.error('Unhandled error', e);
        res = json({ error: 'Something went wrong' }, 500);
      }
    }

    if (origin && (await anySiteAllows(env, origin).catch(() => false))) {
      res = new Response(res.body, res);
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Vary', 'Origin');
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
