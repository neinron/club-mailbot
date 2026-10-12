let studioReady = false;
let editorMode = "visual";
let previewIndex = 0;
let previewImagesBlocked = false;
let savedEditorRange = null;
let editingButton = null;
let linkKind = "button";
let sending = false;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const draftCollectionStorageKey = "club-mailbot.drafts.v1";
const selectedDraftStorageKey = "club-mailbot.selected-draft.v1";
const tableCollectionStorageKey = "club-mailbot.tables.v1";
const selectedTableStorageKey = "club-mailbot.selected-table.v1";
const autosaveDelayMs = 500;
const clubEmailLogoUrl = "https://tum-socialaiclub.de/assets/logos/LOGO_V6-ICON%2BTUM_SOCIAL_CLUB-single_line-dark_text.svg";
const defaultRecipientColumns = [
  { key: "name", label: "Name", role: "text" },
  { key: "email", label: "E-Mail", role: "to" },
  { key: "interviewLink", label: "Interview-Link", role: "text" }
];

const elements = {
  workspaceTitle: document.querySelector("#workspaceTitle"),
  accountEmail: document.querySelector("#accountEmail"),
  appPassword: document.querySelector("#appPassword"),
  authMode: document.querySelector("#authMode"),
  smtpSecurity: document.querySelector("#smtpSecurity"),
  secretLabel: document.querySelector("#secretLabel"),
  fromName: document.querySelector("#fromName"),
  draftName: document.querySelector("#draftName"),
  draftSelect: document.querySelector("#draftSelect"),
  csvFile: document.querySelector("#csvFile"),
  rawRecipients: document.querySelector("#rawRecipients"),
  parseButton: document.querySelector("#parseButton"),
  tableName: document.querySelector("#tableName"),
  tableSelect: document.querySelector("#tableSelect"),
  saveTableButton: document.querySelector("#saveTableButton"),
  loadTableButton: document.querySelector("#loadTableButton"),
  deleteTableButton: document.querySelector("#deleteTableButton"),
  tableSaveStatus: document.querySelector("#tableSaveStatus"),
  addRecipientButton: document.querySelector("#addRecipientButton"),
  clearButton: document.querySelector("#clearButton"),
  recipientCount: document.querySelector("#recipientCount"),
  duplicateCount: document.querySelector("#duplicateCount"),
  invalidCount: document.querySelector("#invalidCount"),
  recipientVariableWarning: document.querySelector("#recipientVariableWarning"),
  recipientHead: document.querySelector("#recipientHead"),
  recipientRows: document.querySelector("#recipientRows"),
  subject: document.querySelector("#subject"),
  body: document.querySelector("#body"),
  editorVariables: document.querySelector("#editorVariables"),
  messageVariableSummary: document.querySelector("#messageVariableSummary"),
  htmlBody: document.querySelector("#htmlBody"),
  messagePreviewRecipient: document.querySelector("#messagePreviewRecipient"),
  messagePreviewSubject: document.querySelector("#messagePreviewSubject"),
  messageHtmlPreview: document.querySelector("#messageHtmlPreview"),
  previewRecipient: document.querySelector("#previewRecipient"),
  previewSubject: document.querySelector("#previewSubject"),
  previewBody: document.querySelector("#previewBody"),
  htmlPreview: document.querySelector("#htmlPreview"),
  delayMs: document.querySelector("#delayMs"),
  testButton: document.querySelector("#testButton"),
  sendButton: document.querySelector("#sendButton"),
  testAuthButton: document.querySelector("#testAuthButton"),
  clearLogsButton: document.querySelector("#clearLogsButton"),
  smtpLogs: document.querySelector("#smtpLogs"),
  saveDraftButton: document.querySelector("#saveDraftButton"),
  loadDraftButton: document.querySelector("#loadDraftButton"),
  deleteDraftButton: document.querySelector("#deleteDraftButton"),
  pageLinks: Array.from(document.querySelectorAll("[data-page-target]")),
  pages: Array.from(document.querySelectorAll("[data-page]")),
  summaryRecipientCount: document.querySelector("#summaryRecipientCount"),
  summaryDraftCount: document.querySelector("#summaryDraftCount"),
  summaryReady: document.querySelector("#summaryReady"),
  saveStatus: document.querySelector("#saveStatus"),
  status: document.querySelector("#status")
};

let recipients = [];
let recipientColumns = [...defaultRecipientColumns];
let parseStats = { invalid: 0, duplicates: 0 };
let autosaveTimer = null;
let isHydratingDraft = false;

function activatePage(pageName) {
  if (pageName === "design" && studioReady) updateDesignPreview();
  document.querySelectorAll(".page-nav .page-link").forEach(link => link.setAttribute("aria-current", link.dataset.pageTarget === pageName ? "page" : "false"));
  elements.pages.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === pageName);
  });

  elements.pageLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.pageTarget === pageName);
  });

  const activeLink = elements.pageLinks.find((link) => link.dataset.pageTarget === pageName);
  if (elements.workspaceTitle && activeLink) {
    elements.workspaceTitle.textContent = activeLink.querySelector("span")?.textContent || "Mailbot";
  }
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && (char === "," || char === ";" || char === "\t")) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function isConformVariableLabel(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || "").trim());
}

