// A minimal client for the Vectorial Data Terminal Agent API (the MCP server wraps the same API 1:1).
export const BASE = process.env.VD_BASE_URL ?? "https://terminal.vectorialdata.com/api/agent/v1";

export async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, apiKey?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String(json.message ?? `HTTP ${res.status}`)), { status: res.status, ...json });
  return json as T;
}
