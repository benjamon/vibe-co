import { describe, expect, it } from "vitest";
import { dedupeEvents, titleSimilarity } from "../dedupe.js";
import type { NormalizedEvent } from "../types.js";

function raw(overrides: Partial<Omit<NormalizedEvent, "id">> = {}): Omit<NormalizedEvent, "id"> {
  return {
    title: "Farmers Market",
    startDateTime: "2026-09-20T17:00:00.000Z",
    city: "Bellingham",
    url: "https://example.com/event/1",
    sourceName: "Test Source",
    sourceType: "ical",
    ...overrides,
  };
}

describe("titleSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(titleSimilarity("Bellingham Farmers Market", "Bellingham Farmers Market")).toBe(1);
  });

  it("is high for near-identical titles with punctuation/case differences", () => {
    expect(titleSimilarity("Bellingham Farmers Market!", "bellingham farmers market")).toBeGreaterThan(0.9);
  });

  it("is low for unrelated titles", () => {
    expect(titleSimilarity("Farmers Market", "Live Jazz Night")).toBeLessThan(0.4);
  });
});

describe("dedupeEvents", () => {
  it("merges events with the same canonical URL", async () => {
    const events = [
      raw({ url: "https://example.com/event/1?utm_source=fb", sourceName: "A" }),
      raw({ url: "https://example.com/event/1", sourceName: "B" }),
    ];
    const result = await dedupeEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.mergedFrom).toHaveLength(1);
  });

  it("merges same-day events with highly similar titles from different sources", async () => {
    const events = [
      raw({ title: "Bellingham Farmers Market", url: "https://a.example.com/e1", sourceName: "Whatcom Events" }),
      raw({ title: "Bellingham Farmers Market!", url: "https://b.example.com/e1", sourceName: "WWU Events Calendar" }),
    ];
    const result = await dedupeEvents(events);
    expect(result).toHaveLength(1);
  });

  it("keeps distinct events on different days separate", async () => {
    const events = [
      raw({ title: "Live Jazz Night", startDateTime: "2026-09-20T17:00:00.000Z", url: "https://a.example.com/e1" }),
      raw({ title: "Live Jazz Night", startDateTime: "2026-09-27T17:00:00.000Z", url: "https://a.example.com/e2" }),
    ];
    const result = await dedupeEvents(events);
    expect(result).toHaveLength(2);
  });

  it("keeps distinct events on the same day with different titles separate", async () => {
    const events = [
      raw({ title: "Farmers Market", url: "https://a.example.com/e1" }),
      raw({ title: "Live Jazz Night", url: "https://a.example.com/e2" }),
    ];
    const result = await dedupeEvents(events);
    expect(result).toHaveLength(2);
  });

  it("sorts the result chronologically", async () => {
    const events = [
      raw({ title: "Later Event", startDateTime: "2026-09-25T17:00:00.000Z", url: "https://a.example.com/e2" }),
      raw({ title: "Earlier Event", startDateTime: "2026-09-20T17:00:00.000Z", url: "https://a.example.com/e1" }),
    ];
    const result = await dedupeEvents(events);
    expect(result.map((e) => e.title)).toEqual(["Earlier Event", "Later Event"]);
  });
});
