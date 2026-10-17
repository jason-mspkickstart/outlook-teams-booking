import { MIN, HOUR } from './util';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** How far ahead of UTC the zone is at that moment, in ms. */
function offsetMs(utcMs: number, tz: string): number {
  const p = parts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a local date (YYYY-MM-DD) and time (HH:MM) in a zone to a UTC timestamp. */
export function localToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMs(guess, tz);
  let utc = guess - first;
  const second = offsetMs(utc, tz);
  if (second !== first) utc = guess - second;
  return utc;
}

/** The local calendar date (YYYY-MM-DD) for a UTC timestamp in a zone. */
export function localDate(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday, 7 = Sunday. */
export function isoDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export interface SlotRules {
  duration_mins: number;
  buffer_before_mins: number;
  buffer_after_mins: number;
  min_notice_hours: number;
  slot_step_mins: number;
  daily_limit: number | null;
}

export interface SlotInput {
  from: string;
  to: string;
  tz: string;
  now: number;
  rules: SlotRules;
  hours: { day: number; start_time: string; end_time: string }[];
  blocked: { start_date: string; end_date: string }[];
  busy: [number, number][];
  bookedPerDay: Record<string, number>;
}

export function computeSlots(o: SlotInput): number[] {
  const out = new Set<number>();
  const dur = o.rules.duration_mins * MIN;
  const before = o.rules.buffer_before_mins * MIN;
  const after = o.rules.buffer_after_mins * MIN;
  const step = Math.max(5, o.rules.slot_step_mins || o.rules.duration_mins) * MIN;
  const earliest = o.now + o.rules.min_notice_hours * HOUR;

  for (let d = o.from; d <= o.to; d = addDays(d, 1)) {
    if (o.blocked.some((b) => d >= b.start_date && d <= b.end_date)) continue;
    if (o.rules.daily_limit && (o.bookedPerDay[d] ?? 0) >= o.rules.daily_limit) continue;

    const day = isoDay(d);
    for (const h of o.hours) {
      if (h.day !== day) continue;
      const windowStart = localToUtc(d, h.start_time, o.tz);
      const windowEnd = localToUtc(d, h.end_time, o.tz);
      for (let s = windowStart; s + dur <= windowEnd; s += step) {
        if (s < earliest) continue;
        const blockStart = s - before;
        const blockEnd = s + dur + after;
        if (o.busy.some(([a, b]) => a < blockEnd && b > blockStart)) continue;
        out.add(s);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
