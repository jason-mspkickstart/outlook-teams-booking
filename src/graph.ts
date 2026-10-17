import { Env, HttpError } from './util';

const GRAPH = 'https://graph.microsoft.com/v1.0';
let cachedToken: { token: string; exp: number } | null = null;

async function token(env: Env): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    console.error('Graph token request failed', res.status, await res.text());
    throw new HttpError(502, 'Could not sign in to Microsoft 365. Check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET.');
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function call<T = any>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : GRAPH + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token(env)}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="UTC"',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Graph call failed', init.method ?? 'GET', path, res.status, body);
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, 'Microsoft 365 refused access. Check the app permissions and the Exchange scoping for MAILBOX.');
    }
    throw new HttpError(502, 'Microsoft 365 request failed. See the Worker logs for details.');
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const mailbox = (env: Env) => encodeURIComponent(env.MAILBOX);
const graphTime = (ms: number) => ({ dateTime: new Date(ms).toISOString().slice(0, 19), timeZone: 'UTC' });
const parseGraphTime = (dt: string) => Date.parse(dt.slice(0, 19) + 'Z');

/** Busy periods from the calendar, as [start, end] UTC ms pairs. Anything not shown as free counts. */
export async function getBusy(env: Env, startMs: number, endMs: number): Promise<[number, number][]> {
  const busy: [number, number][] = [];
  const qs = new URLSearchParams({
    startDateTime: new Date(startMs).toISOString(),
    endDateTime: new Date(endMs).toISOString(),
    $select: 'start,end,showAs,isCancelled',
    $top: '250',
  });
  let next: string | undefined = `/users/${mailbox(env)}/calendarView?${qs}`;
  let pages = 0;
  while (next && pages++ < 10) {
    const page: any = await call(env, next);
    for (const e of page.value ?? []) {
      if (e.isCancelled || e.showAs === 'free') continue;
      busy.push([parseGraphTime(e.start.dateTime), parseGraphTime(e.end.dateTime)]);
    }
    next = page['@odata.nextLink'];
  }
  return busy;
}

export async function createEvent(
  env: Env,
  e: { subject: string; html: string; start: number; end: number; name: string; email: string; transactionId: string },
): Promise<{ id: string; joinUrl: string | null }> {
  const ev: any = await call(env, `/users/${mailbox(env)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      subject: e.subject,
      body: { contentType: 'HTML', content: e.html },
      start: graphTime(e.start),
      end: graphTime(e.end),
      attendees: [{ emailAddress: { address: e.email, name: e.name }, type: 'required' }],
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      allowNewTimeProposals: false,
      responseRequested: true,
      showAs: 'busy',
      transactionId: e.transactionId,
    }),
  });
  let joinUrl: string | null = ev.onlineMeeting?.joinUrl ?? null;
  if (!joinUrl) {
    // The Teams link is sometimes added a moment after the event is created.
    await new Promise((r) => setTimeout(r, 1500));
    const again: any = await call(env, `/users/${mailbox(env)}/events/${ev.id}?$select=onlineMeeting`);
    joinUrl = again.onlineMeeting?.joinUrl ?? null;
  }
  return { id: ev.id, joinUrl };
}

export async function moveEvent(env: Env, id: string, start: number, end: number): Promise<void> {
  await call(env, `/users/${mailbox(env)}/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ start: graphTime(start), end: graphTime(end) }),
  });
}

export async function cancelEvent(env: Env, id: string, comment: string): Promise<void> {
  await call(env, `/users/${mailbox(env)}/events/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export async function sendMail(
  env: Env,
  m: { fromEmail: string; fromName: string | null; to: string; toName: string; subject: string; html: string },
): Promise<void> {
  await call(env, `/users/${mailbox(env)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: m.html },
        toRecipients: [{ emailAddress: { address: m.to, name: m.toName } }],
        from: { emailAddress: { address: m.fromEmail, name: m.fromName ?? undefined } },
      },
      saveToSentItems: true,
    }),
  });
}
