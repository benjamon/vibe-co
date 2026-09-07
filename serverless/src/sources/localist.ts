import { SCRAPER_USER_AGENT } from "../config.js";
import type { LocalistSourceConfig } from "../config.js";
import { toNormalizedEvent } from "../normalize.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

interface LocalistInstance {
  event_instance: { start: string; end?: string; all_day?: boolean };
}

interface LocalistEvent {
  event: {
    title: string;
    description?: string;
    url: string;
    photo_url?: string;
    location_name?: string;
    address?: string;
    event_instances: LocalistInstance[];
  };
}

interface LocalistResponse {
  events?: LocalistEvent[];
}

function stripHtml(html: string | undefined): string | undefined {
  return html?.replace(/<[^>]+>/g, " ");
}

/**
 * Localist (localist.com / Concept3D) powers a lot of university and city
 * event calendars — including WWU's — and exposes a documented, unauthenticated
 * JSON API at /api/2/events. Docs: https://developer.localist.com/doc/api
 */
export async function fetchLocalistSource(source: LocalistSourceConfig): Promise<FetchResult> {
  try {
    const url = new URL("/api/2/events", source.baseUrl);
    url.searchParams.set("days", "45");
    url.searchParams.set("pp", "100");
    for (const [key, value] of Object.entries(source.params ?? {})) url.searchParams.set(key, value);

    const res = await fetch(url.toString(), { headers: { "User-Agent": SCRAPER_USER_AGENT, Accept: "application/json" } });
    if (!res.ok) {
      return { sourceName: source.name, events: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as LocalistResponse;

    const events: Omit<NormalizedEvent, "id">[] = [];
    for (const wrapper of data.events ?? []) {
      const e = wrapper.event;
      for (const instanceWrapper of e.event_instances ?? []) {
        const instance = instanceWrapper.event_instance;
        if (!instance.start) continue;
        events.push(
          toNormalizedEvent({
            title: e.title,
            description: stripHtml(e.description),
            startDateTime: new Date(instance.start).toISOString(),
            endDateTime: instance.end ? new Date(instance.end).toISOString() : undefined,
            allDay: instance.all_day,
            venueName: source.venueName ?? e.location_name,
            address: e.address,
            url: e.url,
            imageUrl: e.photo_url,
            sourceName: source.name,
            sourceType: "localist",
          }),
        );
      }
    }

    return { sourceName: source.name, events };
  } catch (err) {
    return { sourceName: source.name, events: [], error: (err as Error).message };
  }
}