function resolveTemplateVariable(rawKey, recipient, columns = recipientColumns) {
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

function slugifyHeader(value) {
  const normalized = normalizeHeader(value)
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  return normalized || `property${recipientColumns.length + 1}`;
}

function cleanName(value) {
  return String(value || "")
    .replace(/[<>()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmail(value) {
  return String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";
}

function parseNameAndEmailFromText(value) {
  const text = String(value || "").trim();
  const email = extractEmail(text);
  if (!email) return { name: "", email: "" };
  return { name: cleanName(text.replace(email, "")), email };
}

function canonicalColumnFromHeader(header) {
  const originalLabel = String(header || "").trim() || "Property";
  const normalized = normalizeHeader(header);
  if (["email", "e-mail", "mail", "adresse"].includes(normalized)) return { key: "email", label: originalLabel, role: "to" };
  if (["name", "full name", "vollstaendiger name"].includes(normalized)) return { key: "name", label: originalLabel, role: "text" };
  if (["vorname", "first name", "firstname"].includes(normalized)) return { key: "firstName", label: originalLabel, role: "text" };
  if (["nachname", "last name", "lastname"].includes(normalized)) return { key: "lastName", label: originalLabel, role: "text" };
  if (["interviewlink", "interview link", "einladungslink", "einladung", "link", "invite link"].includes(normalized)) {
    return { key: "interviewLink", label: originalLabel, role: "text" };
  }
  return { key: slugifyHeader(originalLabel), label: originalLabel, role: "text" };
}

function normalizeColumnRole(value) {
  return ["text", "to", "cc", "bcc", "replyTo"].includes(value) ? value : "text";
}

function looksLikeHeader(row) {
  const normalized = row.map(normalizeHeader);
  return normalized.some((value) => ["email", "e-mail", "mail", "adresse"].includes(value))
    || normalized.some((value) => ["name", "vorname", "nachname", "first name", "last name", "link", "invite link", "interview link"].includes(value));
}

function buildColumnsFromHeaders(headers) {
  const seen = new Set();
  const columns = headers
    .map(canonicalColumnFromHeader)
    .filter((column) => {
      if (!column.key || seen.has(column.key)) return false;
      seen.add(column.key);
      return true;
    });

  for (const baseColumn of defaultRecipientColumns) {
    if (!seen.has(baseColumn.key)) {
      columns.push(baseColumn);
      seen.add(baseColumn.key);
    }
  }

  return columns;
}

function ensureRequiredRecipientFields(recipient) {
  const record = { ...recipient };
  record.email = String(record.email || "").trim().toLowerCase();
  record.name = String(record.name || "").trim();
  if (!record.name && record.firstName && record.lastName) {
    record.name = `${record.firstName} ${record.lastName}`.trim();
  }
  if (!record.name && record.email) {
    record.name = record.email.split("@")[0];
  }
  record.interviewLink = String(record.interviewLink || "").trim();
  return record;
}

function recipientFromHeaderRow(columns, row) {
  const recipient = {};
  columns.forEach((column, index) => {
    recipient[column.key] = String(row[index] || "").trim();
  });

  if (!recipient.email) {
    recipient.email = extractEmail(row.join(" "));
  }

  if (!recipient.name) {
    const fullName = [recipient.firstName, recipient.lastName].filter(Boolean).join(" ").trim();
    if (fullName) recipient.name = fullName;
  }

  return ensureRequiredRecipientFields(recipient);
}

function recipientFromLooseRow(row) {
  const emailCell = row.find((cell) => extractEmail(cell));
  const parsed = emailCell ? parseNameAndEmailFromText(emailCell) : parseNameAndEmailFromText(row.join(" "));
  const linkCell = row.find((cell) => /^https?:\/\//i.test(String(cell || "").trim())) || "";
  const nameParts = row
    .map((cell) => cleanName(String(cell || "").replace(parsed.email, "").replace(linkCell, "")))
    .filter(Boolean);

  return ensureRequiredRecipientFields({
    name: nameParts.join(" ").trim() || parsed.name,
    email: parsed.email,
    interviewLink: String(linkCell || "").trim()
  });
}

function buildColumnsForDataRows(rows) {
  const columns = recipientColumns.length ? [...recipientColumns] : [...defaultRecipientColumns];
  const widestRow = rows.reduce((max, row) => Math.max(max, row.length), 0);

  while (columns.length < widestRow) {
    const index = columns.length + 1;
    columns.push({
      key: `property${index}`,
      label: `Property ${index}`,
      role: "text"
    });
  }

  return columns;
}

function parseRecipients(text) {
  const rows = parseDelimited(text);
  const dataRows = rows;
  const columns = buildColumnsForDataRows(dataRows);
  const parsed = [];
  let invalid = 0;
  let duplicates = 0;
  const seen = new Set();

  for (const row of dataRows) {
    const recipient = recipientFromHeaderRow(columns, row);
    if (!emailPattern.test(recipient.email)) {
      invalid += 1;
      continue;
    }
    if (seen.has(recipient.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(recipient.email);
    parsed.push(recipient);
  }

  recipientColumns = columns;
  parseStats = { invalid, duplicates };
  return parsed;
}

function renderTemplate(template, recipient, columns = recipientColumns) {
  const record = ensureRequiredRecipientFields(recipient || {});
  const variables = {
    ...record,
    firstName: String(record.firstName || record.name.split(/\s+/)[0] || ""),
    lastName: String(record.lastName || record.name.split(/\s+/).slice(1).join(" ") || "")
  };

  return String(template || "").replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey || "").trim();
    if (variables[key] != null) return String(variables[key]);
    const resolved = resolveTemplateVariable(key, record, columns);
    return resolved != null ? String(resolved) : "";
  });
}

function resolveButtonTarget(rawTarget, recipient, columns = recipientColumns) {
  const target = String(rawTarget || "").trim();
  if (!target) return "";
  if (/^https?:\/\//i.test(target) || /^mailto:/i.test(target)) return target;
  return String(resolveTemplateVariable(target, ensureRequiredRecipientFields(recipient || {}), columns) || "").trim();
}

function renderButtonMarkup(rawLabel, rawTarget, recipient, mode = "html", variant = "gradient") {
  const label = renderTemplate(String(rawLabel || "").trim(), recipient);
  const href = renderTemplate(resolveButtonTarget(rawTarget, recipient), recipient);
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
      <a href="${escapeHtml(href)}" data-club-mailbot-button="true" data-club-mailbot-variant="${variant}" style="${buttonStyle}">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}

function normalizeLinkTarget(value, recipient) {
  const resolved = renderTemplate(resolveButtonTarget(value, recipient), recipient).trim();
  if (!resolved) return "";
  if (/^https?:\/\//i.test(resolved) || /^mailto:/i.test(resolved)) return resolved;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolved)) return `mailto:${resolved}`;
  return resolved;
}

function normalizeAnchorTargets(html, recipient) {
  return String(html || "").replace(/href=(["'])([^"']+)\1/gi, (_, quote, rawHref) => {
    const href = normalizeLinkTarget(rawHref, recipient);
    return `href=${quote}${escapeHtml(href || rawHref)}${quote}`;
  });
}

function previewHtmlWithBlockedImages(html) {
  if (!previewImagesBlocked) return html;
  return String(html || "").replace(/<img\b([^>]*?)\/?\s*>/gi, (_match, attrs) => {
    const alt = attrs.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2] || "Externes Bild";
    const rawWidth = Number(attrs.match(/\bwidth\s*=\s*(["']?)(\d+)/i)?.[2]);
    const rawHeight = Number(attrs.match(/\bheight\s*=\s*(["']?)(\d+)/i)?.[2]);
    const width = rawWidth > 0 ? Math.min(rawWidth, 640) : 320;
    const height = rawHeight > 0 ? Math.min(rawHeight, 240) : 64;
    return `<span role="img" aria-label="${escapeHtml(alt)} · blockiert" style="display:block;width:${width}px;max-width:100%;height:${height}px;line-height:${height}px;overflow:hidden;text-align:center;border:1px dashed #aeb9c3;border-radius:8px;background:#f1f4f5;color:#66707a;font:12px Arial,Helvetica,sans-serif;">▧ ${escapeHtml(alt)} · blockiert</span>`;
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

function renderVariableValue(rawKey, recipient) {
  const key = String(rawKey || "").trim();
  const value = ["firstName", "lastName"].includes(key) ? renderTemplate(`{{${key}}}`, recipient) : resolveTemplateVariable(key, ensureRequiredRecipientFields(recipient || {}));
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeHtml(text)}" style="color:#0a2d57;font-weight:800;text-decoration:underline;">${escapeHtml(text)}</a>`;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return `<a href="mailto:${escapeHtml(text)}" style="color:#0a6f55;font-weight:800;text-decoration:underline;">${escapeHtml(text)}</a>`;
  }
  return escapeHtml(text);
}

function renderHtmlContent(template, recipient) {
  const tokens = [];
  const pushToken = (value) => {
    const index = tokens.push(value) - 1;
    return tokenPlaceholder(index);
  };

  let working = String(template || "");
  working = working.replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^|}]+?)(?:\|\s*([a-z]+))?\s*\}\}/gi, (_, rawLabel, rawTarget, variant) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, "html", variant || "gradient"))
  ));
  working = working.replace(/button\{\{\s*([^,}]+)\s*,\s*([^,}]+?)(?:\s*,\s*([a-z]+))?\s*\}\}/gi, (_, rawLabel, rawTarget, variant) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, "html", variant || "gradient"))
  ));
  working = working.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => pushToken(renderVariableValue(rawKey, recipient)));
  return working.replace(/%%MAILBOTE_TOKEN_(\d+)%%/g, (_, rawIndex) => tokens[Number(rawIndex)] || "");
}

function renderHtmlMessage(designTemplate, contentTemplate, recipient) {
  const contentHtml = enforceTypography(
    enforceAnchorStyles(
      normalizeAnchorTargets(
        renderHtmlContent(contentTemplate, recipient),
        recipient
      )
    )
  );
  let result = renderTemplate(String(designTemplate || "").replaceAll("{{content}}", contentHtml), recipient);
  const accent = String(designTemplate).match(/data-mail-accent="(#[0-9a-f]{6})"/i)?.[1];
  const font = String(designTemplate).match(/data-mail-font="(serif|sans)"/)?.[1];
  if (accent) result = result.replaceAll("#0a2d57", accent);
  if (font === "serif") result = result.replaceAll("'Albert Sans',Arial,Helvetica,sans-serif", "Georgia,serif").replaceAll("'League Spartan',Arial,Helvetica,sans-serif", "Georgia,serif");
  return result;
}

