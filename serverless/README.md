# Bellingham Events Aggregator

A lightweight system that pulls upcoming events in Bellingham, WA from multiple
sources, normalizes them into one schema, dedupes overlapping listings, serves
them as a dashboard, and emails a daily digest of what's coming up.

It's a single [Cloudflare Worker](https://developers.cloudflare.com/workers/):
one `fetch` handler serves the dashboard + JSON API, one `scheduled` handler
(cron trigger) runs daily to refresh the data and send the digest email.
Cloudflare's free tier covers this comfortably (100k requests/day, KV storage,
one cron trigger).

## How it works

```
src/sources/*.ts   → per-source connectors, each returns NormalizedEvent[]
src/normalize.ts   → common event schema helpers
src/dedupe.ts       → merges near-duplicate listings across sources
src/aggregate.ts   → orchestrates all sources, dedupes, stores snapshot in KV
src/digest.ts       → builds the "next N days" email body (html + text)
src/email.ts         → sends the digest via Resend
src/dashboard.ts   → the dashboard's HTML/CSS/JS (served at `/`)
src/worker.ts        → Worker entry point: fetch() + scheduled() handlers
```

Common event schema (`src/types.ts`):

```ts
{
  id, title, description?, startDateTime, endDateTime?, allDay?,
  venueName?, address?, city, url, imageUrl?, price?, tags?,
  sourceName, sourceType, mergedFrom?  // dedupe provenance
}
```

## Sources

| Source | Type | Status |
|---|---|---|
| WWU Events Calendar | Localist JSON API | Works out of the box, no key needed |
| Whatcom Events (bellingham.org) | iCal | **Needs a real feed URL** — see below |
| Mount Baker Theatre | HTML scrape | Best-effort selectors — verify against the live site |
| Eventbrite | REST API, per-organizer | Opt-in, needs a token + organizer IDs |
| Meetup | GraphQL API, per-group | Opt-in, needs Meetup Pro + an approved OAuth app |

Reality check on the two "public APIs" the task mentions:

- **Eventbrite** shut off its public event *search* API in 2020. There is no
  "give me events near Bellingham" endpoint anymore — only per-organizer and
  per-venue listings for organizers you already know. This aggregator pulls
  events for whatever organizer IDs you configure in `EVENTBRITE_ORG_IDS`
  (comma-separated) with an `EVENTBRITE_TOKEN`. Get an org ID from
  `GET /v3/users/me/organizations/` while authenticated as that organizer, or
  from their organizer page URL. If you don't have specific Bellingham
  organizers to track, leave this unset — it's skipped entirely.
- **Meetup** requires a paid Meetup Pro subscription just to create an OAuth
  app, and Meetup can deny the application. If you have Pro access, set
  `MEETUP_ACCESS_TOKEN` and `MEETUP_GROUP_URLNAMES` (comma-separated group
  slugs). Otherwise leave both unset.

Because of those two, the connectors that actually carry the load out of the
box are the Localist (WWU) and iCal/RSS/scrape ones. That's normal for this
space — most small-venue calendars don't have a real public API, which is why
the task also asked for iCal/RSS and scraping.

### Fixing/adding feed URLs

`src/config.ts` → `STATIC_SOURCES` is the list of iCal/RSS/scrape/Localist
sources. To adjust or add one:

1. **iCal**: look for an "Export"/"Subscribe"/calendar icon on the venue's
   site; it usually links to a `.ics` URL. Add `{ type: "ical", name, url }`.
2. **RSS**: many WordPress-based sites (e.g. via The Events Calendar plugin)
   expose `/events/feed/`. Add `{ type: "rss", name, url }`.
3. **Localist-powered calendars** (common at universities/cities — check for
   `localist.com` in page source or a `/api/2/events` endpoint that returns
   JSON): add `{ type: "localist", name, baseUrl }`.
4. **Scrape fallback**: only for sites with no feed. Add a `scrape` entry with
   CSS selectors for the event card / title / link / date on the listing
   page. Run `npm run aggregate:local` to see counts and errors per source —
   0 events usually means a selector needs adjusting.

