import { expect, it, vi } from "vitest";
import { authFetch, configureAuthRequest } from "../src/services/auth";

it("adds the current access token to API calls without dropping other headers", async () => {
  const dispose = configureAuthRequest(
    async () => "current-token",
    () => {},
  );
  vi.mocked(fetch).mockResolvedValue(Response.json({ ok: true }));
  try {
    await authFetch("/api/clients", {
      headers: { "Content-Type": "application/json" },
    });
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer current-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  } finally {
    dispose();
  }
});
it("expires the session for 401/account denial, while ordinary permission refusals stay on screen", async () => {
  const denied = vi.fn();
  const dispose = configureAuthRequest(async () => "token", denied);
  try {
    for (const [status, code] of [
      [403, "FORBIDDEN"],
      [403, "ACCOUNT_NOT_ALLOWED"],
      [401, "UNAUTHENTICATED"],
    ] as const) {
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ error: { code } }, { status }),
      );
      await authFetch("/api/clients");
    }
    expect(denied.mock.calls).toEqual([[403], [401]]);
  } finally {
    dispose();
  }
});