function insertVariableAtCursor(variableName) {
  const placeholder = `{{${variableName}}}`;
  if (studioReady && editorMode === "visual") {
    insertEditorHtml(escapeHtml(placeholder));
    return;
  }
  const start = elements.body.selectionStart ?? elements.body.value.length;
  const end = elements.body.selectionEnd ?? start;
  const value = elements.body.value;
  elements.body.value = `${value.slice(0, start)}${placeholder}${value.slice(end)}`;
  const nextCursor = start + placeholder.length;
  elements.body.focus();
  elements.body.setSelectionRange(nextCursor, nextCursor);
  updatePreview();
  queueAutosave();
}

function updateEditorVariables() {
  if (!elements.editorVariables) return;
  const variableNames = Array.from(new Set(
    recipientColumns.map((column) => String(column.label || column.key || "").trim()).filter(Boolean)
  ));

  for (const defaultVariable of ["name", "firstName", "lastName", "email"]) {
    if (!variableNames.includes(defaultVariable)) {
      variableNames.unshift(defaultVariable);
    }
  }

  elements.editorVariables.innerHTML = variableNames
    .map((name) => `<button type="button" class="variable-chip" data-insert-variable="${escapeHtml(name)}">{{${escapeHtml(name)}}}</button>`)
    .join("");

  if (elements.messageVariableSummary) {
    elements.messageVariableSummary.textContent = variableNames
      .slice(0, 6)
      .map((name) => `{{${name}}}`)
      .join(" ");
  }

  if (elements.recipientVariableWarning) {
    const invalidLabels = recipientColumns
      .map((column) => String(column.label || "").trim())
      .filter(Boolean)
      .filter((label) => !isConformVariableLabel(label));

    elements.recipientVariableWarning.textContent = invalidLabels.length
      ? `Warnung: Diese Spaltennamen sind für Platzhalter unpraktisch, weil sie Leerzeichen oder Sonderzeichen enthalten: ${invalidLabels.join(", ")}. Besser sind Namen wie firstName oder interviewLink.`
      : "";
  }
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setSaveStatus(message) {
  elements.saveStatus.textContent = message;
}

function setTableSaveStatus(message) {
  if (elements.tableSaveStatus) {
    elements.tableSaveStatus.textContent = message;
  }
}

function formatTrace(trace = []) {
  if (!trace.length) return "Keine SMTP-Trace-Daten erhalten.";
  return trace
    .map((entry) => {
      const label = entry.direction === "C" ? "CLIENT" : entry.direction === "S" ? "SERVER" : "INFO";
      return `[${new Date(entry.at).toLocaleTimeString("de-DE")}] ${label} ${entry.message}`;
    })
    .join("\n");
}

function showLogs(trace = [], heading = "") {
  const body = formatTrace(trace);
  elements.smtpLogs.textContent = heading ? `${heading}\n${body}` : body;
}

function updateAuthUi() {
  const isOauth = elements.authMode.value === "xoauth2";
  elements.secretLabel.textContent = isOauth ? "OAuth Access Token" : "App-Passwort";
  elements.appPassword.placeholder = isOauth ? "ya29... Access Token" : "16-stelliges App-Passwort";
}

function syncRawRecipientsFromTable() {
  const rows = recipients.map((recipient) => recipientColumns.map((column) => {
    const value = String(recipient[column.key] || "");
    return /["\n\t]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }));

  elements.rawRecipients.value = rows.map((row) => row.join("\t")).join("\n");
}

function collectDraft() {
  const draftName = String(elements.draftName.value || "").trim() || "Standardentwurf";
  return {
    draftName,
    accountEmail: elements.accountEmail.value.trim(),
    authMode: elements.authMode.value,
    smtpSecurity: elements.smtpSecurity.value,
    fromName: elements.fromName.value.trim(),
    recipientColumns,
    recipients,
    subject: elements.subject.value,
    body: elements.body.value,
    htmlBody: elements.htmlBody.value,
    delayMs: elements.delayMs.value,
    designSettings: studioReady ? readDesignSettings() : undefined,
    savedAt: new Date().toISOString()
  };
}

function normalizeDraftName(value) {
  return String(value || "").trim() || "Standardentwurf";
}

function readDraftCollection() {
  try {
    const raw = localStorage.getItem(draftCollectionStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDraftCollection(collection) {
  localStorage.setItem(draftCollectionStorageKey, JSON.stringify(collection));
}

function setSelectedDraftName(name) {
  try {
    localStorage.setItem(selectedDraftStorageKey, normalizeDraftName(name));
  } catch {
    // ignore storage failures here; save flow handles user-facing errors
  }
}

function getSelectedDraftName() {
  try {
    return normalizeDraftName(localStorage.getItem(selectedDraftStorageKey) || elements.draftName.value);
  } catch {
    return normalizeDraftName(elements.draftName.value);
  }
}

function updateDraftSelectOptions(selectedName = "") {
  const collection = readDraftCollection();
  renderSidebarDrafts(collection, selectedName);
  const names = Object.keys(collection).sort((left, right) => left.localeCompare(right, "de"));
  const fallback = names.length ? names[0] : "";
  const activeName = selectedName && collection[selectedName] ? selectedName : fallback;

  if (!names.length) {
    elements.draftSelect.innerHTML = '<option value="">Keine Entwürfe gespeichert</option>';
    elements.draftSelect.value = "";
    elements.deleteDraftButton.disabled = true;
    if (elements.summaryDraftCount) {
      elements.summaryDraftCount.textContent = "0";
    }
    return;
  }

  elements.draftSelect.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  elements.draftSelect.value = activeName;
  elements.deleteDraftButton.disabled = false;
  if (elements.summaryDraftCount) {
    elements.summaryDraftCount.textContent = String(names.length);
  }
}

function normalizeTableName(value) {
  return String(value || "").trim() || "Standardtabelle";
}

function readTableCollection() {
  try {
    const raw = localStorage.getItem(tableCollectionStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTableCollection(collection) {
  localStorage.setItem(tableCollectionStorageKey, JSON.stringify(collection));
}

function setSelectedTableName(name) {
  try {
    localStorage.setItem(selectedTableStorageKey, normalizeTableName(name));
  } catch {
    // ignore storage failures
  }
}

function getSelectedTableName() {
  try {
    return normalizeTableName(localStorage.getItem(selectedTableStorageKey) || elements.tableName?.value);
  } catch {
    return normalizeTableName(elements.tableName?.value);
  }
}

function updateTableSelectOptions(selectedName = "") {
  if (!elements.tableSelect) return;
  const collection = readTableCollection();
  const names = Object.keys(collection).sort((left, right) => left.localeCompare(right, "de"));
  const fallback = names.length ? names[0] : "";
  const activeName = selectedName && collection[selectedName] ? selectedName : fallback;

  if (!names.length) {
    elements.tableSelect.innerHTML = '<option value="">Keine Tabellen gespeichert</option>';
    elements.tableSelect.value = "";
    if (elements.deleteTableButton) elements.deleteTableButton.disabled = true;
    return;
  }

  elements.tableSelect.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  elements.tableSelect.value = activeName;
  if (elements.deleteTableButton) elements.deleteTableButton.disabled = false;
}

function formatSavedAt(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function saveDraft() {
  const draft = collectDraft();
  try {
    const collection = readDraftCollection();
    const previousName = getSelectedDraftName();
    if (previousName !== draft.draftName && collection[draft.draftName]) {
      setSaveStatus("Dieser Entwurfsname existiert bereits. Bitte einen anderen Namen wählen.");
      return false;
    }
    if (previousName !== draft.draftName) delete collection[previousName];
    collection[draft.draftName] = draft;
    writeDraftCollection(collection);
    updateDraftSelectOptions(draft.draftName);
    setSelectedDraftName(draft.draftName);
    setSaveStatus(`Gespeichert: ${formatSavedAt(draft.savedAt)}. App-Passwort wurde nicht gespeichert.`);
    return true;
  } catch {
    setSaveStatus("Speichern im Browser ist fehlgeschlagen.");
    return false;
  }
}

function collectTableState() {
  return {
    tableName: normalizeTableName(elements.tableName?.value),
    recipientColumns,
    recipients,
    savedAt: new Date().toISOString()
  };
}

function saveTableState() {
  const table = collectTableState();
  try {
    const collection = readTableCollection();
    collection[table.tableName] = table;
    writeTableCollection(collection);
    updateTableSelectOptions(table.tableName);
    setSelectedTableName(table.tableName);
    setTableSaveStatus(`Tabelle gespeichert: ${formatSavedAt(table.savedAt)}`);
    return true;
  } catch {
    setTableSaveStatus("Tabellenspeicherung fehlgeschlagen.");
    return false;
  }
}

function queueAutosave() {
  if (isHydratingDraft) return;
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
  }

  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    saveDraft();
  }, autosaveDelayMs);
}

function hydrateRecipientData(columns, rows) {
  recipientColumns = Array.isArray(columns) && columns.length
    ? columns.map((column) => ({
      key: String(column.key || slugifyHeader(column.label || column.key || "property")).trim(),
      label: String(column.label || column.key || "Property").trim(),
      role: normalizeColumnRole(column.role)
    }))
    : [...defaultRecipientColumns];
  recipients = Array.isArray(rows) ? rows.map(ensureRequiredRecipientFields) : [];
  syncRawRecipientsFromTable();
  parseStats = { invalid: 0, duplicates: 0 };
}

function applyTableState(table, showStatus = true) {
  try {
    isHydratingDraft = true;
    if (elements.tableName) {
      elements.tableName.value = normalizeTableName(table.tableName);
    }
    hydrateRecipientData(table.recipientColumns, table.recipients);
    updateTable();
    updatePreview();
    updateTableSelectOptions(normalizeTableName(table.tableName));
    setSelectedTableName(table.tableName);
    if (showStatus) {
      setTableSaveStatus(`Tabelle geladen: ${formatSavedAt(table.savedAt)}`);
    }
    return true;
  } catch {
    setTableSaveStatus("Gespeicherte Tabelle konnte nicht geladen werden.");
    return false;
  } finally {
    isHydratingDraft = false;
  }
}

function loadTableState(showStatus = true) {
  const collection = readTableCollection();
  const selectedName = normalizeTableName(elements.tableSelect?.value || getSelectedTableName());
  const table = collection[selectedName];

  if (!table) {
    updateTableSelectOptions();
    if (showStatus) setTableSaveStatus("Keine gespeicherte Tabelle mit diesem Namen gefunden.");
    return false;
  }

  return applyTableState(table, showStatus);
}

function deleteTableState() {
  const selectedName = normalizeTableName(elements.tableSelect?.value || elements.tableName?.value);
  const collection = readTableCollection();

  if (!collection[selectedName]) {
    setTableSaveStatus("Keine gespeicherte Tabelle zum Löschen gefunden.");
    return false;
  }

  delete collection[selectedName];

  try {
    writeTableCollection(collection);
    const remainingNames = Object.keys(collection).sort((left, right) => left.localeCompare(right, "de"));
    const nextName = remainingNames[0] || "Standardtabelle";
    if (elements.tableName) elements.tableName.value = nextName;
    updateTableSelectOptions(nextName);
    setSelectedTableName(nextName);
    setTableSaveStatus(`Tabelle "${selectedName}" gelöscht.`);
    return true;
  } catch {
    setTableSaveStatus("Tabelle konnte nicht gelöscht werden.");
    return false;
  }
}

function applyDraft(draft, showStatus = true) {
  try {
    isHydratingDraft = true;
    elements.draftName.value = normalizeDraftName(draft.draftName);
    elements.accountEmail.value = draft.accountEmail || "";
    elements.authMode.value = draft.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    elements.smtpSecurity.value = draft.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";
    elements.fromName.value = draft.fromName || "Club Team";
    elements.subject.value = draft.subject || "";
    elements.body.value = draft.body || "";
    elements.htmlBody.value = withClubLogo(draft.htmlBody || "");
    elements.delayMs.value = draft.delayMs || "1200";
    restoreDesignSettings(draft.designSettings);
    previewIndex = 0;

    if (Array.isArray(draft.recipients) && draft.recipients.length) {
      hydrateRecipientData(draft.recipientColumns, draft.recipients);
    } else {
      recipients = parseRecipients(draft.rawRecipients || "");
      syncRawRecipientsFromTable();
    }

    updateAuthUi();
    updateTable();
    updatePreview();
    updateDraftSelectOptions(normalizeDraftName(draft.draftName));
    setSelectedDraftName(draft.draftName);
    if (showStatus) {
      setSaveStatus(`Geladen: ${formatSavedAt(draft.savedAt)}. App-Passwort muss neu eingetragen werden.`);
    }
    return true;
  } catch {
    setSaveStatus("Gespeicherte Daten konnten nicht gelesen werden.");
    return false;
  } finally {
    isHydratingDraft = false;
  }
}

function loadDraft(showStatus = true) {
  const collection = readDraftCollection();
  const selectedName = normalizeDraftName(elements.draftSelect.value || getSelectedDraftName());
  const draft = collection[selectedName];

  if (!draft) {
    updateDraftSelectOptions();
    if (showStatus) setSaveStatus("Kein gespeicherter Entwurf mit diesem Namen gefunden.");
    return false;
  }

  return applyDraft(draft, showStatus);
}

function deleteDraft() {
  const selectedName = normalizeDraftName(elements.draftSelect.value || elements.draftName.value);
  const collection = readDraftCollection();

  if (!collection[selectedName]) {
    setSaveStatus("Kein gespeicherter Entwurf zum Löschen gefunden.");
    return false;
  }

  delete collection[selectedName];

  try {
    writeDraftCollection(collection);
    const remainingNames = Object.keys(collection).sort((left, right) => left.localeCompare(right, "de"));
    const nextName = remainingNames[0] || "Standardentwurf";
    elements.draftName.value = nextName;
    updateDraftSelectOptions(nextName);
    setSelectedDraftName(nextName);
    setSaveStatus(`Entwurf "${selectedName}" gelöscht.`);
    return true;
  } catch {
    setSaveStatus("Entwurf konnte nicht gelöscht werden.");
    return false;
  }
}

function removeRecipient(index) {
  recipients.splice(index, 1);
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function addRecipient() {
  const emptyRecipient = Object.fromEntries(recipientColumns.map((column) => [column.key, ""]));
  recipients.push(ensureRequiredRecipientFields(emptyRecipient));
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function addColumn() {
  const rawLabel = window.prompt("Name der neuen Property", "interviewLink");
  if (!rawLabel) return;
  const label = rawLabel.trim();
  if (!label) return;
  const nextColumn = canonicalColumnFromHeader(label);

  if (recipientColumns.some((column) => column.key === nextColumn.key)) {
    setStatus(`Property "${nextColumn.label}" existiert bereits.`, "error");
    return;
  }

  recipientColumns.push(nextColumn);
  recipients = recipients.map((recipient) => ({ ...recipient, [nextColumn.key]: String(recipient[nextColumn.key] || "") }));
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus(`Property "${nextColumn.label}" hinzugefügt.`, "ok");
}

function deleteColumn(index) {
  const column = recipientColumns[index];
  if (!column) return;
  if (recipientColumns.length <= 1) {
    setStatus("Mindestens eine Spalte muss bestehen bleiben.", "error");
    return;
  }

  recipientColumns.splice(index, 1);
  recipients = recipients.map((recipient) => {
    const updated = { ...recipient };
    delete updated[column.key];
    return ensureRequiredRecipientFields(updated);
  });
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus(`Property "${column.label}" gelöscht.`, "ok");
}

function renameColumn(index, nextLabel) {
  const trimmed = String(nextLabel || "").trim();
  if (!trimmed) return;
  const current = recipientColumns[index];
  const next = canonicalColumnFromHeader(trimmed);
  next.role = recipientColumns[index].role || next.role;

  if (recipientColumns.some((column, columnIndex) => columnIndex !== index && column.key === next.key)) {
    setStatus(`Property "${next.label}" existiert bereits.`, "error");
    return;
  }

  recipientColumns[index] = next;
  recipients = recipients.map((recipient) => {
    const updated = { ...recipient };
    updated[next.key] = updated[current.key] || "";
    if (next.key !== current.key) {
      delete updated[current.key];
    }
    return ensureRequiredRecipientFields(updated);
  });
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function updateColumnRole(index, role) {
  recipientColumns[index].role = normalizeColumnRole(role);
  updateTable();
  updatePreview();
  queueAutosave();
}

function updateRecipientCell(index, key, value) {
  const updated = { ...recipients[index], [key]: value };
  recipients[index] = ensureRequiredRecipientFields(updated);
  syncRawRecipientsFromTable();
  updatePreview();
  queueAutosave();
}

function applyPastedRecipientTable(startRow, startColumnIndex, text) {
  const rows = parseDelimited(text);
  if (!rows.length) return false;

  let dataRows = rows;
  if (rows.length > 1) {
    if (looksLikeHeader(rows[0])) {
      dataRows = rows.slice(1);
    }
  }

  let changed = false;
  dataRows.forEach((row, rowOffset) => {
    const recipientIndex = startRow + rowOffset;
    while (recipientIndex >= recipients.length) {
      addRecipient();
      changed = true;
    }

    row.forEach((cell, columnOffset) => {
      const columnIndex = startColumnIndex + columnOffset;
      const column = recipientColumns[columnIndex];
      if (!column) return;
      const nextValue = String(cell || "");
      const currentValue = String(recipients[recipientIndex]?.[column.key] || "");
      if (currentValue === nextValue) return;
      recipients[recipientIndex] = ensureRequiredRecipientFields({
        ...recipients[recipientIndex],
        [column.key]: nextValue
      });
      changed = true;
    });
  });

  if (!changed) return false;
  syncRawRecipientsFromTable();
  updatePreview();
  queueAutosave();
  return true;
}

function updateTable() {
  elements.recipientCount.textContent = `${recipients.length} gültig`;
  elements.duplicateCount.textContent = `${parseStats.duplicates} Duplikate`;
  elements.invalidCount.textContent = `${parseStats.invalid} ungültig`;
  if (elements.summaryRecipientCount) {
    elements.summaryRecipientCount.textContent = String(recipients.length);
  }

  elements.recipientHead.innerHTML = `
    <tr>
      ${recipientColumns.map((column, index) => `
        <th>
          <div class="table-header-top">
            <input
              type="text"
              class="table-header-input"
              data-column-index="${index}"
              value="${escapeHtml(column.label)}"
              aria-label="Spaltenname ${escapeHtml(column.label)}"
            />
            <button type="button" class="table-icon-button" data-delete-column="${index}" aria-label="Spalte löschen">×</button>
          </div>
          <select class="table-role-select" data-column-role-index="${index}" aria-label="Versandrolle ${escapeHtml(column.label)}">
            <option value="text" ${column.role === "text" ? "selected" : ""}>Text</option>
            <option value="to" ${column.role === "to" ? "selected" : ""}>An</option>
            <option value="cc" ${column.role === "cc" ? "selected" : ""}>Cc</option>
            <option value="bcc" ${column.role === "bcc" ? "selected" : ""}>Bcc</option>
            <option value="replyTo" ${column.role === "replyTo" ? "selected" : ""}>Reply-To</option>
          </select>
        </th>
      `).join("")}
      <th>Aktion</th>
      <th><button type="button" class="table-icon-button table-add-column" data-add-column="true" aria-label="Spalte hinzufügen">+</button></th>
    </tr>
  `;

  if (!recipients.length) {
    elements.recipientRows.innerHTML = `<tr><td colspan="${recipientColumns.length + 2}">Noch keine Empfänger erkannt.</td></tr>`;
    updateEditorVariables();
    return;
  }

  elements.recipientRows.innerHTML = recipients
    .slice(0, 250)
    .map((recipient, rowIndex) => `
      <tr>
        ${recipientColumns.map((column) => `
          <td>
            <input
              type="text"
              class="table-cell-input"
              data-row-index="${rowIndex}"
              data-column-key="${escapeHtml(column.key)}"
              value="${escapeHtml(recipient[column.key] || "")}"
            />
          </td>
        `).join("")}
        <td><button type="button" class="ghost mini-button" data-remove-row="${rowIndex}">Löschen</button></td>
        <td></td>
      </tr>
    `)
    .join("");

  updateEditorVariables();
}

function updatePreview() {
  previewIndex = Math.min(previewIndex, Math.max(0, recipients.length - 1));
  const recipient = recipients[previewIndex];
  const renderedHtml = renderHtmlMessage(elements.htmlBody.value, elements.body.value, recipient || {name:"Alex Example",email:"alex@example.com"});
  if (elements.messagePreviewRecipient) {
    elements.messagePreviewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "kein Empfänger";
  }
  if (elements.messagePreviewSubject) {
    elements.messagePreviewSubject.textContent = renderTemplate(elements.subject.value, recipient);
  }
  if (elements.messageHtmlPreview) {
    const messagePreview = elements.messageHtmlPreview;
    messagePreview.onload = () => {
      const previewDocument = messagePreview.contentDocument;
      const contentHeight = Math.max(
        previewDocument?.documentElement?.scrollHeight || 0,
        previewDocument?.body?.scrollHeight || 0,
      );
      if (contentHeight) messagePreview.style.height = `${contentHeight}px`;
    };
    messagePreview.srcdoc = renderedHtml || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">Noch kein HTML-Design vorhanden.</p>";
  }
  elements.previewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "kein Empfänger";
  elements.previewSubject.textContent = renderTemplate(elements.subject.value, recipient);
  if (document.activeElement !== elements.previewBody) {
    elements.previewBody.value = elements.body.value;
  }
  elements.htmlPreview.onload = () => {
    const previewDocument = elements.htmlPreview.contentDocument;
    const contentHeight = Math.max(
      previewDocument?.documentElement?.scrollHeight || 0,
      previewDocument?.body?.scrollHeight || 0,
      800,
    );
    elements.htmlPreview.style.height = `${contentHeight}px`;
  };
  elements.htmlPreview.srcdoc = previewHtmlWithBlockedImages(renderedHtml || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">Noch kein HTML-Design vorhanden.</p>");

  const canSend = Boolean(
    emailPattern.test(elements.accountEmail.value.trim())
      && elements.appPassword.value.trim()
      && elements.subject.value.trim()
      && elements.body.value.trim()
      && elements.htmlBody.value.includes("{{content}}")
      && recipients.length
  );
  elements.testButton.disabled = sending || !canSend || !emailPattern.test(document.querySelector("#testEmail").value.trim());
  elements.sendButton.disabled = sending || !canSend;
  if (elements.summaryReady) {
    elements.summaryReady.textContent = canSend ? "Ja" : "Nein";
  }
  if (studioReady) syncStudio();
}

async function testAuth() {
  if (!elements.accountEmail.value.trim() || !elements.appPassword.value.trim()) {
    setStatus("Gmail-Adresse und App-Passwort/OAuth-Token fehlen.", "error");
    showLogs([], "Verbindungstest nicht gestartet.");
    return;
  }

  elements.testAuthButton.disabled = true;
  setStatus("SMTP-Verbindung wird getestet...", "");
  showLogs([], "SMTP-Verbindungstest läuft...");

  try {
    const response = await fetch("/api/test-auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountEmail: elements.accountEmail.value.trim(),
        authSecret: elements.appPassword.value,
        authMode: elements.authMode.value,
        smtpSecurity: elements.smtpSecurity.value
      })
    });
    const payload = await response.json();
    showLogs(payload.trace || [], response.ok ? "Verbindungstest erfolgreich." : "Verbindungstest fehlgeschlagen.");

    if (!response.ok) {
      throw new Error(payload.error || "Verbindungstest fehlgeschlagen.");
    }

    setStatus("Gmail SMTP Login erfolgreich. Du kannst jetzt eine Test-Mail senden.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.testAuthButton.disabled = false;
    updatePreview();
  }
}

function parseCurrentInput() {
  recipients = parseRecipients(elements.rawRecipients.value);
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  setStatus(`${recipients.length} gültige Empfänger erkannt. Tabelle kann jetzt angepasst werden.`, recipients.length ? "ok" : "error");
}

async function send(testOnly) {
  if (!recipients.length || sending) return;
  const testEmail = document.querySelector("#testEmail").value.trim();
  if (testOnly && !emailPattern.test(testEmail)) { setStatus("Bitte eine gültige Testadresse eintragen.", "error"); return; }

  const verb = testOnly ? "Test-Mail" : `${recipients.length} Mails`;
  const confirmed = testOnly || window.confirm(`${verb} über ${elements.accountEmail.value.trim()} senden?`);
  if (!confirmed) return;

  sending = true;
  elements.testButton.disabled = true;
  elements.sendButton.disabled = true;
  setStatus(`${verb} wird gesendet... Browser-Tab bitte offen lassen.`);

  try {
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountEmail: elements.accountEmail.value.trim(),
        authSecret: elements.appPassword.value,
        authMode: elements.authMode.value,
        smtpSecurity: elements.smtpSecurity.value,
        fromName: elements.fromName.value.trim(),
        subject: elements.subject.value,
      body: elements.body.value,
        htmlBody: elements.htmlBody.value,
        recipientColumns,
        recipients,
        delayMs: Number(elements.delayMs.value),
        testOnly,
        testEmail,
        previewIndex
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      showLogs(payload.trace || [], "Versand fehlgeschlagen.");
      throw new Error(payload.error || "Versand fehlgeschlagen.");
    }

    const failed = payload.results.filter((result) => !result.ok);
    const lastTrace = payload.results.find((result) => result.trace?.length)?.trace || payload.trace || [];
    showLogs(lastTrace, failed.length ? "SMTP-Trace mit Fehler." : "SMTP-Trace erfolgreich.");
    if (failed.length) {
      setStatus(`${payload.sent}/${payload.total} gesendet. Fehler bei: ${failed.map((item) => item.email).join(", ")}`, "error");
    } else {
      setStatus(`${payload.sent}/${payload.total} erfolgreich gesendet.`, "ok");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    sending = false;
    updatePreview();
  }
}

elements.parseButton.addEventListener("click", () => {
  parseCurrentInput();
  queueAutosave();
});

elements.addRecipientButton.addEventListener("click", addRecipient);

elements.saveTableButton?.addEventListener("click", () => {
  const saved = saveTableState();
  setStatus(saved ? "Empfängertabelle gespeichert." : "Tabelle konnte nicht gespeichert werden.", saved ? "ok" : "error");
});

elements.loadTableButton?.addEventListener("click", () => {
  const loaded = loadTableState(true);
  setStatus(loaded ? "Empfängertabelle geladen." : "Tabelle konnte nicht geladen werden.", loaded ? "ok" : "error");
});

elements.deleteTableButton?.addEventListener("click", () => {
  const deleted = deleteTableState();
  setStatus(deleted ? "Empfängertabelle gelöscht." : "Tabelle konnte nicht gelöscht werden.", deleted ? "ok" : "error");
});

elements.clearButton.addEventListener("click", () => {
  elements.rawRecipients.value = "";
  recipientColumns = [...defaultRecipientColumns];
  recipients = [];
  parseStats = { invalid: 0, duplicates: 0 };
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus("Liste geleert.");
});

elements.saveDraftButton.addEventListener("click", () => {
  const saved = saveDraft();
  setStatus(
    saved ? "Absenderdaten, Tabelle und Mail-Template wurden lokal gespeichert." : "Speichern im Browser ist fehlgeschlagen.",
    saved ? "ok" : "error"
  );
});

elements.loadDraftButton.addEventListener("click", () => {
  const loaded = loadDraft(true);
  setStatus(loaded ? "Gespeicherte Daten geladen." : "Keine gespeicherten Daten gefunden.", loaded ? "ok" : "error");
});

elements.deleteDraftButton.addEventListener("click", () => {
  const deleted = deleteDraft();
  setStatus(deleted ? "Gespeicherter Entwurf gelöscht." : "Entwurf konnte nicht gelöscht werden.", deleted ? "ok" : "error");
});

elements.pageLinks.forEach((link) => {
  link.addEventListener("click", () => {
    activatePage(link.dataset.pageTarget);
  });
});

elements.csvFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  elements.rawRecipients.value = await file.text();
  parseCurrentInput();
  queueAutosave();
});

elements.editorVariables?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("[data-insert-variable]");
  if (!button) return;
  insertVariableAtCursor(button.getAttribute("data-insert-variable"));
});

elements.recipientHead.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    const index = Number(target.dataset.columnIndex);
    if (Number.isNaN(index)) return;
    renameColumn(index, target.value);
    return;
  }
  if (target instanceof HTMLSelectElement) {
    const index = Number(target.dataset.columnRoleIndex);
    if (Number.isNaN(index)) return;
    updateColumnRole(index, target.value);
  }
});

elements.recipientHead.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const addButton = target.closest("[data-add-column]");
  if (addButton) {
    addColumn();
    return;
  }
  const deleteButton = target.closest("[data-delete-column]");
  if (deleteButton) {
    deleteColumn(Number(deleteButton.getAttribute("data-delete-column")));
  }
});

elements.recipientRows.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const rowIndex = Number(target.dataset.rowIndex);
  const columnKey = target.dataset.columnKey;
  if (Number.isNaN(rowIndex) || !columnKey) return;
  updateRecipientCell(rowIndex, columnKey, target.value);
});

