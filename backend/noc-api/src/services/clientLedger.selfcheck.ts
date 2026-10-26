import { applyStationSamples, counterDelta, emptyLedger, normalizeMac } from "./clientLedger";
import { hitsForDay, macFromBandwidthKey, normalizePolicy, type ClientWatchPolicy } from "./clientWatch";
import { zonedHourKey } from "./lineUseWindow";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const tz = "Asia/Kuala_Lumpur";
const t0 = new Date("2026-10-26T07:00:00Z");
const policy: ClientWatchPolicy = normalizePolicy({
  guestSsids: ["Digital Economy"],
  guestDownloadBytes: 5_000_000_000,
  clientTotalBytes: 20_000_000_000,
  uploadBytes: 10_000_000_000,
  uploadRatio: 0.7
});

assert(normalizeMac("AA-BB-CC-DD-EE-FF") === "aa:bb:cc:dd:ee:ff", "mac");
assert(counterDelta(undefined, 500) === 0, "first sighting adds nothing");
assert(counterDelta(100, 150) === 50, "delta");
assert(counterDelta(500, 20) === 20, "reset counts the new value");
assert(zonedHourKey(tz, t0) === "2026-10-26T15", `hour ${zonedHourKey(tz, t0)}`);

let state = applyStationSamples(
  emptyLedger(),
  [
    {
      deviceId: "ap1",
      mac: "aa:bb:cc:dd:ee:ff",
      hostname: "LAPTOP",
      ip: "192.168.1.10",
      ssid: "Digital Economy",
      apLabel: "AP-1",
      vendor: "cambium",
      rxBytes: 1000,
      txBytes: 400,
      apps: ["YouTube"]
    }
  ],
  t0,
  tz
);
assert(state.clients["aa:bb:cc:dd:ee:ff"].days["2026-10-26"] == null, "first sample is a baseline");

state = applyStationSamples(
  state,
  [
    {
      deviceId: "ap1",
      mac: "aa:bb:cc:dd:ee:ff",
      hostname: "LAPTOP",
      ip: "192.168.1.10",
      ssid: "Digital Economy",
      apLabel: "AP-1",
      vendor: "cambium",
      rxBytes: 1000 + 6_000_000_000,
      txBytes: 400 + 1_000_000,
      apps: ["YouTube"]
    }
  ],
  t0,
  tz
);
const day = state.clients["aa:bb:cc:dd:ee:ff"].days["2026-10-26"];
assert(day.inBytes === 6_000_000_000, `download ${day?.inBytes}`);
assert(day.outBytes === 1_000_000, `upload ${day?.outBytes}`);

state = applyStationSamples(
  state,
  [
    {
      deviceId: "ap2",
      mac: "aa:bb:cc:dd:ee:ff",
      hostname: "LAPTOP",
      ip: "192.168.1.10",
      ssid: "Digital Economy",
      apLabel: "AP-2",
      vendor: "cambium",
      rxBytes: 9_000_000_000,
      txBytes: 0,
      apps: []
    }
  ],
  t0,
  tz
);
assert(
  state.clients["aa:bb:cc:dd:ee:ff"].days["2026-10-26"].inBytes === 6_000_000_000,
  "roam does not add the new AP counter"
);

const hits = hitsForDay(
  [
    {
      mac: "aa:bb:cc:dd:ee:ff",
      hostname: "LAPTOP",
      ip: null,
      ssid: "Digital Economy",
      apLabel: "AP-1",
      deviceId: "ap1",
      vendor: "cambium",
      apps: ["YouTube"],
      inBytes: 6_000_000_000,
      outBytes: 1_000_000,
      lastSeen: t0.toISOString()
    },
    {
      mac: "11:22:33:44:55:66",
      hostname: "BACKUP",
      ip: null,
      ssid: "Digital Penang",
      apLabel: "AP-1",
      deviceId: "ap1",
      vendor: "cambium",
      apps: [],
      inBytes: 12_000_000_000,
      outBytes: 11_000_000_000,
      lastSeen: t0.toISOString()
    }
  ],
  policy
);
assert(hits.length === 2, `hits ${hits.length}`);
assert(hits[0].reasons.some((r) => r.startsWith("Guest")), "guest cap");
assert(hits[1].reasons.some((r) => r.startsWith("Upload")), "upload shape");
assert(
  macFromBandwidthKey("bandwidth:site-1:aa:bb:cc:dd:ee:ff:2026-10-26", "site-1") === "aa:bb:cc:dd:ee:ff",
  "incident mac"
);

console.log("clientLedger: ok");
