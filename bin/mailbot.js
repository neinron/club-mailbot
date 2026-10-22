#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseDelimited, prepareRecipients, toImportCsv } from "../server/recipient-cli.js";
import { checkDraft, listDrafts, listSavedLists, readDraft, renderDraftPreview, saveDraft, saveList } from "../server/draft-cli.js";
import { notionPropertyValue, notionRequest, queryNotionSource, updateNotionCheckbox, isNotionSubscribed } from "../server/notion-cli.js";
import { loadLocalEnv } from "../server/env.js";

const help = "Mailbot CLI — prepare campaign drafts, recipient lists, Notion sync and unsubscribes.\n" +
  "Sending remains available only in the web app.\n\n" +
  "  mailbot draft create --name <name> --subject <text> --body-file <file> [--html-file <file>] [--recipients <csv>] [--design <json>]\n" +
  "  mailbot draft import --input <mailbot-draft.json> [--force]\n" +
  "  mailbot draft update --name <name> [--subject <text>] [--body-file <file>] [--html-file <file>] [--recipients <csv>] [--design <json>]\n" +
  "  mailbot draft list | check --name <name> | preview --name <name> [--output <html>]\n" +
  "  mailbot recipients prepare --input <csv> [--exclude <csv> ...] [--output <csv>]\n" +
  "  mailbot recipients check --input <csv>\n" +
  "  mailbot lists save --name <name> --input <csv> [--force] | list\n" +
  "  mailbot notion inspect --source <data-source-id>\n" +
  "  mailbot notion export --source <id> --email <property> --consent <checkbox> [--name <property>] [--exclude-property <property>] [--output <csv>]\n" +
  "  mailbot notion unsubscribe --source <id> --email <property> --consent <checkbox> --address <email> [--apply]\n" +
  "  mailbot unsubscribe link --email <email> --page-id <id> --base-url <https://host>\n" +
  "Secrets are read from environment variables, never command-line flags. No CLI command sends email.\n";

