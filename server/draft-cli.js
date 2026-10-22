import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const draftDirectory = resolve("drafts");
const listDirectory = resolve("campaigns");

function safeFileName(value, extension = ".json") {
  const base = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!base) throw new Error("A non-empty name is required.");
  return `${base.replace(/\.(json|csv)$/i, "")}${extension}`;
}

export function checkDraft(draft, contacts = draft?.recipients || []) {
  const errors = [];
  const warnings = [];
  if (!draft || typeof draft !== "object") return { errors: ["Draft must be a JSON object."], warnings };
  if (!String(draft.subject || "").trim()) errors.push("Subject is empty.");
  const body = String(draft.htmlBody || draft.body || "").trim();
  if (!body) errors.push("Message body is empty.");
  if (!Array.isArray(contacts) || contacts.length === 0) warnings.push("No recipient rows are attached to this draft.");
  const template = `${draft.subject || ""}\n${draft.body || ""}\n${draft.htmlBody || ""}`
    .replace(/\{\{\s*button\s*:[^}]+\}\}/gi, "")
    .replace(/button\{\{[^}]+\}\}/gi, "");
  const variables = [...template.matchAll(/\{\{\s*([^}:]+?)(?:\s*\|[^}]*)?\s*\}\}/g)].map((match) => match[1].trim());
  const available = new Set(["name", "firstName", "lastName", "email", "unsubscribeUrl", ...(draft.recipientColumns || []).flatMap((column) => [column.key, column.label])]);
  for (const variable of new Set(variables)) {
    if (variable.toLowerCase() === "content") continue;
    if (!available.has(variable) && !available.has(variable.toLowerCase())) warnings.push(`Template variable {{${variable}}} is not a known recipient field.`);
  }
  if (draft.htmlBody && !/<html\b|<body\b|<table\b/i.test(draft.htmlBody)) warnings.push("HTML body looks like a fragment; confirm the app's design wrapper is applied.");
  return { errors, warnings, recipientCount: Array.isArray(contacts) ? contacts.length : 0, variables: [...new Set(variables)] };
}

export function renderDraftPreview(draft, contact = {}) {
  const name = contact.name || contact.firstName || "Sample Recipient";
  const values = { ...contact, name, firstName: contact.firstName || name.split(/\s+/)[0], email: contact.email || "recipient@example.org" };
  const render = (input) => String(input || "").replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, key) => String(values[key.trim()] ?? `[${key.trim()}]`));
  const subject = render(draft.subject);
  const buttonMarkup = (label, target, variant = "gradient") => {
    const resolvedTarget = values[String(target || "").trim()] ?? String(target || "").trim();
    const safeTarget = String(resolvedTarget).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const safeLabel = render(label).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const background = variant === "primary" ? "#0a2d57" : "#c4dfff";
    const color = variant === "primary" ? "#ffffff" : "#0a2d57";
    return `<a href="${safeTarget}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${background};color:${color};font-weight:bold;text-decoration:none">${safeLabel}</a>`;
  };
  const bodySource = String(draft.body || "")
    .replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^|}]+?)(?:\|\s*([a-z]+))?\s*\}\}/gi, (_m, label, target, variant) => buttonMarkup(label, target, variant))
    .replace(/button\{\{\s*([^,}]+),\s*([^,}]+?)(?:,\s*([a-z]+))?\s*\}\}/gi, (_m, label, target, variant) => buttonMarkup(label, target, variant));
  const body = render(bodySource);
  const shell = String(draft.htmlBody || "").trim();
  const html = shell.includes("{{content}}")
    ? render(shell.replaceAll("{{content}}", body))
    : `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#123"><main style="max-width:680px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><h1 style="font-size:14px;color:#456">${subject}</h1>${body}</main></body></html>`;
  return { subject, html };
}

export async function saveDraft(name, draft, { force = false } = {}) {
  await mkdir(draftDirectory, { recursive: true });
  const path = join(draftDirectory, safeFileName(name));
  const payload = { ...draft, draftName: draft.draftName || name, savedAt: new Date().toISOString() };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: force ? "w" : "wx" });
  return path;
}

export async function readDraft(name) {
  return JSON.parse(await readFile(join(draftDirectory, safeFileName(name)), "utf8"));
}

export async function listDrafts() {
  await mkdir(draftDirectory, { recursive: true });
  return (await readdir(draftDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
}

export async function saveList(name, csv, { force = false } = {}) {
  await mkdir(listDirectory, { recursive: true });
  const path = join(listDirectory, safeFileName(name, ".csv"));
  await writeFile(path, csv, { encoding: "utf8", flag: force ? "w" : "wx" });
  return path;
}

export async function listSavedLists() {
  await mkdir(listDirectory, { recursive: true });
  return (await readdir(listDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".csv")).map((entry) => basename(entry.name));
}