elements.recipientRows.addEventListener("paste", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const rowIndex = Number(target.dataset.rowIndex);
  const columnKey = target.dataset.columnKey;
  if (Number.isNaN(rowIndex) || !columnKey) return;

  const pastedText = event.clipboardData?.getData("text/plain") || "";
  if (!pastedText.includes("\n") && !pastedText.includes("\t") && !pastedText.includes("\r")) {
    return;
  }

  const startColumnIndex = recipientColumns.findIndex((column) => column.key === columnKey);
  if (startColumnIndex < 0) return;

  event.preventDefault();
  applyPastedRecipientTable(rowIndex, startColumnIndex, pastedText);
});

elements.recipientRows.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("[data-remove-row]");
  if (!button) return;
  removeRecipient(Number(button.getAttribute("data-remove-row")));
});

[elements.accountEmail, elements.appPassword, elements.fromName, elements.draftName, elements.subject, elements.htmlBody].forEach((element) => {
  element.addEventListener("input", updatePreview);
  if (element !== elements.appPassword) {
    element.addEventListener("input", queueAutosave);
  }
});

elements.body.addEventListener("input", () => {
  updatePreview();
  queueAutosave();
});

elements.previewBody.addEventListener("input", () => {
  elements.body.value = elements.previewBody.value;
  updatePreview();
  queueAutosave();
});

