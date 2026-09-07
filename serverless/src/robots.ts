import robotsParser from "robots-parser";
import { SCRAPER_USER_AGENT } from "./config.js";

const cache = new Map<string, ReturnType<typeof robotsParser> | null>();

/** Fetches and caches robots.txt for a URL's origin, returning null if it's unreachable/absent. */
async function getRobots(origin: string) {
  if (cache.has(origin)) return cache.get(origin) ?? null;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": SCRAPER_USER_AGENT },
    });
    if (!res.ok) {
      cache.set(origin, null);
      return null;
    }
    const body = await res.text();
    const parsed = robotsParser(`${origin}/robots.txt`, body);
    cache.set(origin, parsed);
    return parsed;
  } catch {
    cache.set(origin, null);
    return null;
  }
}

/** Returns true if scraping `url` is allowed for our user-agent (fails open when robots.txt is unreachable). */
export async function isScrapeAllowed(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  const robots = await getRobots(origin);
  if (!robots) return true;
  return robots.isAllowed(url, SCRAPER_USER_AGENT) ?? true;
}
