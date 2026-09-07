import { CITY } from "./config.js";
import type { NormalizedEvent, SourceType } from "./types.js";

export interface RawEventInput {
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime?: string;
  allDay?: boolean;
  venueName?: string;
  address?: string;
  city?: string;
  url: string;
  imageUrl?: string;
  price?: string;
  tags?: string[];
  sourceName: string;
  sourceType: SourceType;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Strips a trailing UTC offset ("Z" or "+00:00") from a naive local timestamp string. */
export function isIsoWithOffset(value: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

/**
 * Fills in a normalized event's identity fields. This does NOT assign `id` —
 * that's derived later, once dedupe has decided the canonical key (see dedupe.ts).
 */
export function toNormalizedEvent(raw: RawEventInput): Omit<NormalizedEvent, "id"> {
  return {
    title: collapseWhitespace(raw.title),
    description: raw.description ? collapseWhitespace(raw.description).slice(0, 2000) : undefined,
    startDateTime: raw.startDateTime,
    endDateTime: raw.endDateTime,
    allDay: raw.allDay,
    venueName: raw.venueName ? collapseWhitespace(raw.venueName) : undefined,
    address: raw.address ? collapseWhitespace(raw.address) : undefined,
    city: raw.city ? collapseWhitespace(raw.city) : CITY,
    url: raw.url,
    imageUrl: raw.imageUrl,
    price: raw.price ? collapseWhitespace(raw.price) : undefined,
    tags: raw.tags?.length ? raw.tags : undefined,
    sourceName: raw.sourceName,
    sourceType: raw.sourceType,
  };
}
