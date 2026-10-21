// Typed transport built on generated OpenAPI components. Regenerate generated.ts with make openapi-generate.
import type { components } from "./generated";
export type LoginInput = components["schemas"]["LoginInput"];
export type RepositoryInput = components["schemas"]["RepositoryInput"];
export type ProfileInput = components["schemas"]["ProfileInput"];
export type Manifest = components["schemas"]["Manifest"];
export function createClient(baseURL: string, fetcher: typeof fetch = fetch) {
  async function request<T>(
    path: string,
    body?: unknown,
    method = "POST",
  ): Promise<T> {
    const response = await fetcher(baseURL + path, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message || "Request failed");
    return json;
  }
  return {
    login: (input: LoginInput) =>
      request<{ authenticated: boolean; expiresIn: number }>(
        "/api/v1/auth/login",
        input,
      ),
    createRepository: (input: RepositoryInput) =>
      request<{ id: string }>("/api/v1/repositories", input),
    createProfile: (input: ProfileInput) =>
      request<{ id: string }>("/api/v1/agent-profiles", input),
    promote: (id: string, input: components["schemas"]["PromoteInput"]) =>
      request<{ channel: string; snapshotId: string; generation: number }>(
        "/api/v1/channels/" + encodeURIComponent(id) + "/promote",
        input,
      ),
  };
}
