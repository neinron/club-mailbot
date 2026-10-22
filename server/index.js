import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sendViaGmailSmtp, testGmailSmtpAuth } from "./smtp.js";
import { loadLocalEnv } from "./env.js";
import { createUnsubscribeToken } from "./unsubscribe.js";
import { notionConfig, loadNotionAudience, validateNotionRecipients } from './notion-audience.js';
import { workspaceStore } from './workspace-store.js';
import { deliveryRecorder } from './delivery-audit.js';
import { notionRequest, queryNotionSource } from './notion-cli.js';

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = normalize(join(__dirname, "..", "public"));
const port = Number(process.env.PORT || 5177);
const host = process.env.HOST || "127.0.0.1";
const workspace = workspaceStore(join(__dirname, '..', 'data'));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("\u00e4", "ae")
    .replaceAll("\u00f6", "oe")
    .replaceAll("\u00fc", "ue")
    .replaceAll("\u00df", "ss");
}

function serializeError(error) {
  return {
    message: error.message || "An unknown error occurred.",
    trace: Array.isArray(error.trace) ? error.trace : []
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(payload));
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function resolveTemplateVariable(rawKey, recipient, columns = []) {
  const key = String(rawKey || "").trim();
  if (!key) return "";
  if (recipient?.[key] != null) return recipient[key];

  const normalizedKey = normalizeHeader(key);
  const matchingColumn = (Array.isArray(columns) ? columns : []).find((column) => (
    String(column.label || "").trim() === key
      || normalizeHeader(column.label || "") === normalizedKey
      || String(column.key || "").trim() === key
  ));

  if (matchingColumn && recipient?.[matchingColumn.key] != null) {
    return recipient[matchingColumn.key];
  }

  return "";
}

function renderTemplate(template, recipient, columns = []) {
  const safeRecipient = { ...(recipient || {}) };
  const name = safeRecipient.name || safeRecipient.email.split("@")[0];
  const variables = {
    ...safeRecipient,
    name,
    email: safeRecipient.email,
    firstName: safeRecipient.firstName || (safeRecipient.notionPageId ? "there" : name.split(/\s+/)[0]) || name,
    lastName: safeRecipient.lastName || name.split(/\s+/).slice(1).join(" ")
  };

  return String(template || "").replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey || "").trim();
    if (variables[key] != null) return String(variables[key]);
    const resolved = resolveTemplateVariable(key, safeRecipient, columns);
    return resolved != null ? String(resolved) : "";
  });
}

