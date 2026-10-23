/// <reference types="node" />
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Saved between runs, per site: the Playwright storageState (the signed-in session)
// and when the site last finished a run. Encrypted with AES-256-GCM under
// COLLECTOR_STATE_KEY, an ops-repo secret, because the session can sign in to the
// site. The ops workflow caches the state directory between runs.
export type SiteState = {
  storageState?: unknown;
  lastSuccessAt?: string;
};

// Any string works as the key; it is hashed to 32 bytes.
const keyOf = (secret: string) => createHash("sha256").update(secret).digest();

export function encryptState(state: SiteState, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

// Undefined when the state can't be read with this key (rotated key, damaged file):
// the site then starts signed out, as on a first run.
export function decryptState(sealed: string, secret: string): SiteState | undefined {
  try {
    const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return JSON.parse(text) as SiteState;
  } catch {
    return undefined;
  }
}

export type StateStore = {
  load: (site: string) => Promise<SiteState>;
  save: (site: string, state: SiteState) => Promise<void>;
};

export function fileStateStore(directory: string, secret: string): StateStore {
  const path = (site: string) => join(directory, `${site}.state`);
  return {
    load: async (site) => {
      const sealed = await readFile(path(site), "utf8").catch(() => undefined);
      return (sealed && decryptState(sealed, secret)) || {};
    },
    save: async (site, state) => {
      await mkdir(directory, { recursive: true });
      await writeFile(path(site), encryptState(state, secret), { mode: 0o600 });
    },
  };
}
