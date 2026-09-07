import type { Digest } from "./digest.js";
import type { Env } from "./types.js";

/**
 * Sends the digest via Resend (https://resend.com) — a simple HTTPS API that
 * works from Workers without needing raw SMTP. Requires RESEND_API_KEY secret.
 * Swap this for any other transactional email API if you prefer.
 */
export async function sendDigestEmail(env: Env, digest: Digest): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.DIGEST_EMAIL_FROM,
      to: env.DIGEST_EMAIL_TO.split(",").map((s) => s.trim()).filter(Boolean),
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend HTTP ${res.status}: ${body.slice(0, 500)}` };
  }
  return { ok: true };
}