function resolveButtonTarget(rawTarget, recipient, columns = []) {
  const target = String(rawTarget || "").trim();
  if (!target) return "";
  if (/^https?:\/\//i.test(target) || /^mailto:/i.test(target)) return target;
  return String(resolveTemplateVariable(target, recipient, columns) || "").trim();
}

function renderButtonMarkup(rawLabel, rawTarget, recipient, columns = [], mode = "html", variant = "gradient") {
  const label = renderTemplate(String(rawLabel || "").trim(), recipient, columns);
  const href = renderTemplate(resolveButtonTarget(rawTarget, recipient, columns), recipient, columns);
  if (!href) return mode === "html" ? "" : label;
  if (mode === "text") {
    return `${label}: ${href}`;
  }
  const buttonStyles = {
    gradient: { background: "#c4dfff", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "background-image:radial-gradient(circle at 18% 24%,rgba(75,255,192,.5),transparent 42%),radial-gradient(circle at 82% 72%,rgba(74,152,255,.68),transparent 48%),linear-gradient(120deg,#DEECFF 0%,#c4dfff 42%,#a8ceff 72%,#DEECFF 100%);box-shadow:0 4px 10px rgba(10,45,87,.12);" },
    primary: { background: "#0a2d57", color: "#ffffff", radius: 16, padding: "14px 22px", weight: 700, effects: "box-shadow:0 4px 6px rgba(10,45,87,.18);" },
    secondary: { background: "#ffffff", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "border:1px solid rgba(10,45,87,.1);box-shadow:0 4px 6px rgba(10,45,87,.1);" },
    white: { background: "#ffffff", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(10,45,87,.08);" },
    tertiary: { background: "transparent", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "border:1px solid rgba(10,45,87,.25);" },
    glass: { background: "rgba(255,255,255,.85)", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "border:1px solid rgba(10,45,87,.1);box-shadow:0 4px 6px rgba(10,45,87,.1);" },
  };
  const style = buttonStyles[variant] || buttonStyles.gradient;
  const buttonStyle = `display:inline-block;color:${style.color};text-decoration:none;border-radius:${style.radius}px;padding:${style.padding};font-weight:${style.weight};font-size:16px;line-height:1.2;background-color:${style.background};${style.effects}`;
  const cellStyle = `border-radius:${style.radius}px;background-color:${style.background};`;
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 32px;">
  <tr>
    <td style="${cellStyle}">
      <a href="${href}" data-club-mailbot-button="true" data-club-mailbot-variant="${variant}" style="${buttonStyle}">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

function normalizeLinkTarget(value, recipient, columns = []) {
  const resolved = renderTemplate(resolveButtonTarget(value, recipient, columns), recipient, columns).trim();
  if (!resolved) return "";
  if (/^https?:\/\//i.test(resolved) || /^mailto:/i.test(resolved)) return resolved;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolved)) return `mailto:${resolved}`;
  return resolved;
}

function normalizeAnchorTargets(html, recipient, columns = []) {
  return String(html || "").replace(/href=(["'])([^"']+)\1/gi, (_, quote, rawHref) => {
    const href = normalizeLinkTarget(rawHref, recipient, columns);
    return `href=${quote}${href || rawHref}${quote}`;
  });
}

function enforceAnchorStyles(html) {
  return String(html || "").replace(/<a\b([^>]*?)>/gi, (match, attrs) => {
    if (/data-club-mailbot-button\s*=\s*["']true["']/i.test(attrs)) return match;
    if (/style\s*=/i.test(attrs)) {
      return `<a${attrs.replace(/style=(["'])(.*?)\1/i, (_styleMatch, quote, styleValue) => (
        ` style=${quote}${styleValue};color:#0a2d57;text-decoration:underline;font-weight:800;${quote}`
      ))}>`;
    }
    return `<a${attrs} style="color:#0a2d57;text-decoration:underline;font-weight:800;">`;
  });
}

function enforceTypography(html) {
  const setFont = (markup, tags, family) => markup.replace(new RegExp(`<(${tags})\\b([^>]*?)>`, 'gi'), (_match, tag, attrs) => {
    if (/data-mail-typography=["']true["']/i.test(attrs)) return `<${tag}${attrs}>`;
    if (/data-mail-font-choice=["'](?:Albert Sans|League Spartan)["']/i.test(attrs)) return `<${tag}${attrs}>`;
    const font = `font-family:'${family}',Arial,Helvetica,sans-serif;`;
    if (/style\s*=/i.test(attrs)) {
      return `<${tag}${attrs.replace(/style=(["'])(.*?)\1/i, (_style, quote, value) => `style=${quote}${value.replace(/font-family\s*:[^;]*(;|$)/gi, '')};${font}${quote}`)}>`;
    }
    return `<${tag}${attrs} style="${font}">`;
  });
  const body = setFont(String(html || ''), 'body|table|p|div|li|span|td|ul|ol|a', 'Albert Sans');
  // Inline descendants must not override the heading font through inheritance.
  return body.replace(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag, attrs, content) =>
    setFont(`<${tag}${attrs}>${setFont(content, 'span|a|strong|b|em|i', 'League Spartan')}</${tag}>`, 'h[1-6]', 'League Spartan'));
}

function includeEmailFonts(html) {
  // Direct Google font URLs work without an external stylesheet import.
  // No font files are attached or embedded in the message.
  const fonts = `<style data-mailbot-fonts="true">@font-face{font-family:'Albert Sans';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHq5P_rA.ttf) format('truetype');}
@font-face{font-family:'Albert Sans';font-style:normal;font-weight:600;src:url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHdZT_rA.ttf) format('truetype');}
@font-face{font-family:'Albert Sans';font-style:normal;font-weight:700;src:url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHTJT_rA.ttf) format('truetype');}
@font-face{font-family:'Albert Sans';font-style:normal;font-weight:800;src:url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHK5T_rA.ttf) format('truetype');}
@font-face{font-family:'League Spartan';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvM_oTpBA.ttf) format('truetype');}
@font-face{font-family:'League Spartan';font-style:normal;font-weight:600;src:url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMIIPpBA.ttf) format('truetype');}
@font-face{font-family:'League Spartan';font-style:normal;font-weight:700;src:url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMGYPpBA.ttf) format('truetype');}
@font-face{font-family:'League Spartan';font-style:normal;font-weight:800;src:url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMfoPpBA.ttf) format('truetype');}@font-face {
  font-family: 'Albert Sans';
  font-style: normal;
  font-weight: 100;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHq5L_rA.ttf) format('truetype');
}
@font-face {
  font-family: 'Albert Sans';
  font-style: normal;
  font-weight: 200;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHK5P_rA.ttf) format('truetype');
}
@font-face {
  font-family: 'Albert Sans';
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSH9ZP_rA.ttf) format('truetype');
}
@font-face {
  font-family: 'Albert Sans';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHmZP_rA.ttf) format('truetype');
}
@font-face {
  font-family: 'Albert Sans';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/albertsans/v4/i7dZIFdwYjGaAMFtZd_QA3xXSKZqhr-TenSHApT_rA.ttf) format('truetype');
}
@font-face {
  font-family: 'League Spartan';
  font-style: normal;
  font-weight: 100;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvM_oXpBA.ttf) format('truetype');
}
@font-face {
  font-family: 'League Spartan';
  font-style: normal;
  font-weight: 200;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMfoTpBA.ttf) format('truetype');
}
@font-face {
  font-family: 'League Spartan';
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMoITpBA.ttf) format('truetype');
}
@font-face {
  font-family: 'League Spartan';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMzITpBA.ttf) format('truetype');
}
@font-face {
  font-family: 'League Spartan';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/leaguespartan/v15/kJEnBuEW6A0lliaV_m88ja5Twtx8BWhtkDVmjZvMV4PpBA.ttf) format('truetype');
}
</style>`;
  const clean = String(html).replace(/<style\b[^>]*data-mailbot-fonts=["']true["'][^>]*>[\s\S]*?<\/style>/gi, '');
  return /<\/head>/i.test(clean) ? clean.replace(/<\/head>/i, `${fonts}</head>`) : fonts + clean;
}

function tokenPlaceholder(index) {
  return `%%MAILBOTE_TOKEN_${index}%%`;
}

function renderVariableValue(rawKey, recipient, columns = []) {
  const key = String(rawKey || "").trim();
  const value = ["firstName", "lastName"].includes(key)
    ? renderTemplate(`{{${key}}}`, recipient, columns)
    : resolveTemplateVariable(key, recipient, columns);
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${text}" style="color:#0a2d57;font-weight:800;text-decoration:underline;">${text}</a>`;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return `<a href="mailto:${text}" style="color:#0a6f55;font-weight:800;text-decoration:underline;">${text}</a>`;
  }
  return text;
}

function renderHtmlContent(template, recipient, columns = []) {
  const tokens = [];
  const pushToken = (value) => {
    const index = tokens.push(value) - 1;
    return tokenPlaceholder(index);
  };

  let working = String(template || "");
  working = working.replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^|}]+?)(?:\|\s*([a-z]+))?\s*\}\}/gi, (_, rawLabel, rawTarget, variant) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, columns, "html", variant || "gradient"))
  ));
  working = working.replace(/button\{\{\s*([^,}]+)\s*,\s*([^,}]+?)(?:\s*,\s*([a-z]+))?\s*\}\}/gi, (_, rawLabel, rawTarget, variant) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, columns, "html", variant || "gradient"))
  ));
  working = working.replace(/href=(["'])\{\{\s*([^}]+)\s*\}\}\1/gi, (_match, quote, rawTarget) => {
    const href = normalizeLinkTarget(rawTarget, recipient, columns).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `href=${quote}${href}${quote}`;
  });
  working = working.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => pushToken(renderVariableValue(rawKey, recipient, columns)));
  return working.replace(/%%MAILBOTE_TOKEN_(\d+)%%/g, (_, rawIndex) => tokens[Number(rawIndex)] || "");
}

