import { env } from "../env";

type PromQueryValue = {
  value: [number, string];
};

export type PromQueryResult =
  | { resultType: "vector"; result: Array<PromQueryValue & { metric: Record<string, string> }> }
  | { resultType: "matrix"; result: Array<{ metric: Record<string, string>; values: [number, string][] }> }
  | { resultType: string; result: unknown };

async function promFetch(path: string, params: Record<string, string>) {
  const url = new URL(path, env.PROMETHEUS_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Prometheus request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { status: string; data: PromQueryResult };
  if (json.status !== "success") {
    throw new Error(`Prometheus request not successful: ${JSON.stringify(json.data)}`);
  }
  return json.data;
}

export async function promQuery(query: string) {
  return promFetch("/api/v1/query", { query });
}

export async function promQueryRange(query: string, start: number, end: number, step: string) {
  return promFetch("/api/v1/query_range", {
    query,
    start: String(start),
    end: String(end),
    step
  });
}

export async function promTsdbStatus() {
  const url = new URL("/api/v1/status/tsdb", env.PROMETHEUS_BASE_URL);
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Prometheus TSDB status failed: ${res.status} ${body}`);
  }
  return res.json();
}

export function parseFirstVectorValue(data: PromQueryResult): number | null {
  if (data.resultType !== "vector") return null;
  const vec = data.result as Array<{ value?: [number, string] }>;
  if (!Array.isArray(vec) || vec.length === 0) return null;
  const v = vec[0]?.value?.[1];
  const parsed = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function parseVectorToNumericValues(data: PromQueryResult): number[] {
  if (data.resultType !== "vector") return [];
  const vec = data.result as Array<{ value?: [number, string] }>;
  if (!Array.isArray(vec)) return [];
  return vec
    .map((r) => r?.value?.[1])
    .map((v) => (typeof v === "string" ? Number(v) : Number(v)))
    .filter((x) => Number.isFinite(x) || x === 0);
}
