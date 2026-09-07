import { XMLParser } from "fast-xml-parser";
import { SCRAPER_USER_AGENT } from "../config.js";
import type { RssSourceConfig } from "../config.js";
import { toNormalizedEvent } from "../normalize.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return String(value);
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Parses RSS 2.0 and Atom feeds. Most calendar RSS feeds only expose a publish
 * date, not a structured event start time, so this uses `ev:startdate` /
 * `startDate` extensions when present and otherwise falls back to the item's
 * published date — good enough for a "what's coming up" digest, not exact.
 */
export async function fetchRssSource(source: RssSourceConfig): Promise<FetchResult> {
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": SCRAPER_USER_AGENT } });
    if (!res.ok) {
      return { sourceName: source.name, events: [], error: `HTTP ${res.status}` };
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);

    const events: Omit<NormalizedEvent, "id">[] = [];

    const rssItems = asArray<Record<string, unknown>>(parsed?.rss?.channel?.item);
    for (const item of rssItems) {
      const title = textOf(item.title);
      const link = textOf(item.link);
      if (!title || !link) continue;
      const startDateTime =
        toIso(textOf(item["ev:startdate"]) ?? textOf(item.startDate)) ?? toIso(textOf(item.pubDate));
      if (!startDateTime) continue;

      events.push(
        toNormalizedEvent({
          title,
          description: textOf(item.description),
          startDateTime,
          venueName: source.venueName,
          url: link,
          sourceName: source.name,
          sourceType: "rss",
        }),
      );
    }

    const atomEntries = asArray<Record<string, unknown>>(parsed?.feed?.entry);
    for (const entry of atomEntries) {
      const title = textOf(entry.title);
      const linkField = entry.link as { "@_href"?: string } | { "@_href"?: string }[] | undefined;
      const link = Array.isArray(linkField) ? linkField[0]?.["@_href"] : linkField?.["@_href"];
      if (!title || !link) continue;
      const startDateTime = toIso(textOf(entry.published) ?? textOf(entry.updated));
      if (!startDateTime) continue;

      events.push(
        toNormalizedEvent({
          title,
          description: textOf(entry.summary) ?? textOf(entry.content),
          startDateTime,
          venueName: source.venueName,
          url: link,
          sourceName: source.name,
          sourceType: "rss",
        }),
      );
    }

    return { sourceName: source.name, events };
  } catch (err) {
    return { sourceName: source.name, events: [], error: (err as Error).message };
  }
}