function constrainLogoDimensions(html) {
  return String(html || "").replace(/<img\b[^>]*>/gi, tag => {
    if (!/LOGO_V6-ICON(?:%2B|\+)TUM_SOCIAL_CLUB-single_line-dark_text\.svg/i.test(tag)) return tag;
    let fixed = tag.replace(/\sheight=["'][^"']*["']/i, '').replace(/<img\b/i, '<img height="26"');
    if (/style=["']/i.test(fixed)) fixed = fixed.replace(/style=(["'])(.*?)\1/i, (_all, quote, css) => `style=${quote}${css.replace(/(?:^|;)\s*(?:max-)?height\s*:[^;]*/gi, '')};height:26px;max-height:26px;${quote}`);
    else fixed = fixed.replace(/<img\b/i, '<img style="height:26px;max-height:26px;"');
    return fixed;
  });
}

function renderHtmlMessage(designTemplate, contentTemplate, recipient, columns = []) {
  const contentHtml = enforceTypography(
    enforceAnchorStyles(
      normalizeAnchorTargets(
        renderHtmlContent(contentTemplate, recipient, columns),
        recipient,
        columns
      )
    )
  );
  let result = renderTemplate(String(designTemplate || "").replaceAll("{{content}}", contentHtml), recipient, columns);
  const accent = String(designTemplate).match(/data-mail-accent="(#[0-9a-f]{6})"/i)?.[1];
  const font = String(designTemplate).match(/data-mail-font="(serif|sans)"/)?.[1];
  if (accent) result = result.replaceAll("#0a2d57", accent);
  if (font === "serif") result = result.replaceAll("'Albert Sans',Arial,Helvetica,sans-serif", "Georgia,serif").replaceAll("'League Spartan',Arial,Helvetica,sans-serif", "Georgia,serif");
  return includeEmailFonts(constrainLogoDimensions(result));
}

function normalizeHtmlBody(value) {
  const html = String(value || "").trim();
  return html ? html : "";
}

function plainTextFromHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeRecipients(recipients) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => {
      const clean = Object.fromEntries(
        Object.entries(recipient || {}).map(([key, value]) => [key, String(value || "").trim()])
      );
      clean.email = String(clean.email || "").trim().toLowerCase();
      clean.name = String(clean.name || "").trim();
      if (!clean.name && clean.email) {
        clean.name = clean.email.split("@")[0];
      }
      return clean;
    });
}

