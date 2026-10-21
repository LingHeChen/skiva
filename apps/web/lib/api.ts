export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(body !== undefined ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new ApiError(
      r.status,
      data.error?.message || "服务暂时不可用",
      data.error?.requestId,
    );
  return data;
}
export async function apiList(path: string) {
  const first = await api(path);
  if (!Array.isArray(first.items)) return first;
  const items = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await api(
      path +
        (path.includes("?") ? "&" : "?") +
        "cursor=" +
        encodeURIComponent(cursor),
    );
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  return { ...first, items, nextCursor: null };
}
