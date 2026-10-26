import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authConfigSchema } from "../../shared/users";

let client: Promise<SupabaseClient> | undefined;
export function authClient() {
  if (!client)
    client = fetch("/api/auth/config")
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Sign-in is not configured. Contact your Admin.");
        const config = authConfigSchema.parse(await response.json());
        return createClient(config.url, config.publishableKey, {
          auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
            persistSession: true,
            autoRefreshToken: true,
          },
        });
      })
      .catch((error) => {
        client = undefined;
        throw error;
      });
  return client;
}

// Installed by AuthGate after initialization, before any workspace service mounts.
let token: () => Promise<string | undefined> = async () => undefined;
let refused: (status: number) => void = () => {};
export function configureAuthRequest(
  getToken: typeof token,
  onRefused: typeof refused,
) {
  token = getToken;
  refused = onRefused;
  return () => {
    token = async () => undefined;
    refused = () => {};
  };
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const accessToken = await token();
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 || response.status === 403) {
    const json = await response
      .clone()
      .json()
      .catch(() => null);
    if (response.status === 401 || json?.error?.code === "ACCOUNT_NOT_ALLOWED")
      refused(response.status);
  }
  return response;
}
