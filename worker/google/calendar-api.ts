// The few Google OAuth and Calendar API calls Flowbase makes (FLOW-268). Every
// call goes through `googleFetch`, which tests replace with a fake Google.
// The Calendar API is free at this volume; nothing here needs a paid service.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://www.googleapis.com/calendar/v3";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let googleFetch: Fetch = (input, init) => fetch(input, init);
// Tests point the Worker at a fake Google; null restores the real one.
export function setGoogleFetch(next: Fetch | null) {
  googleFetch = next ?? ((input, init) => fetch(input, init));
}

export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };

// Google refused the refresh token (revoked, expired, or the app's 7-day Testing
// limit): the user has to reconnect.
export class GoogleAuthError extends Error {}
export class GoogleApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await googleFetch(url, init);
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
  if (!response.ok) {
    const error = body.error;
    const code = typeof error === "string" ? error : "";
    if (code === "invalid_grant" || response.status === 401) throw new GoogleAuthError(code || "unauthorized");
    const message = typeof error === "object" && error && "message" in error ? String(error.message) : code;
    throw new GoogleApiError(response.status, message || `Google answered ${response.status}.`);
  }
  return body;
}

const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

export function authorizationUrl(client: GoogleClient, scopes: readonly string[], state: string) {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    // A refresh token, so the sync keeps running after the user leaves.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type Tokens = { accessToken: string; expiresIn: number; refreshToken?: string };
type TokenBody = { access_token: string; expires_in: number; refresh_token?: string };
const tokens = (body: TokenBody): Tokens => ({
  accessToken: body.access_token,
  expiresIn: body.expires_in,
  refreshToken: body.refresh_token,
});

export async function exchangeCode(client: GoogleClient, code: string): Promise<Tokens> {
  return tokens(
    await call<TokenBody>(
      TOKEN_URL,
      form({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
        grant_type: "authorization_code",
      }),
    ),
  );
}

export async function refreshAccessToken(client: GoogleClient, refreshToken: string): Promise<Tokens> {
  return tokens(
    await call<TokenBody>(
      TOKEN_URL,
      form({
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
      }),
    ),
  );
}

// Best effort: an already revoked token is fine.
export async function revokeToken(token: string) {
  try {
    await googleFetch(REVOKE_URL, form({ token }));
  } catch {
    // Disconnect still deletes the token on our side.
  }
}

const authed = (accessToken: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
});

export async function createCalendar(accessToken: string, summary: string, timeZone: string): Promise<string> {
  const body = await call<{ id: string }>(
    `${API}/calendars`,
    authed(accessToken, { method: "POST", body: JSON.stringify({ summary, timeZone }) }),
  );
  return body.id;
}

export type GoogleTime = { dateTime?: string; date?: string; timeZone?: string };
export type GoogleEventResource = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  start?: GoogleTime;
  end?: GoogleTime;
};

// The user's primary calendar between two instants, recurring events expanded.
export async function listPrimaryEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleEventResource[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const body = await call<{ items?: GoogleEventResource[] }>(
    `${API}/calendars/primary/events?${params.toString()}`,
    authed(accessToken),
  );
  return (body.items ?? []).filter((item) => item.status !== "cancelled");
}

export type PushedEvent = {
  summary: string;
  location?: string;
  description: string;
  start: GoogleTime;
  end: GoogleTime;
  extendedProperties: { private: { flowbaseEventId: string } };
};

const eventsOf = (calendarId: string) => `${API}/calendars/${encodeURIComponent(calendarId)}/events`;

export async function insertEvent(accessToken: string, calendarId: string, event: PushedEvent): Promise<string> {
  const body = await call<{ id: string }>(
    eventsOf(calendarId),
    authed(accessToken, { method: "POST", body: JSON.stringify(event) }),
  );
  return body.id;
}

export async function updateEvent(accessToken: string, calendarId: string, googleEventId: string, event: PushedEvent) {
  await call(
    `${eventsOf(calendarId)}/${encodeURIComponent(googleEventId)}`,
    authed(accessToken, { method: "PUT", body: JSON.stringify(event) }),
  );
}

// A copy the user already deleted in Google counts as deleted.
export async function deleteEvent(accessToken: string, calendarId: string, googleEventId: string) {
  try {
    await call(`${eventsOf(calendarId)}/${encodeURIComponent(googleEventId)}`, authed(accessToken, { method: "DELETE" }));
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
