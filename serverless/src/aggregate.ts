import { STATIC_SOURCES } from "./config.js";
import { dedupeEvents } from "./dedupe.js";
import { fetchEventbriteSource } from "./sources/eventbrite.js";
import { fetchIcalSource } from "./sources/ical.js";
import { fetchLocalistSource } from "./sources/localist.js";
import { fetchMeetupSource } from "./sources/meetup.js";
import { fetchRssSource } from "./sources/rss.js";
import { fetchScrapeSource } from "./sources/scrape.js";
import type { AggregateSnapshot, Env, FetchResult, NormalizedEvent } from "./types.js";

export const SNAPSHOT_KV_KEY = "aggregate-snapshot:latest";

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function fetchStaticSource(source: (typeof STATIC_SOURCES)[number]): Promise<FetchResult> {
  switch (source.type) {
    case "ical":
      return fetchIcalSource(source);
    case "rss":
      return fetchRssSource(source);
    case "localist":
      return fetchLocalistSource(source);
    case "scrape":
      return fetchScrapeSource(source);
  }
}

/** Fetches every configured source, normalizes, dedupes, and returns a snapshot. Never throws — per-source failures are captured as errors. */
export async function aggregateEvents(env: Env): Promise<AggregateSnapshot> {
  const jobs: Promise<FetchResult>[] = STATIC_SOURCES.map(fetchStaticSource);

  if (env.EVENTBRITE_TOKEN) {
    for (const orgId of splitCsv(env.EVENTBRITE_ORG_IDS)) {
      jobs.push(fetchEventbriteSource(orgId, env.EVENTBRITE_TOKEN));
    }
  }
  if (env.MEETUP_ACCESS_TOKEN) {
    for (const group of splitCsv(env.MEETUP_GROUP_URLNAMES)) {
      jobs.push(fetchMeetupSource(group, env.MEETUP_ACCESS_TOKEN));
    }
  }

  const results = await Promise.all(jobs);

  const allRaw = results.flatMap((r) => r.events);
  const events = await dedupeEvents(allRaw);

  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.startDateTime).getTime() >= now - 6 * 60 * 60 * 1000);

  return {
    generatedAt: new Date().toISOString(),
    eventCount: upcoming.length,
    sourceResults: results.map((r) => ({ sourceName: r.sourceName, count: r.events.length, error: r.error })),
    events: upcoming,
  };
}

export async function saveSnapshot(env: Env, snapshot: AggregateSnapshot): Promise<void> {
  await env.EVENTS_KV.put(SNAPSHOT_KV_KEY, JSON.stringify(snapshot));
}

export async function loadSnapshot(env: Env): Promise<AggregateSnapshot | null> {
  const raw = await env.EVENTS_KV.get(SNAPSHOT_KV_KEY);
  return raw ? (JSON.parse(raw) as AggregateSnapshot) : null;
}

export type { NormalizedEvent };
