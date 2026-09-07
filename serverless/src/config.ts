/**
 * Source configuration. Feed URLs here are a starting point, not guarantees — venues
 * change CMS platforms and feed paths over time. Verify each URL still resolves before
 * relying on it (`npm run aggregate:local` prints a per-source error if one breaks),
 * and see README.md#sources for how to find replacements.
 */

export interface IcalSourceConfig {
  type: "ical";
  name: string;
  url: string;
  venueName?: string;
}

export interface RssSourceConfig {
  type: "rss";
  name: string;
  url: string;
  venueName?: string;
}

export interface LocalistSourceConfig {
  type: "localist";
  name: string;
  /** Base URL of the Localist instance, e.g. https://calendars.wwu.edu */
  baseUrl: string;
  venueName?: string;
  /** Optional Localist search params, e.g. { group_id: "123" } */
  params?: Record<string, string>;
}

export interface ScrapeSourceConfig {
  type: "scrape";
  name: string;
  url: string;
  venueName?: string;
  /** CSS selectors used to pull each event card out of the listing page. */
  selectors: {
    eventCard: string;
    title: string;
    /** Attribute to read the detail link from (defaults to href on the title/link element). */
    link: string;
    linkAttr?: string;
    date: string;
    /** Attribute holding a machine-readable date (e.g. datetime="2026-09-20"); falls back to text content. */
    dateAttr?: string;
    location?: string;
  };
}

export type StaticSourceConfig =
  | IcalSourceConfig
  | RssSourceConfig
  | LocalistSourceConfig
  | ScrapeSourceConfig;

export const CITY = "Bellingham";
export const TIMEZONE = "America/Los_Angeles";
export const SCRAPER_USER_AGENT = "BellinghamEventsAggregator/0.1 (+https://github.com/benjamon/vibe-co)";

/**
 * iCal / RSS feeds and light scrape targets for local venues & organizations.
 * Eventbrite and Meetup are configured separately in eventbrite.ts / meetup.ts
 * since they need API credentials, not just a URL.
 */
export const STATIC_SOURCES: StaticSourceConfig[] = [
  // Western Washington University's public events calendar runs on Localist,
  // which exposes a documented, unauthenticated JSON API — the most reliable
  // structured source in this list.
  {
    type: "localist",
    name: "WWU Events Calendar",
    baseUrl: "https://calendars.wwu.edu",
  },

  // City of Bellingham's events calendar (parks & rec, city-sponsored community
  // events) runs on The Events Calendar (Tribe) WordPress plugin, whose listing
  // pages support a standard `?ical=1` export of all currently-listed events.
  {
    type: "ical",
    name: "City of Bellingham Events",
    url: "https://cob.org/events/?ical=1",
  },

  // Bellingham Public Library's events calendar runs on LibCal (Springshare),
  // which exposes a per-calendar iCal subscribe endpoint. cid=20512 is the
  // "BPL-Events" calendar (confirmed via bellinghampubliclibrary.libcal.com/calendar/BPL-Events).
  {
    type: "ical",
    name: "Bellingham Public Library",
    url: "https://bellinghampubliclibrary.libcal.com/ical_subscribe.php?src=p&cid=20512",
  },

  // Whatcom County Library System (branches throughout the county, several in
  // and around Bellingham) — same LibCal platform, different instance/cid.
  {
    type: "ical",
    name: "Whatcom County Library System",
    url: "https://wcls.libcal.com/ical_subscribe.php?src=p&cid=5625",
  },

  // Mount Baker Theatre doesn't publish a feed, so it's a scrape fallback.
  // Selectors are a best-effort starting point — inspect the live DOM and
  // adjust them if the site's markup has changed (see README#scraping).
  {
    type: "scrape",
    name: "Mount Baker Theatre",
    url: "https://www.mountbakertheatre.com/events-tickets/",
    venueName: "Mount Baker Theatre",
    selectors: {
      eventCard: ".event, .event-item, article.event",
      title: ".event-title, h3, h2",
      link: "a",
      date: ".event-date, time",
      dateAttr: "datetime",
      location: ".event-venue, .event-location",
    },
  },
];

export const DEDUPE_TITLE_SIMILARITY_THRESHOLD = 0.82;
