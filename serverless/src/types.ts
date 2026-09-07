export type SourceType = "ical" | "rss" | "localist" | "eventbrite" | "meetup" | "scrape";

/** Common event schema every source connector normalizes into. */
export interface NormalizedEvent {
  /** Stable id derived from the dedupe key (see dedupe.ts). */
  id: string;
  title: string;
  description?: string;
  /** ISO 8601 datetime. Assumed America/Los_Angeles when the source has no explicit offset. */
  startDateTime: string;
  endDateTime?: string;
  allDay?: boolean;
  venueName?: string;
  address?: string;
  city: string;
  url: string;
  imageUrl?: string;
  price?: string;
  tags?: string[];
  sourceName: string;
  sourceType: SourceType;
  /** Populated by dedupe when two+ raw listings were merged into this event. */
  mergedFrom?: { sourceName: string; url: string }[];
}

export interface FetchResult {
  sourceName: string;
  events: Omit<NormalizedEvent, "id">[];
  error?: string;
}

export interface AggregateSnapshot {
  generatedAt: string;
  eventCount: number;
  sourceResults: { sourceName: string; count: number; error?: string }[];
  events: NormalizedEvent[];
}

export interface Env {
  EVENTS_KV: KVNamespace;
  DIGEST_EMAIL_FROM: string;
  DIGEST_EMAIL_TO: string;
  DIGEST_LOOKAHEAD_DAYS: string;
  EVENTBRITE_ORG_IDS: string;
  MEETUP_GROUP_URLNAMES: string;
  RESEND_API_KEY?: string;
  EVENTBRITE_TOKEN?: string;
  MEETUP_ACCESS_TOKEN?: string;
}
