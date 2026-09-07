import { DEDUPE_TITLE_SIMILARITY_THRESHOLD } from "./config.js";
import type { NormalizedEvent } from "./types.js";

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

/** Sorensen-Dice coefficient over character bigrams, 0..1. Cheap and dependency-free. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return na === nb ? 1 : 0;
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function isDuplicate(a: Omit<NormalizedEvent, "id">, b: Omit<NormalizedEvent, "id">): boolean {
  if (normalizeUrl(a.url) === normalizeUrl(b.url)) return true;
  if (!sameDay(a.startDateTime, b.startDateTime)) return false;
  return titleSimilarity(a.title, b.title) >= DEDUPE_TITLE_SIMILARITY_THRESHOLD;
}

async function hashId(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Groups near-duplicate listings (same canonical link, or same-day + similar title)
 * into single events, keeping the earliest-sourced listing as canonical and recording
 * the rest under `mergedFrom` for provenance.
 */
export async function dedupeEvents(events: Omit<NormalizedEvent, "id">[]): Promise<NormalizedEvent[]> {
  const groups: Omit<NormalizedEvent, "id">[][] = [];

  for (const event of events) {
    const group = groups.find((g) => g.some((existing) => isDuplicate(existing, event)));
    if (group) group.push(event);
    else groups.push([event]);
  }

  const results: NormalizedEvent[] = [];
  for (const group of groups) {
    const canonical = group.reduce((best, current) =>
      current.startDateTime < best.startDateTime ? current : best,
    );
    const mergedFrom = group
      .filter((e) => e !== canonical)
      .map((e) => ({ sourceName: e.sourceName, url: e.url }));

    const id = await hashId(`${normalizeUrl(canonical.url)}|${canonical.startDateTime}`);
    results.push({
      ...canonical,
      id,
      mergedFrom: mergedFrom.length ? mergedFrom : undefined,
    });
  }

  return results.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
}
