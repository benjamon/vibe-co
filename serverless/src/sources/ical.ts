import ICAL from "ical.js";
import { SCRAPER_USER_AGENT } from "../config.js";
import type { IcalSourceConfig } from "../config.js";
import { toNormalizedEvent } from "../normalize.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

/** Fetches and parses a public .ics feed into normalized events. */
export async function fetchIcalSource(source: IcalSourceConfig): Promise<FetchResult> {
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": SCRAPER_USER_AGENT } });
    if (!res.ok) {
      return { sourceName: source.name, events: [], error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const jcalData = ICAL.parse(text);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const events: Omit<NormalizedEvent, "id">[] = [];
    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      if (!event.startDate) continue;

      const url = (vevent.getFirstPropertyValue("url") as string | null) ?? source.url;
      events.push(
        toNormalizedEvent({
          title: event.summary ?? "Untitled event",
          description: event.description ?? undefined,
          startDateTime: event.startDate.toJSDate().toISOString(),
          endDateTime: event.endDate ? event.endDate.toJSDate().toISOString() : undefined,
          allDay: event.startDate.isDate,
          venueName: source.venueName ?? event.location ?? undefined,
          url,
          sourceName: source.name,
          sourceType: "ical",
        }),
      );
    }

    return { sourceName: source.name, events };
  } catch (err) {
    return { sourceName: source.name, events: [], error: (err as Error).message };
  }
}