Run `npm run aggregate:local` any time to sanity-check all sources without
touching Cloudflare (prints per-source counts/errors and a preview of events).

### Scraping policy

The scrape connector (`src/sources/scrape.ts`):
- Checks `robots.txt` before every fetch and skips the source if disallowed.
- Sends a descriptive `User-Agent` identifying the bot.
- Does a single GET of the public listing page — no crawling, no auth
  bypass, no rate-limit hammering.

Only use it for sites with no iCal/RSS/API option, and re-check each venue's
Terms of Service before relying on scraped data in anything beyond personal
use.

## Deduping

Two listings are merged when either:
- their canonical URLs match (query strings/trailing slash ignored), or
- they fall on the same calendar day **and** their titles are ≥82% similar
  (Sørensen–Dice over character bigrams — cheap, dependency-free, tolerant of
  punctuation/case differences).

The earliest-dated listing becomes canonical; the rest are recorded under
`mergedFrom` for provenance (visible via `/api/events`).

## Setup

```bash
cd serverless
npm install
```

### 1. Create the KV namespace

```bash
npm run kv:create
```

Copy the returned `id` into `wrangler.toml` under `[[kv_namespaces]]`.

### 2. Configure

Edit the `[vars]` block in `wrangler.toml`:
- `DIGEST_EMAIL_FROM` / `DIGEST_EMAIL_TO` — who the digest is from/to. `TO`
  accepts a comma-separated list.
- `DIGEST_LOOKAHEAD_DAYS` — window for "what's coming up" (7–14 suggested).
- `EVENTBRITE_ORG_IDS` / `MEETUP_GROUP_URLNAMES` — optional, see above.

Set secrets (never go in `wrangler.toml`):

```bash
wrangler secret put RESEND_API_KEY        # required for the email to send
wrangler secret put EVENTBRITE_TOKEN      # optional
wrangler secret put MEETUP_ACCESS_TOKEN   # optional
```

[Resend](https://resend.com) has a free tier (100 emails/day) and works
without SMTP, which fits Workers' runtime. Swap `src/email.ts` for a
different provider if you'd rather use SendGrid/Postmark/etc.

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill it in
(`wrangler dev` reads it automatically; it's gitignored).

### 3. Run locally

```bash
npm run dev                # Worker at http://localhost:8787 (dashboard + API)
npm run aggregate:local    # aggregate once, print results, no deploy needed
npm run digest:local       # build + print today's digest (add --send to actually email it)
npm test                   # unit tests
npm run typecheck
```

### 4. Deploy

```bash
npm run deploy
```

This registers the cron trigger from `wrangler.toml` (`crons = ["0 13 * *
*"]` — 13:00 UTC daily, i.e. ~05:00/06:00 Pacific depending on DST; edit to
taste) and publishes the Worker. Cloudflare will print the `*.workers.dev`
URL — that's your dashboard.

## Dashboard

`GET /` — a single HTML page with client-side search + source filter, reading
from `GET /api/events` (returns the latest cached snapshot: events, per-source
counts/errors, and `generatedAt`).

`POST /api/refresh` — re-runs aggregation on demand (useful for testing;
the scheduled job does this automatically every day).

`POST /api/send-digest` — re-runs aggregation and sends the digest email
immediately, without waiting for the cron trigger.

## Extending

- **New source type**: add a connector in `src/sources/`, following the
  `(config) => Promise<FetchResult>` shape used by the others, then wire it
  into `src/aggregate.ts`.
- **Different email provider**: only `src/email.ts` needs to change.
- **Different hosting**: the logic in `src/aggregate.ts`, `src/digest.ts`,
  and the connectors has no Cloudflare-specific imports (KV access is
  isolated to `aggregate.ts`'s `saveSnapshot`/`loadSnapshot`) — porting to
  another scheduled-function platform mostly means swapping the KV calls for
  that platform's storage and rewriting `worker.ts`'s two handlers.
