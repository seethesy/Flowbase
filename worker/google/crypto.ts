// Google Calendar sync secrets (FLOW-268 AC4). Refresh tokens are stored
// encrypted with AES-GCM under GOOGLE_TOKEN_KEY, a Worker secret holding 32
// random bytes in base64; they are never returned to the browser. The same key
// signs the OAuth state, so the callback knows which user started the connect.

const encoder = new TextEncoder();
const encode = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  fromBase64(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64(secret.trim());
  if (bytes.length !== 32) throw new Error("GOOGLE_TOKEN_KEY must be 32 bytes in base64.");
  return bytes;
}

const aesKey = (secret: string) =>
  crypto.subtle.importKey("raw", keyBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", keyBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

// "v1.<iv>.<ciphertext>", both base64.
export async function encryptToken(secret: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), encode(token)),
  );
  return `v1.${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function decryptToken(secret: string, stored: string): Promise<string> {
  const [version, iv, cipher] = stored.split(".");
  if (version !== "v1" || !iv || !cipher) throw new Error("Unknown token format.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await aesKey(secret),
    fromBase64(cipher),
  );
  return decoder.decode(plain);
}

export const STATE_TTL_MS = 10 * 60_000;

// A short-lived, signed OAuth state naming the user who started the connect.
export async function signState(secret: string, userId: string, now = Date.now()): Promise<string> {
  const body = toBase64Url(
    encode(JSON.stringify({ u: userId, e: now + STATE_TTL_MS, n: toBase64Url(crypto.getRandomValues(new Uint8Array(12))) })),
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

// The user id in a valid, unexpired state, or null.
export async function verifyState(secret: string, state: string, now = Date.now()): Promise<string | null> {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(signature),
      encode(body),
    );
    if (!valid) return null;
    const parsed = JSON.parse(decoder.decode(fromBase64Url(body))) as { u?: unknown; e?: unknown };
    if (typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < now) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

// A stable fingerprint of what was last pushed for an event.
export async function fingerprint(value: unknown): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encode(JSON.stringify(value))));
  return toBase64(digest);
}