elements.draftSelect.addEventListener("change", () => {
  const targetName = elements.draftSelect.value;
  clearTimeout(autosaveTimer);
  saveDraft();
  elements.draftSelect.value = targetName;
  loadDraft(true);
});

elements.tableSelect?.addEventListener("change", () => {
  const selectedName = normalizeTableName(elements.tableSelect.value);
  if (selectedName && elements.tableName) {
    elements.tableName.value = selectedName;
    setSelectedTableName(selectedName);
    loadTableState(false);
  }
});

[elements.authMode, elements.smtpSecurity].forEach((element) => {
  element.addEventListener("change", () => {
    updateAuthUi();
    updatePreview();
    queueAutosave();
  });
});

elements.rawRecipients.addEventListener("paste", () => {
  window.setTimeout(() => {
    parseCurrentInput();
  }, 0);
});
elements.delayMs.addEventListener("change", queueAutosave);
elements.testButton.addEventListener("click", () => send(true));
elements.sendButton.addEventListener("click", () => send(false));
elements.testAuthButton.addEventListener("click", testAuth);
elements.clearLogsButton.addEventListener("click", () => {
  elements.smtpLogs.textContent = 'Noch keine SMTP-Logs. Nutze "Verbindung testen" oder sende eine Test-Mail.';
});

