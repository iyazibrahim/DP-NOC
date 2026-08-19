import { buildQuery } from "./metrics";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function run() {
  const q = buildQuery("nas_vol_free_pct", "site-1", "site-1-nas1");
  assert(q, "nas_vol_free_pct query missing");
  assert(
    q.includes("hrStorageSize") && q.includes("hrStorageUsed"),
    `volume free must use HOST-RESOURCES volumes, got: ${q}`
  );
  assert(
    q.includes("synoRaidFreeSize"),
    `volume free must fall back to RAID sizes, got: ${q}`
  );
  assert(q.includes("/volume"), `volume free must filter /volume descr, got: ${q}`);
  console.log("nas_vol_free_pct query: ok");
}

run();
