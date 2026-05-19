const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const draftCollectionStorageKey = "club-mailbot.drafts.v1";
const selectedDraftStorageKey = "club-mailbot.selected-draft.v1";
const tableCollectionStorageKey = "club-mailbot.tables.v1";
const selectedTableStorageKey = "club-mailbot.selected-table.v1";
const autosaveDelayMs = 500;
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
  elements.pages.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === pageName);
  });

  elements.pageLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.pageTarget === pageName);
  });

  const activeLink = elements.pageLinks.find((link) => link.dataset.pageTarget === pageName);
  if (elements.workspaceTitle && activeLink) {
    elements.workspaceTitle.textContent = activeLink.querySelector("span")?.textContent || "Club-Mailbot";
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

function renderButtonMarkup(rawLabel, rawTarget, recipient, mode = "html") {
  const label = renderTemplate(String(rawLabel || "").trim(), recipient);
  const href = renderTemplate(resolveButtonTarget(rawTarget, recipient), recipient);
  if (!href) return mode === "html" ? "" : label;
  if (mode === "text") {
    return `${label}: ${href}`;
  }
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 32px;">
  <tr>
    <td style="border-radius:12px;background-color:#0a2d57;background:#0a2d57;">
      <a href="${escapeHtml(href)}" data-club-mailbot-button="true" style="display:inline-block;color:#ffffff;text-decoration:none;border-radius:12px;padding:14px 24px;font-weight:800;font-size:16px;line-height:1.1;background:#0a2d57;">
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
  const value = resolveTemplateVariable(key, ensureRequiredRecipientFields(recipient || {}));
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
  working = working.replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^}]+)\s*\}\}/gi, (_, rawLabel, rawTarget) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, "html"))
  ));
  working = working.replace(/button\{\{\s*([^,}]+)\s*,\s*([^}]+)\s*\}\}/gi, (_, rawLabel, rawTarget) => (
    pushToken(renderButtonMarkup(rawLabel, rawTarget, recipient, "html"))
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
  return renderTemplate(String(designTemplate || "").replaceAll("{{content}}", contentHtml), recipient);
}

function insertVariableAtCursor(variableName) {
  const placeholder = `{{${variableName}}}`;
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
    elements.htmlBody.value = draft.htmlBody || "";
    elements.delayMs.value = draft.delayMs || "1200";

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
  const recipient = recipients[0];
  const renderedHtml = renderHtmlMessage(elements.htmlBody.value, elements.body.value, recipient);
  if (elements.messagePreviewRecipient) {
    elements.messagePreviewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "kein Empfänger";
  }
  if (elements.messagePreviewSubject) {
    elements.messagePreviewSubject.textContent = renderTemplate(elements.subject.value, recipient);
  }
  if (elements.messageHtmlPreview) {
    elements.messageHtmlPreview.srcdoc = renderedHtml || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">Noch kein HTML-Design vorhanden.</p>";
  }
  elements.previewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "kein Empfänger";
  elements.previewSubject.textContent = renderTemplate(elements.subject.value, recipient);
  if (document.activeElement !== elements.previewBody) {
    elements.previewBody.value = elements.body.value;
  }
  elements.htmlPreview.srcdoc = renderedHtml || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">Noch kein HTML-Design vorhanden.</p>";

  const canSend = Boolean(
    elements.accountEmail.value.trim()
      && elements.appPassword.value.trim()
      && elements.subject.value.trim()
      && (elements.body.value.trim() || elements.htmlBody.value.trim())
      && recipients.length
  );
  elements.testButton.disabled = !canSend;
  elements.sendButton.disabled = !canSend;
  if (elements.summaryReady) {
    elements.summaryReady.textContent = canSend ? "Ja" : "Nein";
  }
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
  if (!recipients.length) return;

  const verb = testOnly ? "Test-Mail" : `${recipients.length} Mails`;
  const confirmed = testOnly || window.confirm(`${verb} über ${elements.accountEmail.value.trim()} senden?`);
  if (!confirmed) return;

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
        testOnly
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
  const selectedName = normalizeDraftName(elements.draftSelect.value);
  if (selectedName) {
    elements.draftName.value = selectedName;
    setSelectedDraftName(selectedName);
  }
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
if (!recipients.length) {
  parseCurrentInput();
}
updateTable();
updatePreview();
activatePage("overview");
