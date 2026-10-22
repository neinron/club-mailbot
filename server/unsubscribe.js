import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function secretValue() {
  const secret = process.env.NEWSLETTER_TOKEN_SECRET || process.env.MAILBOT_UNSUBSCRIBE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("NEWSLETTER_TOKEN_SECRET must contain at least 32 bytes.");
  return secret;
}

export function createUnsubscribeToken({ pageId, email, dataSourceId, emailProperty, optInProperty }) {
  const emailHash = createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ pageId, emailHash, dataSourceId, emailProperty, optInProperty })).toString("base64url");
  const signature = createHmac("sha256", secretValue()).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyUnsubscribeToken(token) {
  const [payload, supplied, ...rest] = String(token || "").split(".");
  if (!payload || !supplied || rest.length) throw new Error("Invalid unsubscribe link.");
  const expected = createHmac("sha256", secretValue()).update(payload).digest();
  let actual;
  try { actual = Buffer.from(supplied, "base64url"); } catch { throw new Error("Invalid unsubscribe link."); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid unsubscribe link.");
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new Error("Invalid unsubscribe link."); }
  if (!data.pageId || typeof data.pageId !== "string" || typeof data.emailHash !== "string") throw new Error("Invalid unsubscribe link.");
  for (const key of ["dataSourceId", "emailProperty", "optInProperty"]) {
    if (data[key] != null && (typeof data[key] !== "string" || data[key].length > 200)) throw new Error("Invalid unsubscribe link.");
  }
  return data;
}
