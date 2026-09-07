import * as cheerio from "cheerio";
import { SCRAPER_USER_AGENT } from "../config.js";
import type { ScrapeSourceConfig } from "../config.js";
import { toNormalizedEvent } from "../normalize.js";
import { isScrapeAllowed } from "../robots.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function parseDate(text: string): string | undefined {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Light, config-driven HTML scraping for venues with no feed. Only used as a
 * last resort, checks robots.txt before every fetch, identifies itself with a
 * descriptive User-Agent, and does a single GET of the public listing page
 * (no crawling, no bypassing paywalls/logins). Selectors are best-effort and
 * may need updating if a venue's site markup changes.
 */
export async function fetchScrapeSource(source: ScrapeSourceConfig): Promise<FetchResult> {
  try {
    const allowed = await isScrapeAllowed(source.url);
    if (!allowed) {
      return { sourceName: source.name, events: [], error: "Disallowed by robots.txt" };
    }

    const res = await fetch(source.url, { headers: { "User-Agent": SCRAPER_USER_AGENT } });
    if (!res.ok) {
      return { sourceName: source.name, events: [], error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const { selectors } = source;

    const events: Omit<NormalizedEvent, "id">[] = [];
    $(selectors.eventCard).each((_, card) => {
      const el = $(card);
      const title = el.find(selectors.title).first().text().trim();
      if (!title) return;

      const linkEl = el.find(selectors.link).first();
      const hrefAttr = selectors.linkAttr ?? "href";
      const href = linkEl.attr(hrefAttr) ?? linkEl.attr("href");
      if (!href) return;
      const url = resolveUrl(href, source.url);

      const dateEl = el.find(selectors.date).first();
      const dateText = (selectors.dateAttr ? dateEl.attr(selectors.dateAttr) : undefined) ?? dateEl.text().trim();
      const startDateTime = parseDate(dateText);
      if (!startDateTime) return;

      const location = selectors.location ? el.find(selectors.location).first().text().trim() : undefined;

      events.push(
        toNormalizedEvent({
          title,
          startDateTime,
          venueName: source.venueName ?? (location || undefined),
          url,
          sourceName: source.name,
          sourceType: "scrape",
        }),
      );
    });

    return { sourceName: source.name, events };
  } catch (err) {
    return { sourceName: source.name, events: [], error: (err as Error).message };
  }
}
