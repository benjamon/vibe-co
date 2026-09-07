import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRssSource } from "../sources/rss.js";

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Sample Venue Events</title>
    <item>
      <title>Live Jazz Night</title>
      <link>https://example.com/events/jazz-night</link>
      <pubDate>Sun, 20 Sep 2026 19:00:00 GMT</pubDate>
      <description>An evening of jazz.</description>
    </item>
  </channel>
</rss>`;

describe("fetchRssSource", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses items out of an RSS 2.0 feed, using pubDate as start time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) }));

    const result = await fetchRssSource({ type: "rss", name: "Sample Venue", url: "https://example.com/feed.rss" });

    expect(result.error).toBeUndefined();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      title: "Live Jazz Night",
      url: "https://example.com/events/jazz-night",
    });
  });

  it("skips items missing a title or link", async () => {
    const badRss = `<?xml version="1.0"?><rss version="2.0"><channel><item><pubDate>Sun, 20 Sep 2026 19:00:00 GMT</pubDate></item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(badRss) }));

    const result = await fetchRssSource({ type: "rss", name: "Sample Venue", url: "https://example.com/feed.rss" });
    expect(result.events).toHaveLength(0);
  });
});
