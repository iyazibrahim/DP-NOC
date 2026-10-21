import {
  bucketVolumeDays,
  calendarDaySlots,
  sumLineUseDays,
  zonedDayStartUnix,
  ymdInZone
} from "./lineUseWindow";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function run() {
  const now = new Date("2026-10-21T01:58:00Z");
  const start = zonedDayStartUnix("Asia/Kuala_Lumpur", now, 0);
  assert(start === Date.parse("2026-10-20T16:00:00Z") / 1000, `today midnight ${start}`);
  assert(ymdInZone("Asia/Kuala_Lumpur", start) === "2026-10-21", "ymd today");

  const weekStart = zonedDayStartUnix("Asia/Kuala_Lumpur", now, -6);
  assert(ymdInZone("Asia/Kuala_Lumpur", weekStart) === "2026-10-15", "7 calendar days start on the 15th");

  const slots = calendarDaySlots("Asia/Kuala_Lumpur", now, 30);
  assert(slots.length === 30, "30 slots");
  assert(slots[0].date === "2026-09-22", `oldest ${slots[0].date}`);
  assert(slots[29].date === "2026-10-21", `newest ${slots[29].date}`);
  assert(slots[29].next - slots[29].start === 86400, "day length");

  const dayStart = 1_000_000;
  const day = 86_400;
  const two = [
    { date: "2026-10-20", start: dayStart, next: dayStart + day },
    { date: "2026-10-21", start: dayStart + day, next: dayStart + 2 * day }
  ];
  const hour = 3600;
  const inbound = [
    { ts: dayStart, value: 999 },
    { ts: dayStart + hour, value: 10 },
    { ts: dayStart + day, value: 5 },
    { ts: dayStart + day + hour, value: 7.4 }
  ];
  const outbound = [
    { ts: dayStart + hour, value: 1 },
    { ts: dayStart + day, value: 2 },
    { ts: dayStart + day + hour, value: 3 }
  ];
  const days = bucketVolumeDays(two, inbound, outbound, dayStart + day + hour);
  assert(days[0].inBytes === 15, `day1 in ${days[0].inBytes}`);
  assert(days[0].outBytes === 3, `day1 out ${days[0].outBytes}`);
  assert(days[1].inBytes === 7, `day2 in ${days[1].inBytes}`);
  assert(days[1].outBytes === 3, `day2 out ${days[1].outBytes}`);

  const missing = bucketVolumeDays(two, [], [], dayStart + 2 * day);
  assert(missing[0].inBytes == null && missing[1].outBytes == null, "no samples stay null");

  const summed = sumLineUseDays(days);
  assert(summed.inBytes === 22 && summed.outBytes === 6, "window sum matches days");
  const lastOnly = sumLineUseDays(days.slice(-1));
  assert(lastOnly.inBytes === 7 && lastOnly.outBytes === 3, "today is only the last day");

  console.log("lineUseWindow: ok");
}

run();
