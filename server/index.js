import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sendViaGmailSmtp, testGmailSmtpAuth } from "./smtp.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = normalize(join(__dirname, "..", "public"));
const port = Number(process.env.PORT || 5177);
const host = process.env.HOST || "127.0.0.1";
const maxRecipients = 250;

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
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function serializeError(error) {
  return {
    message: error.message || "Unbekannter Fehler.",
    trace: Array.isArray(error.trace) ? error.trace : []
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
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
    firstName: safeRecipient.firstName || name.split(/\s+/)[0] || name,
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
  return String(html || "")
    .replace(/<(p|div|li|span|td|ul|ol)\b([^>]*?)>/gi, (match, tag, attrs) => {
      if (/style\s*=/i.test(attrs)) {
        return `<${tag}${attrs.replace(/style=(["'])(.*?)\1/i, (_styleMatch, quote, styleValue) => (
          ` style=${quote}${styleValue};font-family:'Albert Sans',Arial,Helvetica,sans-serif;${quote}`
        ))}>`;
      }
      return `<${tag}${attrs} style="font-family:'Albert Sans',Arial,Helvetica,sans-serif;">`;
    })
    .replace(/<(h1|h2|h3)\b([^>]*?)>/gi, (match, tag, attrs) => {
      if (/style\s*=/i.test(attrs)) {
        return `<${tag}${attrs.replace(/style=(["'])(.*?)\1/i, (_styleMatch, quote, styleValue) => (
          ` style=${quote}${styleValue};font-family:'League Spartan',Arial,Helvetica,sans-serif;${quote}`
        ))}>`;
      }
      return `<${tag}${attrs} style="font-family:'League Spartan',Arial,Helvetica,sans-serif;">`;
    });
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
  working = working.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => pushToken(renderVariableValue(rawKey, recipient, columns)));
  return working.replace(/%%MAILBOTE_TOKEN_(\d+)%%/g, (_, rawIndex) => tokens[Number(rawIndex)] || "");
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
  return result;
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
  try {
    const payload = await readJson(req);
    const recipients = sanitizeRecipients(payload.recipients);
    const recipientColumns = sanitizeRecipientColumns(payload.recipientColumns);
    const delayMs = Math.min(Math.max(Number(payload.delayMs || 1200), 0), 10000);
    const authSecret = String(payload.authSecret || payload.appPassword || "");
    const authMode = payload.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    const smtpSecurity = payload.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";

    if (!payload.accountEmail || !authSecret) {
      return sendJson(res, 400, { error: "Gmail-Adresse und App-Passwort/OAuth-Token fehlen.", trace: [] });
    }
    if (!String(payload.subject || "").trim()) {
      return sendJson(res, 400, { error: "Betreff fehlt." });
    }
    if (!String(payload.body || "").trim() && !normalizeHtmlBody(payload.htmlBody)) {
      return sendJson(res, 400, { error: "Nachricht fehlt." });
    }
    if (!recipients.length) {
      return sendJson(res, 400, { error: "Keine gültigen Empfänger gefunden." });
    }
    if (recipients.length > maxRecipients) {
      return sendJson(res, 400, { error: `Maximal ${maxRecipients} Empfänger pro Lauf.` });
    }

    const testEmail = String(payload.testEmail || "").trim();
    if (payload.testOnly && !emailPattern.test(testEmail)) {
      return sendJson(res, 400, { error: "Eine gültige Testadresse fehlt." });
    }
    if (!String(payload.htmlBody || "").includes("{{content}}")) {
      return sendJson(res, 400, { error: "Die Design-Vorlage muss {{content}} enthalten." });
    }
    const previewIndex = Math.max(0, Math.min(recipients.length - 1, Number(payload.previewIndex) || 0));
    const selectedRecipients = payload.testOnly ? [recipients[Math.floor(previewIndex)]] : recipients;
    const results = [];

    for (const [index, recipient] of selectedRecipients.entries()) {
      try {
        const addresses = payload.testOnly
          ? { to: [testEmail], cc: [], bcc: [], replyTo: [] }
          : collectMessageAddresses(recipient, recipientColumns);
        if (!addresses.to.length) {
          throw new Error("Keine Empfängeradresse mit Rolle 'An' gefunden.");
        }
        const htmlBody = renderHtmlMessage(
          normalizeHtmlBody(payload.htmlBody),
          String(payload.body || "").trim(),
          recipient,
          recipientColumns
        );
        const plainBody = plainTextFromHtml(htmlBody);

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
          subject: renderTemplate(payload.subject, recipient, recipientColumns),
          body: plainBody,
          htmlBody
        });
        results.push({ email: payload.testOnly ? testEmail : recipient.email, name: recipient.name, ok: true, trace: sendResult.trace });
      } catch (error) {
        const serialized = serializeError(error);
        results.push({ email: recipient.email, name: recipient.name, ok: false, error: serialized.message, trace: serialized.trace });
      }

      if (index < selectedRecipients.length - 1 && delayMs > 0) {
        await delay(delayMs);
      }
    }

    sendJson(res, 200, { sent: results.filter((result) => result.ok).length, total: results.length, results });
  } catch (error) {
    const serialized = serializeError(error);
    sendJson(res, 500, { error: serialized.message, trace: serialized.trace });
  }
}

async function handleTestAuth(req, res) {
  try {
    const payload = await readJson(req);
    const authSecret = String(payload.authSecret || payload.appPassword || "");
    const authMode = payload.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    const smtpSecurity = payload.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";

    if (!payload.accountEmail || !authSecret) {
      return sendJson(res, 400, { error: "Gmail-Adresse und App-Passwort/OAuth-Token fehlen.", trace: [] });
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
    res.writeHead(200, { "content-type": mimeTypes[extname(safePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer((req, res) => {
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
  console.log(`Club-Mailbot läuft auf http://${host}:${port}`);
});
