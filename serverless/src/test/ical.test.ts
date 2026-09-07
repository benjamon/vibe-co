import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIcalSource } from "../sources/ical.js";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:1@example.com
DTSTAMP:20260901T000000Z
DTSTART:20260920T170000Z
DTEND:20260920T190000Z
SUMMARY:Bellingham Farmers Market
LOCATION:Depot Market Square
URL:https://example.com/events/farmers-market
DESCRIPTION:Weekly market
END:VEVENT
END:VCALENDAR`;

describe("fetchIcalSource", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses events out of a valid ICS feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_ICS) }),
    );

    const result = await fetchIcalSource({ type: "ical", name: "Test Feed", url: "https://example.com/cal.ics" });

    expect(result.error).toBeUndefined();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      title: "Bellingham Farmers Market",
      venueName: "Depot Market Square",
      url: "https://example.com/events/farmers-market",
    });
    expect(result.events[0]!.startDateTime).toBe("2026-09-20T17:00:00.000Z");
  });

  it("returns an error result on HTTP failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await fetchIcalSource({ type: "ical", name: "Test Feed", url: "https://example.com/missing.ics" });

    expect(result.events).toHaveLength(0);
    expect(result.error).toContain("404");
  });
});
