import { aggregateEvents } from "../src/aggregate.js";
import { buildLocalEnv } from "./local-env.js";

const env = buildLocalEnv();
const snapshot = await aggregateEvents(env);

console.log(`Generated at ${snapshot.generatedAt}`);
console.log(`Total events after dedupe: ${snapshot.eventCount}\n`);
console.log("Per-source results:");
for (const r of snapshot.sourceResults) {
  console.log(`  ${r.sourceName}: ${r.count} raw${r.error ? ` (error: ${r.error})` : ""}`);
}
console.log("\nFirst 10 upcoming events:");
for (const e of snapshot.events.slice(0, 10)) {
  console.log(`  ${e.startDateTime}  ${e.title} — ${e.venueName ?? "?"} [${e.sourceName}]`);
}
