import { outagesFromAvailability, type WebsiteSeriesPoint } from "./websiteMetrics";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Lightweight self-check: five separate flaps → five outages when recovery samples exist. */
function run() {
  const series: WebsiteSeriesPoint[] = [];
  let ts = 1_000_000;
  for (let flap = 0; flap < 5; flap++) {
    series.push({ ts, value: 0 });
    ts += 15;
    series.push({ ts, value: 0 });
    ts += 15;
    series.push({ ts, value: 1 });
    ts += 60;
  }
  const outages = outagesFromAvailability(series, ts);
  assert(outages.length === 5, `expected 5 outages, got ${outages.length}`);
  console.log("outagesFromAvailability: ok (5 flaps → 5 outages)");
}

run();
