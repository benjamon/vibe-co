import { describe, expect, it } from "vitest";
import { buildDigest, selectUpcoming } from "../digest.js";
import type { NormalizedEvent } from "../types.js";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36),
    title: "Test Event",
    startDateTime: "2026-09-20T17:00:00.000Z",
    city: "Bellingham",
    url: "https://example.com/e",
    sourceName: "Test Source",
    sourceType: "ical",
    ...overrides,
  };
}

describe("selectUpcoming", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("includes events within the lookahead window", () => {
    const events = [event({ startDateTime: "2026-09-10T12:00:00.000Z" })];
    expect(selectUpcoming(events, 14, now)).toHaveLength(1);
  });

  it("excludes events before now", () => {
    const events = [event({ startDateTime: "2026-09-01T12:00:00.000Z" })];
    expect(selectUpcoming(events, 14, now)).toHaveLength(0);
  });

  it("excludes events beyond the lookahead window", () => {
    const events = [event({ startDateTime: "2026-10-01T12:00:00.000Z" })];
    expect(selectUpcoming(events, 14, now)).toHaveLength(0);
  });
});

describe("buildDigest", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("produces a subject line reflecting the event count", () => {
    const events = [event({ startDateTime: "2026-09-10T12:00:00.000Z" })];
    const digest = buildDigest(events, 14, now);
    expect(digest.subject).toContain("1");
    expect(digest.eventCount).toBe(1);
  });

  it("handles zero upcoming events without throwing", () => {
    const digest = buildDigest([], 14, now);
    expect(digest.eventCount).toBe(0);
    expect(digest.html).toContain("No upcoming events");
  });

  it("includes event titles and links in both html and text bodies", () => {
    const events = [event({ title: "Bellingham Farmers Market", url: "https://example.com/market", startDateTime: "2026-09-10T17:00:00.000Z" })];
    const digest = buildDigest(events, 14, now);
    expect(digest.html).toContain("Bellingham Farmers Market");
    expect(digest.html).toContain("https://example.com/market");
    expect(digest.text).toContain("Bellingham Farmers Market");
  });
});