function optionsFrom(args) {
  const result = { excludes: [] };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === "--help" || key === "-h") { result.help = true; continue; }
    if (key === "--force" || key === "--apply") { result[key.slice(2)] = true; continue; }
    if (!key.startsWith("--")) throw new Error("Unexpected argument: " + key);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(key + " requires a value.");
    if (key === "--exclude") result.excludes.push(value);
    else result[key.slice(2)] = value;
  }
  return result;
}
function requireFields(o, fields) { for (const field of fields) if (!o[field]) throw new Error("--" + field + " is required."); }
function headerKey(label) {
  const normalized = String(label || "").trim().toLowerCase().replace(/[^a-z0-9]+(.)/g, (_m, letter) => letter.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
  if (["email", "eMail"].includes(normalized)) return "email";
  if (["name", "fullName"].includes(normalized)) return "name";
  return normalized || "property";
}
async function getContacts(file) {
  const input = await readFile(resolve(file), "utf8");
  const recipients = prepareRecipients(input).recipients;
  const rows = parseDelimited(input);
  const header = rows[0]?.some((cell) => /^(e-?mail|email address|name|full name|notion page id)$/i.test(cell.trim())) ? rows.shift() : null;
  if (!header) return recipients;
  const emailIndex = header.findIndex((cell) => /^(e-?mail|email address)$/i.test(cell.trim()));
  const custom = new Map();
  for (const row of rows) {
    const email = String(row[emailIndex] || "").trim().toLowerCase();
    const extras = {};
    header.forEach((label, index) => {
      const key = headerKey(label);
      if (!['email', 'name'].includes(key)) extras[key] = row[index] || "";
    });
    custom.set(email, extras);
  }
  return recipients.map((contact) => ({ ...contact, ...(custom.get(contact.email) || {}) }));
}
function columnsForRecipients(recipients) {
  return recipients.length ? [
    { key: "name", label: "Name", role: "text" },
    { key: "email", label: "Email", role: "to" },
    ...(recipients.some((recipient) => recipient.notionPageId) ? [
      { key: "notionPageId", label: "Notion Page ID", role: "text" },
      { key: "unsubscribeUrl", label: "Unsubscribe URL", role: "text" }
    ] : [])
  ] : [];
}

function contactFromPage(page, o) {
  const properties = page.properties || {};
  const email = String(notionPropertyValue(properties[o.email]) || "").trim().toLowerCase();
  const name = o.name ? notionPropertyValue(properties[o.name]) : "";
  const consent = isNotionSubscribed(page, o.consent);
  const exclusion = o["exclude-property"] ? notionPropertyValue(properties[o["exclude-property"]]) : null;
  const excluded = exclusion === true || String(exclusion || "").toLowerCase() === String(o["exclude-value"] || "Member").toLowerCase();
  return { email, name: String(name || email.split("@")[0]), consent, excluded, pageId: page.id };
}

async function notionExport(o, { defaultOutput } = {}) {
  requireFields(o, ["source", "email", "consent"]);
  const pages = await queryNotionSource(o.source);
  const seen = new Set(), contacts = [];
  let withoutConsent = 0, excluded = 0;
  for (const page of pages) {
    const c = contactFromPage(page, o);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) continue;
    if (!c.consent) { withoutConsent++; continue; }
    if (c.excluded) { excluded++; continue; }
    if (seen.has(c.email)) continue;
    seen.add(c.email); contacts.push({ name: c.name, email: c.email, notionPageId: c.pageId });
  }
  const csv = ["Name,Email,Notion Page ID", ...contacts.map((c) => [c.name, c.email, c.notionPageId].map((value) => '"' + String(value || "").replaceAll('"', '""') + '"').join(","))].join("\n") + (contacts.length ? "\n" : "");
  const outputPath = o.output || defaultOutput;
  if (outputPath) {
    const path = resolve(outputPath);
    if (!o.force) { try { await readFile(path); throw new Error("Output exists; pass --force to replace it."); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, csv, { encoding: "utf8", flag: o.force ? "w" : "wx" });
    process.stdout.write("Exported " + contacts.length + " eligible contacts to " + path + "\n");
  } else process.stdout.write(csv);
  process.stderr.write("Notion rows: " + pages.length + "; no consent: " + withoutConsent + "; excluded: " + excluded + "; exported: " + contacts.length + "\n");
}

async function notionUnsubscribe(o) {
  requireFields(o, ["source", "email", "consent", "address"]);
  const address = o.address.trim().toLowerCase();
  const pages = await queryNotionSource(o.source, { property: o.email, email: { equals: address } });
  const matches = pages.filter((page) => isNotionSubscribed(page, o.consent));
  if (!matches.length) { process.stdout.write("No opted-in Notion record found. Nothing changed.\n"); return; }
  if (!o.apply) { process.stdout.write("Dry run: would unsubscribe " + matches.length + " matching record(s). Add --apply to update Notion.\n"); return; }
  for (const page of matches) await updateNotionCheckbox(page.id, o.consent, false);
  process.stdout.write("Updated " + matches.length + " Notion record(s) to opted out.\n");
}

async function main() {
  const [group, action, ...args] = process.argv.slice(2);
  if (!group || group === "--help" || group === "-h") { process.stdout.write(help); return; }
  const o = optionsFrom(args);
  if (o.help) { process.stdout.write(help); return; }

  if (group === "recipients" && action === "prepare") {
    requireFields(o, ["input"]);
    const r = prepareRecipients(await readFile(resolve(o.input), "utf8"), await Promise.all(o.excludes.map((p) => readFile(resolve(p), "utf8"))));
    const csv = toImportCsv(r.recipients);
    if (o.output) {
      const path = resolve(o.output);
      if (!o.force) { try { await readFile(path); throw new Error("Output exists; pass --force to replace it."); } catch (e) { if (e.code !== "ENOENT") throw e; } }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, csv, { encoding: "utf8", flag: o.force ? "w" : "wx" });
      process.stdout.write("Prepared " + r.recipients.length + " contacts → " + path + "\n");
    } else process.stdout.write(csv);
    process.stderr.write("Rows: " + r.stats.inputCount + "; invalid: " + r.stats.invalidCount + "; duplicates: " + r.stats.duplicateCount + "; excluded: " + r.stats.excludedCount + "\n");
    return;
  }
  if (group === "recipients" && action === "check") {
    requireFields(o, ["input"]);
    const result = prepareRecipients(await readFile(resolve(o.input), "utf8"));
    process.stdout.write(JSON.stringify({ ...result.stats, outputCount: result.recipients.length }, null, 2) + "\n");
    return;
  }
  if (group === "lists" && action === "save") {
    requireFields(o, ["name", "input"]);
    const result = prepareRecipients(await readFile(resolve(o.input), "utf8"));
    process.stdout.write("Saved " + result.recipients.length + " contacts → " + await saveList(o.name, toImportCsv(result.recipients), { force: o.force }) + "\n");
    return;
  }
  if (group === "lists" && action === "list") { process.stdout.write((await listSavedLists()).join("\n") + "\n"); return; }

  if (group === "draft" && action === "create") {
    requireFields(o, ["name", "subject"]);
    if (!o["body-file"] && !o["html-file"]) throw new Error("Provide --body-file or --html-file.");
    const recipients = o.recipients ? await getContacts(o.recipients) : [];
    const hasNotionRecords = recipients.some((recipient) => recipient.notionPageId);
    if (hasNotionRecords) {
      for (const recipient of recipients) recipient.unsubscribeUrl = "https://example.org/unsubscribe-preview";
    }
    const designSettings = o.design ? JSON.parse(await readFile(resolve(o.design), "utf8")) : {
      layout: "letter", accent: "#0a2d57", background: "#f5f5f4", font: "Arial,Helvetica,sans-serif", padding: 32, width: 600
    };
    const draft = {
      draftName: o.name,
      subject: o.subject,
      body: o["body-file"] ? await readFile(resolve(o["body-file"]), "utf8") : "",
      htmlBody: o["html-file"] ? await readFile(resolve(o["html-file"]), "utf8") : "",
      recipientColumns: columnsForRecipients(recipients),
      recipients,
      designSettings
    };
    process.stdout.write("Created " + (await saveDraft(o.name, draft, { force: o.force })) + "\n");
    return;
  }
  if (group === "draft" && action === "import") {
    requireFields(o, ["input"]);
    const draft = JSON.parse(await readFile(resolve(o.input), "utf8"));
    requireFields(draft, ["draftName"]);
    process.stdout.write("Imported " + (await saveDraft(draft.draftName, draft, { force: o.force })) + "\n");
    return;
  }
  if (group === "draft" && action === "update") {
    requireFields(o, ["name"]);
    const draft = await readDraft(o.name);
    if (o.subject !== undefined) draft.subject = o.subject;
    if (o["body-file"]) draft.body = await readFile(resolve(o["body-file"]), "utf8");
    if (o["html-file"]) draft.htmlBody = await readFile(resolve(o["html-file"]), "utf8");
    if (o.recipients) {
      draft.recipients = await getContacts(o.recipients);
      if (draft.recipients.some((recipient) => recipient.notionPageId)) {
        for (const recipient of draft.recipients) recipient.unsubscribeUrl = "https://example.org/unsubscribe-preview";
      }
      draft.recipientColumns = columnsForRecipients(draft.recipients);
    }
    if (o.design) draft.designSettings = JSON.parse(await readFile(resolve(o.design), "utf8"));
    process.stdout.write("Updated " + (await saveDraft(o.name, draft, { force: true })) + "\n");
    return;
  }
  if (group === "draft" && action === "list") { process.stdout.write((await listDrafts()).join("\n") + "\n"); return; }
  if (group === "draft" && ["check", "preview"].includes(action)) {
    requireFields(o, ["name"]);
    const draft = await readDraft(o.name);
    const contacts = o.recipients ? await getContacts(o.recipients) : draft.recipients || [];
    if (action === "check") {
      const report = checkDraft(draft, contacts);
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      if (report.errors.length) process.exitCode = 2;
      return;
    }
    const preview = renderDraftPreview(draft, contacts[0] || {});
    if (o.output) {
      await mkdir(dirname(resolve(o.output)), { recursive: true });
      await writeFile(resolve(o.output), preview.html, "utf8");
      process.stdout.write("Preview written to " + resolve(o.output) + "\n");
    } else process.stdout.write(preview.html + "\n");
    return;
  }
  if (group === "notion" && action === "inspect") {
    requireFields(o, ["source"]);
    const data = await notionRequest("/data_sources/" + encodeURIComponent(o.source));
    process.stdout.write(JSON.stringify({ id: data.id, title: data.title, properties: data.properties }, null, 2) + "\n");
    return;
  }
  if (group === "notion" && action === "export") { await notionExport(o); return; }
  if (group === "notion" && action === "sync") { await notionExport(o, { defaultOutput: "campaigns/notion-newsletter.csv" }); return; }
  if (group === "notion" && action === "unsubscribe") { await notionUnsubscribe(o); return; }
  if (group === "unsubscribe" && action === "link") {
    requireFields(o, ["email", "page-id", "base-url"]);
    const url = new URL(o["base-url"]);
    if (url.protocol !== "https:") throw new Error("Public unsubscribe links require HTTPS.");
    const secret = process.env.MAILBOT_UNSUBSCRIBE_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Set MAILBOT_UNSUBSCRIBE_SECRET to a random value of at least 32 bytes.");
    const { createUnsubscribeToken } = await import("../server/unsubscribe.js");
    const token = createUnsubscribeToken({ pageId: o["page-id"], email: o.email });
    url.pathname = url.pathname.replace(/\/$/, "") + "/unsubscribe/" + token;
    process.stdout.write(url.toString() + "\n");
    return;
  }
  if (group === "unsubscribe" && action === "handle") {
    requireFields(o, ["token"]);
    const { verifyUnsubscribeToken } = await import("../server/unsubscribe.js");
    const data = verifyUnsubscribeToken(o.token);
    const source = process.env.NOTION_DATA_SOURCE_ID;
    const emailProperty = process.env.NOTION_EMAIL_PROPERTY;
    const consentProperty = process.env.NOTION_OPT_IN_PROPERTY;
    if (!source || !emailProperty || !consentProperty) throw new Error("Configure NOTION_DATA_SOURCE_ID, NOTION_EMAIL_PROPERTY, and NOTION_OPT_IN_PROPERTY.");
    const page = await notionRequest("/pages/" + encodeURIComponent(data.pageId));
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const email = String(notionPropertyValue(page.properties?.[emailProperty]) || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The Notion record has no valid email address.");
    const storedHash = createHash("sha256").update(email).digest();
    const tokenHash = Buffer.from(data.emailHash, "base64url");
    if (tokenHash.length !== storedHash.length || !timingSafeEqual(tokenHash, storedHash)) throw new Error("The Notion email address has changed since this link was created.");
    await updateNotionCheckbox(data.pageId, consentProperty, false);
    process.stdout.write("Unsubscribed; Notion updated.\n");
    return;
  }
  throw new Error("Unsupported command. Run mailbot --help.");
}
await loadLocalEnv();
main().catch((error) => { process.stderr.write("mailbot: " + error.message + "\n"); process.exitCode = 1; });