updateAuthUi();
updateDraftSelectOptions(getSelectedDraftName());
updateTableSelectOptions(getSelectedTableName());
loadDraft(false);
updateEditorVariables();
if (!recipients.length && elements.rawRecipients.value.trim()) {
  parseCurrentInput();
}
updateTable();
updatePreview();
initStudio();
activatePage("message");

function renderSidebarDrafts(collection, activeName) {
  const list = document.querySelector('#sidebarDrafts');
  if (!list) return;
  list.innerHTML = Object.values(collection).sort((a,b) => String(b.savedAt).localeCompare(String(a.savedAt))).map(d => `<button type="button" data-draft="${escapeHtml(d.draftName)}" class="${d.draftName === activeName ? 'active' : ''}" title="${escapeHtml(d.draftName)}">${escapeHtml(d.draftName)}</button>`).join('');
}

function cleanEditorHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,svg,math').forEach(el => el.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || ['srcdoc','srcset'].includes(attr.name) || (['href','src'].includes(attr.name) && !/^(https?:|mailto:|\{\{)/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

function buttonChip(label, target, variant = 'gradient') {
  const span = document.createElement('span');
  span.className = 'mail-button';
  span.contentEditable = 'false';
  span.dataset.label = label;
  span.dataset.target = target;
  span.dataset.variant = variant;
  span.textContent = label + ' ↗';
  span.title = target + ' · Klicken zum Bearbeiten';
  return span.outerHTML;
}