function sanitizeRecipientColumns(columns) {
  return (Array.isArray(columns) ? columns : []).map((column) => ({
    key: String(column?.key || "").trim(),
    label: String(column?.label || "").trim(),
    role: ["text", "to", "cc", "bcc", "replyTo"].includes(column?.role) ? column.role : "text"
  })).filter((column) => column.key);
}

function collectMessageAddresses(recipient, columns) {
  const normalizedColumns = sanitizeRecipientColumns(columns);
  const buckets = { to: [], cc: [], bcc: [], replyTo: [] };
  const seenByRole = {
    to: new Set(),
    cc: new Set(),
    bcc: new Set(),
    replyTo: new Set()
  };

  for (const column of normalizedColumns) {
    if (!["to", "cc", "bcc", "replyTo"].includes(column.role)) continue;
    const email = String(recipient?.[column.key] || "").trim().toLowerCase();
    if (!emailPattern.test(email) || seenByRole[column.role].has(email)) continue;
    seenByRole[column.role].add(email);
    buckets[column.role].push(email);
  }

  if (!buckets.to.length && emailPattern.test(String(recipient?.email || "").trim().toLowerCase())) {
    buckets.to.push(String(recipient.email).trim().toLowerCase());
  }

  return buckets;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleSend(req, res) {
  let ownsSendLock = false;
  try {
    const payload = await readJson(req);
    const recipients = sanitizeRecipients(payload.recipients);
    const recipientColumns = sanitizeRecipientColumns(payload.recipientColumns);
    const delayMs = Math.min(Math.max(Number(payload.delayMs) || 1200, 1200), 10000);
    const authSecret = String(payload.authSecret || payload.appPassword || "");
    const authMode = payload.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    const smtpSecurity = payload.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";

    if (!payload.accountEmail || !authSecret) {
      return sendJson(res, 400, { error: "Gmail address and app password/OAuth token are required.", trace: [] });
    }
    if (!String(payload.subject || "").trim()) {
      return sendJson(res, 400, { error: "Subject is required." });
    }
    if (!String(payload.body || "").trim() && !normalizeHtmlBody(payload.htmlBody)) {
      return sendJson(res, 400, { error: "Email content is required." });
    }
    if (!recipients.length) {
      return sendJson(res, 400, { error: "No valid recipients found." });
    }

    const testEmail = String(payload.testEmail || "").trim();
    if (payload.testOnly && !emailPattern.test(testEmail)) {
      return sendJson(res, 400, { error: "A valid test address is required." });
    }
    if (!String(payload.htmlBody || "").includes("{{content}}")) {
      return sendJson(res, 400, { error: "The design template must include {{content}}." });
    }
    const previewIndex = Math.max(0, Math.min(recipients.length - 1, Number(payload.previewIndex) || 0));
    const selectedRecipients = payload.testOnly ? [recipients[Math.floor(previewIndex)]] : recipients;
    if (!payload.testOnly && (payload.audienceSource || recipients.some(recipient => recipient.notionPageId))) {
      await validateNotionRecipients(recipients, payload.audienceSource);
    }
    const usesUnsubscribeLink = /\{\{\s*unsubscribeUrl\s*\}\}/i.test(`${payload.subject || ""}\n${payload.body || ""}\n${payload.htmlBody || ""}`);
    const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const unsubscribeDataSource = process.env.NOTION_DATA_SOURCE_ID || process.env.NEWSLETTER_NOTION_DATA_SOURCE_ID;
    const unsubscribeEmailProperty = process.env.NOTION_EMAIL_PROPERTY || process.env.NEWSLETTER_NOTION_EMAIL_PROPERTY || "Email";
    const unsubscribeOptInProperty = process.env.NOTION_OPT_IN_PROPERTY || process.env.NEWSLETTER_NOTION_SUBSCRIBED_PROPERTY || "Subscribed";
    if (usesUnsubscribeLink) {
      if (!publicBaseUrl || !(process.env.NEWSLETTER_TOKEN_SECRET || process.env.MAILBOT_UNSUBSCRIBE_SECRET) || !unsubscribeDataSource) {
        return sendJson(res, 400, { error: "Personalized unsubscribe links need PUBLIC_BASE_URL and the Notion unsubscribe settings in .env." });
      }
      if (new URL(publicBaseUrl).protocol !== "https:") {
        return sendJson(res, 400, { error: "PUBLIC_BASE_URL must use HTTPS for unsubscribe links." });
      }
      const pageIdKey = recipientColumns.find((column) => /notion page id/i.test(String(column.label || "")))?.key || "notionPageId";
      if (recipients.some((recipient) => !recipient[pageIdKey])) {
        return sendJson(res, 400, { error: "Every recipient needs a Notion Page ID to create an unsubscribe link." });
      }
    }
    if (!payload.testOnly) {
      if (handleSend.active) return sendJson(res, 409, {error:'A campaign is already running. Wait for it to finish before starting another.'});
      handleSend.active = true; ownsSendLock = true;
    }
    const results = [];
    if (!payload.testOnly) handleSend.progress = {state:'running',phase:'Preparing contacts',total:selectedRecipients.length,processed:0,sent:0,failed:0,skipped:0,updatedAt:new Date().toISOString()};
    const recordResult = result => {
      results.push(result);
      if (!payload.testOnly) Object.assign(handleSend.progress, {
        processed:results.length,sent:results.filter(r=>r.ok&&!r.skipped).length,
        failed:results.filter(r=>!r.ok).length,skipped:results.filter(r=>r.skipped).length,
        phase:'Preparing next email',updatedAt:new Date().toISOString()
      });
    };
    const auditContacts = payload.testOnly ? null : await deliveryAudit.prepare(
      selectedRecipients.flatMap(recipient => {
        const addresses = collectMessageAddresses(recipient, recipientColumns);
        return [...new Set([...addresses.to, ...addresses.cc, ...addresses.bcc])].map(email => ({
          email, name: email.toLowerCase() === recipient.email.toLowerCase() ? recipient.name : email,
          ...(email.toLowerCase() === recipient.email.toLowerCase() && recipient.notionPageId ? { notionPageId: recipient.notionPageId } : {})
        }));
      })
    );

    for (const [index, recipient] of selectedRecipients.entries()) {
      let auditEvent;
      try {
        let mailRecipient = recipient;
        if (usesUnsubscribeLink) {
          const pageIdKey = recipientColumns.find((column) => /notion page id/i.test(String(column.label || "")))?.key || "notionPageId";
          const unsubscribeUrl = payload.testOnly
            ? `${publicBaseUrl}/unsubscribe/test-preview`
            : new URL(`${publicBaseUrl}/unsubscribe/${createUnsubscribeToken({ pageId: recipient[pageIdKey], email: recipient.email, dataSourceId: unsubscribeDataSource, emailProperty: unsubscribeEmailProperty, optInProperty: unsubscribeOptInProperty })}`).toString();
          mailRecipient = { ...recipient, unsubscribeUrl };
        }
        const addresses = payload.testOnly
          ? { to: [testEmail], cc: [], bcc: [], replyTo: [] }
          : collectMessageAddresses(mailRecipient, recipientColumns);
        if (!addresses.to.length) {
          throw new Error("No recipient address with the “To” role was found.");
        }
        const htmlBody = renderHtmlMessage(
          normalizeHtmlBody(payload.htmlBody),
          String(payload.body || "").trim(),
          mailRecipient,
          recipientColumns
        );
        const plainBody = plainTextFromHtml(htmlBody);
        const subject = renderTemplate(payload.subject, mailRecipient, recipientColumns);
        if (!payload.testOnly) {
          const metadata = {
          contacts: [...new Set([...addresses.to, ...addresses.cc, ...addresses.bcc])].map(email => auditContacts.get(email.toLowerCase())),
          campaign: String(payload.draftName || payload.subject).slice(0, 500), subject,
          purpose: payload.audienceSource?.purpose || 'Manual list', sender: String(payload.accountEmail)
          };
          const previous = await deliveryAudit.previousAttempt(metadata);
          if (previous) {
            recordResult({email:recipient.email,name:recipient.name,ok:previous === 'Sent',skipped:true,...(previous === 'Unknown' ? {error:'Previous attempt has an unknown result. Check delivery before retrying.'} : {})});
            continue;
          }
          auditEvent = await deliveryAudit.begin(metadata);
        }

        if (!payload.testOnly) handleSend.progress.phase = 'Sending email';
        const sendResult = await sendViaGmailSmtp({
          accountEmail: payload.accountEmail,
          authSecret,
          authMode,
          smtpSecurity,
          fromName: payload.fromName,
          to: addresses.to,
          cc: addresses.cc,
          bcc: addresses.bcc,
          replyTo: addresses.replyTo,
          subject,
          body: plainBody,
          htmlBody
        });
        let auditWarning;
        if (auditEvent) {
          try { handleSend.progress.phase = 'Saving to Notion'; auditWarning = await deliveryAudit.finish(auditEvent, 'Sent'); }
          catch { auditWarning = 'SMTP accepted the email, but saving its audit result failed. Do not resend; check the local delivery journal.'; }
        }
        recordResult({ email: payload.testOnly ? testEmail : recipient.email, name: recipient.name, ok: true, trace: sendResult.trace, ...(auditWarning ? { auditWarning } : {}) });
      } catch (error) {
        const serialized = serializeError(error);
        let auditWarning;
        if (auditEvent) {
          try { auditWarning = await deliveryAudit.finish(auditEvent, 'Failed'); }
          catch { auditWarning = 'The failed attempt could not be synchronized. Check the local delivery journal.'; }
        }
        recordResult({ email: recipient.email, name: recipient.name, ok: false, error: serialized.message, trace: serialized.trace, ...(auditWarning ? { auditWarning } : {}) });
      }

      if (index < selectedRecipients.length - 1 && delayMs > 0) {
        await delay(delayMs);
      }
    }

    sendJson(res, 200, { sent: results.filter((result) => result.ok && !result.skipped).length, skipped: results.filter(result=>result.skipped).length, total: results.length, results });
  } catch (error) {
    const serialized = serializeError(error);
    sendJson(res, 500, { error: serialized.message, trace: serialized.trace });
  } finally {
    if (ownsSendLock) {
      handleSend.active = false;
      if (handleSend.progress) { handleSend.progress.state = handleSend.progress.processed === handleSend.progress.total ? 'finished' : 'interrupted'; handleSend.progress.updatedAt = new Date().toISOString(); }
    }
  }
}

async function handleTestAuth(req, res) {
  try {
    const payload = await readJson(req);
    const authSecret = String(payload.authSecret || payload.appPassword || "");
    const authMode = payload.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    const smtpSecurity = payload.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";

    if (!payload.accountEmail || !authSecret) {
      return sendJson(res, 400, { error: "Gmail address and app password/OAuth token are required.", trace: [] });
    }

    const result = await testGmailSmtpAuth({
      accountEmail: payload.accountEmail,
      authSecret,
      authMode,
      smtpSecurity
    });

    sendJson(res, 200, { ok: true, trace: result.trace });
  } catch (error) {
    const serialized = serializeError(error);
    sendJson(res, 400, { ok: false, error: serialized.message, trace: serialized.trace });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(join(root, requested));

  if (!safePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(safePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(safePath)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

await loadLocalEnv();
const deliveryAudit = deliveryRecorder({ directory: join(__dirname, '..', 'data', 'deliveries'), sourceId: notionConfig().sourceId, request: notionRequest, query: queryNotionSource });
// Recovery only synchronizes audit metadata; it never sends or retries email.
deliveryAudit.retry().catch(() => console.error('Delivery history recovery failed. Local records are retained.'));
const auditRetryTimer = setInterval(() => deliveryAudit.retry().catch(() => {}), 60_000);
auditRetryTimer.unref();

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host || '');
    const origin = req.headers.origin;
    if (!localHost || (origin && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      return sendJson(res, 403, { error: 'Use Mailbot from its local browser tab.' });
    }
  }
  if (req.method === 'GET' && req.url === '/api/send/status') return sendJson(res, 200, handleSend.progress || {state:'idle'});
  if (req.method === 'GET' && req.url === '/api/notion/status') return sendJson(res, 200, notionConfig());
  if (req.method === 'GET' && req.url === '/api/workspace') {
    workspace.read().then(data => sendJson(res, 200, data)).catch(() => sendJson(res, 500, { error: 'Could not read saved workspace.' }));
    return;
  }
  if (req.method === 'PUT' && /^\/api\/workspace\/(drafts|lists)$/.test(req.url || '')) {
    readJson(req, 10_000_000).then(data => workspace.save(req.url.split('/').at(-1), data)).then(() => sendJson(res, 200, { saved: true })).catch(() => sendJson(res, 500, { error: 'Could not save workspace to disk.' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/notion/load') {
    loadNotionAudience().then(data => sendJson(res, 200, data)).catch(() => sendJson(res, 503, { error: 'Could not load the configured Notion database. Check the local API key, database access, and your connection, then retry.' }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/send") {
    handleSend(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/test-auth") {
    handleTestAuth(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}).listen(port, host, () => {
  console.log(`Club Mailbot is running at http://${host}:${port}`);
});
