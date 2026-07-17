import { env } from "../env";

type PromQueryValue = {
  value: [number, string]; // [unixTs, "valueAsString"]
};

type PromQueryResult =
  | { resultType: "vector"; result: Array<PromQueryValue & { metric: Record<string, string> }> }
  | { resultType: string; result: any };

export async function promQuery(query: string) {
  const url = new URL("/api/v1/query", env.PROMETHEUS_BASE_URL);
  url.searchParams.set("query", query);

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Prometheus query failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { status: string; data: PromQueryResult };
  if (json.status !== "success") {
    throw new Error(`Prometheus query not successful: ${JSON.stringify(json.data)}`);
  }

  return json.data;
}

export function parseFirstVectorValue(data: PromQueryResult): number | null {
  if (data.resultType !== "vector") return null;
  const vec = data.result;
  if (!Array.isArray(vec) || vec.length === 0) return null;
  const v = vec[0]?.value?.[1];
  const parsed = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