function visualHtml(source) {
  return cleanEditorHtml(source
    .replace(/button\{\{\s*([^,}]+)\s*,\s*([^,}]+?)(?:\s*,\s*([a-z]+))?\s*\}\}/gi, (_, label, target, variant) => buttonChip(label.trim(), target.trim(), variant || 'gradient'))
    .replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^|}]+?)(?:\|\s*([a-z]+))?\s*\}\}/gi, (_, label, target, variant) => buttonChip(label.trim(), target.trim(), variant || 'gradient')));
}

function syncVisualEditor() {
  const editor = document.querySelector('#visualEditor');
  if (editor.dataset.source !== elements.body.value) {
    editor.innerHTML = visualHtml(elements.body.value);
    editor.dataset.source = elements.body.value;
  }
}

function commitVisualEditor() {
  const editor = document.querySelector('#visualEditor');
  const clone = editor.cloneNode(true);
  const macros = [];
  clone.querySelectorAll('.mail-button').forEach(el => { const index = macros.push(`button{{${el.dataset.label},${el.dataset.target},${el.dataset.variant || 'gradient'}}}`) - 1; el.replaceWith(document.createComment(`mail-button-${index}`)); });
  elements.body.value = clone.innerHTML.replace(/<!--mail-button-(\d+)-->/g, (_,index) => macros[Number(index)]);
  editor.dataset.source = elements.body.value;
  updatePreview();
  queueAutosave();
}

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (selection.rangeCount && document.querySelector('#visualEditor').contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
}

function restoreEditorSelection() {
  const editor = document.querySelector('#visualEditor');
  editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) selection.addRange(savedEditorRange);
  else { const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); selection.addRange(range); }
}

function insertEditorHtml(html) {
  restoreEditorSelection();
  document.execCommand('insertHTML', false, html);
  rememberEditorSelection();
  commitVisualEditor();
}

function readDesignSettings() {
  return {layout:document.querySelector('[name="layout"]:checked').value,accent:document.querySelector('#designAccent').value,background:document.querySelector('#designBackground').value,font:document.querySelector('#designFont').value,padding:Number(document.querySelector('#designPadding').value),width:Number(document.querySelector('#designWidth').value)};
}

function restoreDesignSettings(settings) {
  settings ||= {layout:"letter",accent:"#0a2d57",background:"#f5f5f4",font:"Arial,Helvetica,sans-serif",padding:32,width:600};
  for (const [key,id] of Object.entries({accent:'designAccent',background:'designBackground',font:'designFont',padding:'designPadding',width:'designWidth'})) {
    if (settings[key] != null) document.getElementById(id).value = settings[key];
  }
  const layout = document.querySelector(`[name="layout"][value="${settings.layout === 'card' ? 'card' : 'letter'}"]`);
  layout.checked = true;
}


function withClubLogo(template) {
  if (!template) return template;
  let result = template;
  if (!result.includes(clubEmailLogoUrl)) {
    result = result.replace(/(<td\b(?=[^>]*class="[^"]*\blogo-container\b)[^>]*>)[\s\S]*?(<\/td>)/i,
      `$1<img src="${clubEmailLogoUrl}" width="320" alt="TUM Social AI Club" style="display:block;width:320px;max-width:100%;height:auto;border:0;">$2`);
  }
  return result
    .replace('.logo-container { padding: 12px 20px !important; }', '.logo-container { height:66px !important; padding:0 16px !important; }')
    .replace('style="padding:0 0 14px;background:#ffffff;"', 'style="padding:0 0 16px;background:#ffffff;"')
    .replace('style="padding:0;background:#ffffff;"', 'style="padding:0 0 16px;background:#ffffff;"')
    .replace('style="background:#ffffff;border:1px solid rgba(10,45,87,0.10);border-radius:24px;box-shadow:0 12px 28px rgba(10,45,87,0.16);"', 'style="height:66px;background:#ffffff;border:1px solid rgba(10,45,87,0.10);border-radius:24px;border-collapse:separate;overflow:hidden;box-shadow:0 4px 12px rgba(10,45,87,0.06);"')
    .replace('style="padding:24px 20px;vertical-align:middle;background:#ffffff;border-radius:24px;"', 'height="66" style="height:66px;padding:0 16px;vertical-align:middle;background:#ffffff;border-radius:24px;"')
    .replace('border-radius:26px;overflow:hidden;box-shadow:0 18px 48px rgba(10,45,87,0.10);', 'border-radius:24px;overflow:hidden;box-shadow:0 8px 20px rgba(10,45,87,0.06);');
}

