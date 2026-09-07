import type { Env } from "../src/types.js";

/** In-memory KV stand-in so aggregate/digest logic can run outside Workers, e.g. `npm run aggregate:local`. */
class MemoryKv {
  private store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list() {
    return { keys: [...this.store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null } as never;
  }
}

/** Builds an Env from process.env for local scripts. Set values via shell export or a .env you source yourself. */
export function buildLocalEnv(): Env {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    EVENTS_KV: new MemoryKv() as any,
    DIGEST_EMAIL_FROM: process.env.DIGEST_EMAIL_FROM ?? "events@example.com",
    DIGEST_EMAIL_TO: process.env.DIGEST_EMAIL_TO ?? "you@example.com",
    DIGEST_LOOKAHEAD_DAYS: process.env.DIGEST_LOOKAHEAD_DAYS ?? "14",
    EVENTBRITE_ORG_IDS: process.env.EVENTBRITE_ORG_IDS ?? "",
    MEETUP_GROUP_URLNAMES: process.env.MEETUP_GROUP_URLNAMES ?? "",
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EVENTBRITE_TOKEN: process.env.EVENTBRITE_TOKEN,
    MEETUP_ACCESS_TOKEN: process.env.MEETUP_ACCESS_TOKEN,
  };
}
