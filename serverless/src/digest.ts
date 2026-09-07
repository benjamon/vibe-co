import { TIMEZONE } from "./config.js";
import type { NormalizedEvent } from "./types.js";

export interface Digest {
  subject: string;
  html: string;
  text: string;
  eventCount: number;
}

/** Selects events starting within [now, now + lookaheadDays]. */
export function selectUpcoming(events: NormalizedEvent[], lookaheadDays: number, now: Date = new Date()): NormalizedEvent[] {
  const start = now.getTime();
  const end = start + lookaheadDays * 24 * 60 * 60 * 1000;
  return events
    .filter((e) => {
      const t = new Date(e.startDateTime).getTime();
      return t >= start && t <= end;
    })
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
}

function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function timeLabel(event: NormalizedEvent): string {
  if (event.allDay) return "All day";
  return new Date(event.startDateTime).toLocaleTimeString("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function groupByDay(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const groups = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const key = dayKey(event.startDateTime);
    const list = groups.get(key);
    if (list) list.push(event);
    else groups.set(key, [event]);
  }
  return groups;
}

/** Builds an HTML + plaintext digest email body for events in the next `lookaheadDays` days. */
export function buildDigest(allEvents: NormalizedEvent[], lookaheadDays: number, now: Date = new Date()): Digest {
  const upcoming = selectUpcoming(allEvents, lookaheadDays, now);
  const groups = groupByDay(upcoming);

  const subject = upcoming.length
    ? `Bellingham events: ${upcoming.length} coming up in the next ${lookaheadDays} days`
    : `Bellingham events: nothing new in the next ${lookaheadDays} days`;

  const htmlSections: string[] = [];
  const textSections: string[] = [];

  for (const [dayGroupKey, dayEvents] of groups) {
    const heading = dayHeading(dayEvents[0]!.startDateTime);
    void dayGroupKey;

    const htmlItems = dayEvents
      .map((e) => {
        const venue = e.venueName ? ` &middot; ${escapeHtml(e.venueName)}` : "";
        return `<li style="margin-bottom:10px;">
          <a href="${escapeHtml(e.url)}" style="font-weight:600;color:#1a4d8f;text-decoration:none;">${escapeHtml(e.title)}</a>
          <div style="color:#555;font-size:13px;">${timeLabel(e)}${venue} &middot; <span style="color:#888;">${escapeHtml(e.sourceName)}</span></div>
        </li>`;
      })
      .join("\n");

    htmlSections.push(`<h3 style="margin:20px 0 8px;font-size:15px;color:#222;">${heading}</h3><ul style="list-style:none;padding:0;margin:0;">${htmlItems}</ul>`);

    const textItems = dayEvents
      .map((e) => `  - ${e.title} (${timeLabel(e)}${e.venueName ? `, ${e.venueName}` : ""}) — ${e.url}`)
      .join("\n");
    textSections.push(`${heading}\n${textItems}`);
  }

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#222;">
    <h2 style="margin-bottom:4px;">Bellingham Events Digest</h2>
    <p style="color:#666;font-size:13px;margin-top:0;">Next ${lookaheadDays} days &middot; generated ${escapeHtml(now.toISOString())}</p>
    ${upcoming.length ? htmlSections.join("\n") : "<p>No upcoming events found in this window.</p>"}
  </body></html>`;

  const text = `Bellingham Events Digest — next ${lookaheadDays} days\n\n${
    upcoming.length ? textSections.join("\n\n") : "No upcoming events found in this window."
  }`;

  return { subject, html, text, eventCount: upcoming.length };
}
