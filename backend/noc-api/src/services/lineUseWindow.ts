/**
 * Calendar-day WAN line use.
 *
 * Totals are the sum of hourly counter increases inside each local midnight-to-midnight
 * day. A single increase()[7d] / increase()[30d] extrapolates across the whole range
 * and will not match a daily breakdown when samples are missing or the counter resets.
 */

export type LineUseDay = {
  /** YYYY-MM-DD in the NOC timezone. */
  date: string;
  /** Unix seconds of local midnight at the start of this day. */
  start: number;
  /** Octets received on the WAN interface. Null when the day has no samples. */
  inBytes: number | null;
  /** Octets sent on the WAN interface. Null when the day has no samples. */
  outBytes: number | null;
};

export type DaySlot = {
  date: string;
  start: number;
  /** Unix seconds of the next local midnight. */
  next: number;
};

export type VolumeSample = { ts: number; value: number };

function tzParts(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "NaN");
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second")
  };
}

/** Offset such that UTC + offset = wall clock in `timeZone`. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const p = tzParts(timeZone, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Unix seconds of local midnight on `now`'s calendar day, shifted by `dayOffset` days. */
export function zonedDayStartUnix(timeZone: string, now: Date, dayOffset: number): number {
  const offsetNow = tzOffsetMs(timeZone, now);
  const local = new Date(now.getTime() + offsetNow);
  const localMidnightUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + dayOffset,
    0,
    0,
    0
  );
  let guess = localMidnightUtc - offsetNow;
  const offsetAtGuess = tzOffsetMs(timeZone, new Date(guess));
  guess = localMidnightUtc - offsetAtGuess;
  return Math.floor(guess / 1000);
}

export function ymdInZone(timeZone: string, unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(unixSec * 1000));
}

/** `count` local calendar days ending today, oldest first. */
export function calendarDaySlots(timeZone: string, now: Date, count: number): DaySlot[] {
  const slots: DaySlot[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = zonedDayStartUnix(timeZone, now, -i);
    const next = zonedDayStartUnix(timeZone, now, -i + 1);
    slots.push({ date: ymdInZone(timeZone, start), start, next });
  }
  return slots;
}

/**
 * Place hourly increase samples into calendar days.
 * A sample at time T is the increase over (T-step, T], so the point that lands
 * exactly on local midnight belongs to the day that just ended.
 * Samples at or before a day's start, and samples after `nowSec`, are ignored.
 */
export function bucketVolumeDays(
  slots: DaySlot[],
  inbound: VolumeSample[],
  outbound: VolumeSample[],
  nowSec: number
): LineUseDay[] {
  const acc = slots.map((slot) => ({
    ...slot,
    inRaw: 0,
    outRaw: 0,
    inSeen: false,
    outSeen: false
  }));

  const place = (ts: number, value: number, dir: "in" | "out") => {
    if (!Number.isFinite(ts) || !Number.isFinite(value) || value < 0) return;
    if (ts > nowSec + 1) return;
    for (const day of acc) {
      if (ts > day.start && ts <= day.next) {
        if (dir === "in") {
          day.inRaw += value;
          day.inSeen = true;
        } else {
          day.outRaw += value;
          day.outSeen = true;
        }
        return;
      }
    }
  };

  for (const sample of inbound) place(sample.ts, sample.value, "in");
  for (const sample of outbound) place(sample.ts, sample.value, "out");

  return acc.map((day) => ({
    date: day.date,
    start: day.start,
    inBytes: day.inSeen ? Math.round(day.inRaw) : null,
    outBytes: day.outSeen ? Math.round(day.outRaw) : null
  }));
}

/** Sum of daily octets. Days with no samples contribute nothing and do not invent zeroes. */
export function sumLineUseDays(days: LineUseDay[]): { inBytes: number | null; outBytes: number | null } {
  let inBytes = 0;
  let outBytes = 0;
  let inSeen = false;
  let outSeen = false;
  for (const day of days) {
    if (day.inBytes != null) {
      inBytes += day.inBytes;
      inSeen = true;
    }
    if (day.outBytes != null) {
      outBytes += day.outBytes;
      outSeen = true;
    }
  }
  return {
    inBytes: inSeen ? inBytes : null,
    outBytes: outSeen ? outBytes : null
  };
}