function buildDesignTemplate() {
  const d = readDesignSettings();
  const card = d.layout === 'card';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>body{margin:0}p{line-height:1.7;margin:0 0 20px}h2{font-size:24px;line-height:1.3;margin:0 0 22px}a{color:${d.accent}}@media(max-width:480px){.mail-content{padding:24px 20px!important}.mail-outer{padding:12px 0!important}}</style></head><body data-mail-accent="${d.accent}" data-mail-font="${d.font.includes('Georgia')?'serif':'sans'}" style="margin:0;background:${card?d.background:'#ffffff'};font-family:${d.font};color:#303830"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="mail-outer" style="padding:${card?'32px 12px':'16px 0'}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:${d.width}px;margin:auto;background:white;${card?'border-radius:12px;':''}"><tr><td height="66" style="height:66px;padding:0 16px;vertical-align:middle;background:#fff;border:1px solid rgba(10,45,87,0.10);border-radius:24px;border-collapse:separate;overflow:hidden;box-shadow:0 4px 12px rgba(10,45,87,0.06)"><img src="${clubEmailLogoUrl}" width="320" alt="TUM Social AI Club" style="display:block;width:320px;max-width:100%;height:auto;border:0"></td></tr><tr><td height="16" style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr><tr><td class="mail-content" style="padding:${d.padding}px;font-size:15px;border:1px solid rgba(10,45,87,0.08);border-radius:24px;box-shadow:0 8px 20px rgba(10,45,87,0.06)">{{content}}</td></tr></table></td></tr></table></body></html>`;
}

function updateDesignPreview() {
  document.querySelector('#paddingValue').textContent = document.querySelector('#designPadding').value + ' px';
  document.querySelector('#designPreview').srcdoc = renderHtmlMessage(buildDesignTemplate(), elements.body.value, recipients[previewIndex] || {name:"Alex Example",email:"alex@example.com"});
}

function syncStudio() {
  syncVisualEditor();
  const select = document.querySelector('#previewSelect');
  const options = recipients.map((r,i) => `<option value="${i}">${escapeHtml(r.name || r.email)}</option>`).join('') || '<option value="0">Beispiel ohne Empfänger</option>';
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = String(previewIndex);
  const checks = [
    [emailPattern.test(elements.accountEmail.value.trim()) && !!elements.appPassword.value.trim(),'Absender und Zugangsdaten eingetragen','Absenderkonto einrichten'],
    [recipients.length > 0,`${recipients.length} Empfänger in der Liste`,'Empfänger hinzufügen'],
    [!!elements.subject.value.trim(),'Betreff vorhanden','Betreff ergänzen'],
    [!!elements.body.value.trim(),'Nachricht vorhanden','Nachricht schreiben'],
    [elements.htmlBody.value.includes('{{content}}'),'Mail-Layout vorhanden','Layout mit {{content}} ergänzen']
  ];
  document.querySelector('#sendChecklist').innerHTML = checks.map(([ok,yes,no])=>`<div class="${ok?'done':''}">${ok?'✓':'○'} &nbsp; ${escapeHtml(ok?yes:no)}</div>`).join('');
}

function initStudio() {
  studioReady = true;
  const editor = document.querySelector('#visualEditor');
  document.addEventListener('selectionchange', rememberEditorSelection);
  editor.addEventListener('input',commitVisualEditor);
  editor.addEventListener('paste',event=>{
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    insertEditorHtml(escapeHtml(text).replace(/\n/g,'<br>'));
  });
  document.querySelector('#visualMode').addEventListener('click',()=>setEditorMode('visual'));
  document.querySelector('#sourceMode').addEventListener('click',()=>setEditorMode('source'));
  document.querySelector('#formatToolbar').addEventListener('mousedown',event=>event.preventDefault());
  document.querySelector('#insertDivider').addEventListener('click',()=>insertEditorHtml('<hr style="border:0;border-top:1px solid #dbe3ec;margin:24px 0;">'));
  document.querySelectorAll('[data-format]').forEach(button=>button.addEventListener('click',()=>{
    restoreEditorSelection(); document.execCommand(button.dataset.format,false,button.dataset.value || null); commitVisualEditor();
  }));
  document.querySelector('#insertButton').addEventListener('click',()=>openLinkDialog('button'));
  document.querySelector('#insertLink').addEventListener('click',()=>openLinkDialog('link'));
  editor.addEventListener('click',event=>{
    const button=event.target.closest('.mail-button');
    if(button) openLinkDialog('button',button);
  });
  document.querySelector('#linkForm').addEventListener('submit',event=>{
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const label=document.querySelector('#linkLabel').value.trim();
    const target=document.querySelector('#linkTarget').value.trim();
    const variant=document.querySelector('#buttonVariant').value;
    const validUrl=/^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(target);
    const validVariable=recipientColumns.some(c=>c.key===target||c.label===target);
    if (!label || /[{},|]/.test(label) || /[{}]/.test(target) || !(validUrl || (linkKind==='button' && validVariable))) {
      document.querySelector('#linkError').textContent='Bitte einen gültigen Link oder eine vorhandene Spaltenvariable verwenden. Die Beschriftung darf keine geschweiften Klammern, Kommas oder | enthalten.'; return;
    }
    const html=linkKind==='button'?buttonChip(label,target,variant):`<a href="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
    document.querySelector('#linkDialog').close();
    if(editingButton) { editingButton.outerHTML=html; commitVisualEditor(); }
    else insertEditorHtml(html);
  });
  document.querySelector('#deleteLink').addEventListener('click',()=>{if(editingButton)editingButton.remove();commitVisualEditor();document.querySelector('#linkDialog').close();});
  document.querySelectorAll('.design-controls input,.design-controls select').forEach(el=>el.addEventListener('input',()=>{
    updateDesignPreview();document.querySelector('#designState').textContent='Auswahl · noch nicht angewendet';
  }));
  document.querySelector('#applyDesign').addEventListener('click',()=>{
    elements.htmlBody.value=buildDesignTemplate();updatePreview();queueAutosave();document.querySelector('#designState').textContent='Auf Entwurf angewendet';setStatus('Gestaltung auf diesen Entwurf angewendet.','ok');
  });
  document.querySelector('#previewSelect').addEventListener('change',event=>{previewIndex=Number(event.target.value);updatePreview();});
  document.querySelector('#loadedContentPreview').addEventListener('click',()=>setPreviewImagesBlocked(false));
  document.querySelector('#blockedContentPreview').addEventListener('click',()=>setPreviewImagesBlocked(true));
  document.querySelector('#showPreviewImages').addEventListener('click',()=>setPreviewImagesBlocked(false));
  for(const mode of ['desktop','mobile']) document.querySelector(`#${mode}Preview`).addEventListener('click',()=>{
    document.querySelector('.full-preview').classList.toggle('mobile',mode==='mobile');
    document.querySelector('#desktopPreview').classList.toggle('selected',mode==='desktop');
    document.querySelector('#mobilePreview').classList.toggle('selected',mode==='mobile');
  });
  document.querySelector('#testEmail').addEventListener('input',updatePreview);
  document.querySelector('#sidebarDrafts').addEventListener('click',event=>{
    const button=event.target.closest('[data-draft]');if(!button)return;
    clearTimeout(autosaveTimer);saveDraft();
    elements.draftSelect.value=button.dataset.draft;loadDraft(true);activatePage('message');
  });
  document.querySelector('#newDraft').addEventListener('click',()=>{
    clearTimeout(autosaveTimer);saveDraft();
    const collection=readDraftCollection();let name='Neuer Entwurf';let i=2;while(collection[name])name=`Neuer Entwurf ${i++}`;
    setSelectedDraftName(name);elements.draftName.value=name;elements.subject.value='';elements.body.value='<p>Hi {{firstName}},</p><p><br></p><p>Best,<br>The Social AI Club Team</p>';
    recipients=[];syncRawRecipientsFromTable();updateTable();updatePreview();saveDraft();activatePage('message');elements.subject.focus();
  });
  document.querySelector('#deleteDraftButton').addEventListener('click',()=>{
    clearTimeout(autosaveTimer);
    if(!loadDraft(false)){elements.subject.value='';elements.body.value='';recipients=[];syncRawRecipientsFromTable();updateTable();updatePreview();}
  });
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();saveDraft();setStatus('Entwurf gespeichert.','ok');}});
  syncStudio();updateDesignPreview();
}

function setEditorMode(mode) {
  editorMode=mode;
  document.querySelector('#visualEditor').hidden=mode!=='visual';
  document.querySelector('#formatToolbar').hidden=mode!=='visual';
  elements.body.hidden=mode==='visual';
  document.querySelector('#visualMode').classList.toggle('selected',mode==='visual');
  document.querySelector('#sourceMode').classList.toggle('selected',mode==='source');
  if(mode==='visual')syncVisualEditor();
}

function setPreviewImagesBlocked(blocked) {
  previewImagesBlocked = blocked;
  document.querySelector('#loadedContentPreview').classList.toggle('selected', !blocked);
  document.querySelector('#blockedContentPreview').classList.toggle('selected', blocked);
  document.querySelector('#blockedPreviewNotice').hidden = !blocked;
  updatePreview();
}

function openLinkDialog(kind,button=null) {
  rememberEditorSelection();linkKind=kind;editingButton=button;
  document.querySelector('#linkDialogTitle').textContent=kind==='button'?(button?'Button bearbeiten':'Button einfügen'):'Link einfügen';
  document.querySelector('#linkLabel').value=button?.dataset.label||'';
  document.querySelector('#linkTarget').value=button?.dataset.target||'';
  document.querySelector('#buttonVariant').value=button?.dataset.variant||'gradient';
  document.querySelector('#buttonVariantField').hidden=kind!=='button';
  document.querySelector('#linkError').textContent='';
  document.querySelector('#saveLink').textContent=button?'Übernehmen':'Einfügen';
  document.querySelector('#deleteLink').hidden=!button;
  document.querySelector('#linkDialog').showModal();
}
