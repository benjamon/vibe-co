import { toNormalizedEvent } from "../normalize.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

interface EventbriteVenue {
  name?: string;
  address?: { localized_address_display?: string };
}

interface EventbriteEvent {
  name?: { text?: string };
  description?: { text?: string };
  url: string;
  start: { utc: string };
  end?: { utc: string };
  is_free?: boolean;
  logo?: { url?: string };
  venue?: EventbriteVenue;
}

interface EventbriteResponse {
  events?: EventbriteEvent[];
  pagination?: { has_more_items?: boolean; continuation?: string };
}

/**
 * Eventbrite retired public event *search* in 2020 — there is no way to query
 * "events near Bellingham" anymore. The only events endpoints still open are
 * per-organization and per-venue listings, so this pulls events for a
 * configured list of organization IDs (set EVENTBRITE_ORG_IDS + EVENTBRITE_TOKEN).
 * Find an organizer's ID via GET /v3/users/me/organizations/ while authenticated
 * as them, or from their public organizer page URL.
 */
export async function fetchEventbriteSource(orgId: string, token: string): Promise<FetchResult> {
  const sourceName = `Eventbrite (org ${orgId})`;
  try {
    const events: Omit<NormalizedEvent, "id">[] = [];
    let url: string | null = `https://www.eventbriteapi.com/v3/organizations/${orgId}/events/?status=live&expand=venue&order_by=start_asc`;

    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return { sourceName, events, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as EventbriteResponse;

      for (const e of data.events ?? []) {
        if (!e.start?.utc) continue;
        events.push(
          toNormalizedEvent({
            title: e.name?.text ?? "Untitled event",
            description: e.description?.text,
            startDateTime: new Date(e.start.utc).toISOString(),
            endDateTime: e.end?.utc ? new Date(e.end.utc).toISOString() : undefined,
            venueName: e.venue?.name,
            address: e.venue?.address?.localized_address_display,
            url: e.url,
            imageUrl: e.logo?.url,
            price: e.is_free ? "Free" : undefined,
            sourceName: "Eventbrite",
            sourceType: "eventbrite",
          }),
        );
      }

      url = data.pagination?.has_more_items && data.pagination.continuation
        ? `https://www.eventbriteapi.com/v3/organizations/${orgId}/events/?status=live&expand=venue&order_by=start_asc&continuation=${data.pagination.continuation}`
        : null;
    }

    return { sourceName: "Eventbrite", events };
  } catch (err) {
    return { sourceName, events: [], error: (err as Error).message };
  }
}
