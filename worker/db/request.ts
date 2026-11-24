import type { Bindings } from "../bindings";
import type { RunWithDb } from "../hono";
import type { Db } from "./client";

// Settles a session whose withDb answered without running the work.
const unshared = Symbol("unshared");

// One database client per API request (FLOW-306). The first use opens it through
// the app's withDb, every later use in the same request shares it, and close()
// releases it after the response. Transactions still use db.transaction. Cron,
// jobs and tests keep calling withDb directly. A withDb that answers without
// running its callback (a test double) is simply called once per use.
export function requestDb(withDb: RunWithDb, env: Bindings) {
  let session: Promise<Db> | undefined;
  let release: (() => void) | undefined;
  let started = false;
  let finished: Promise<unknown> = Promise.resolve();
  // What an unshared withDb answered for the first use, handed to that use.
  let answer: { value: unknown } | undefined;
  const open = () =>
    (session ??= new Promise<Db>((resolve, reject) => {
      finished = Promise.resolve(withDb(env, (db) => {
        started = true;
        resolve(db);
        return new Promise<void>((done) => {
          release = done;
        });
      })).then(
        (value) => {
          if (started) return;
          answer = { value };
          reject(unshared);
        },
        (error: unknown) => {
          // Before the client opened, this is the request's error (e.g. no
          // database: 503). After, a failed close is only logged.
          if (started) console.error("request_db_close_failed", error);
          else reject(error);
        },
      );
    }));
  const run: RunWithDb = async <T>(_env: Bindings, task: (db: Db) => Promise<T>): Promise<T> => {
    let db: Db;
    try {
      db = await open();
    } catch (error) {
      if (error !== unshared) throw error;
      if (answer) {
        const { value } = answer;
        answer = undefined;
        return value as T;
      }
      return withDb(env, task);
    }
    return task(db);
  };
  return {
    run,
    get opened() {
      return session !== undefined;
    },
    async close() {
      if (!session) return;
      await session.catch(() => undefined);
      release?.();
      await finished;
    },
  };
}
