import { aggregateEvents } from "../src/aggregate.js";
import { buildDigest } from "../src/digest.js";
import { sendDigestEmail } from "../src/email.js";
import { buildLocalEnv } from "./local-env.js";

const env = buildLocalEnv();
const snapshot = await aggregateEvents(env);
const lookaheadDays = Number.parseInt(env.DIGEST_LOOKAHEAD_DAYS, 10) || 14;
const digest = buildDigest(snapshot.events, lookaheadDays);

console.log(`Subject: ${digest.subject}\n`);
console.log(digest.text);

if (process.argv.includes("--send")) {
  const result = await sendDigestEmail(env, digest);
  console.log(result.ok ? "\nEmail sent." : `\nEmail failed: ${result.error}`);
} else {
  console.log("\n(dry run — pass --send to actually email via Resend)");
}
