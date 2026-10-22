let serverSendActive = false;
const editorUndo = [];
const editorRedo = [];
let restoringEditorHistory = false;
let persistCollection = () => Promise.reject(new Error("Storage is not ready."));
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
  { key: "email", label: "Email", role: "to" },
  { key: "interviewLink", label: "Interview link", role: "text" }
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
  importDraftButton: document.querySelector("#importDraftButton"),
  exportDraftButton: document.querySelector("#exportDraftButton"),
  draftJsonFile: document.querySelector("#draftJsonFile"),
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
let recipientEditing = false;
let uiInitialized = false;
let pendingReusableList = null;
let pendingListIsCurrent = false;
let audienceSource = null;
let recipientColumns = [...defaultRecipientColumns];
let parseStats = { invalid: 0, duplicates: 0 };
let autosaveTimer = null;
let isHydratingDraft = false;

function activatePage(pageName) {
  if (pageName === 'design') {
    pageName = 'message';
    document.querySelector('#designDetails').open = true;
    if (studioReady) updateDesignPreview();
  }
  if (pageName === 'send' || pageName === 'preview') pageName = 'review';
  document.querySelectorAll(".page-nav .page-link").forEach(link => link.setAttribute("aria-current", link.dataset.pageTarget === pageName ? "page" : "false"));
  elements.pages.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === pageName);
  });

  elements.pageLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.pageTarget === pageName);
  });

  const titles = {recipients:'Recipients', message:'Message', review:'Review & send', contacts:'Contacts & lists', account:'Settings'};
  const activeLink = elements.pageLinks.find((link) => link.dataset.pageTarget === pageName);
  if (elements.workspaceTitle && activeLink) {
    elements.workspaceTitle.textContent = titles[pageName] || activeLink.querySelector("span")?.textContent || "Mailbot";
  }
  if (uiInitialized) { history.replaceState(null, '', '#'+pageName); window.scrollTo(0,0); }
  document.dispatchEvent(new CustomEvent('mailbot:page-changed', {detail:{page:pageName}}));
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
    .replaceAll("\u00e4", "ae")
    .replaceAll("\u00f6", "oe")
    .replaceAll("\u00fc", "ue")
    .replaceAll("\u00df", "ss");
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
    .map((header) => {
      const column = canonicalColumnFromHeader(header);
      const baseKey = column.key || "property";
      let suffix = 2;
      while (seen.has(column.key)) column.key = `${baseKey}${suffix++}`;
      seen.add(column.key);
      return column;
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
  const hasHeader = rows.length > 0 && looksLikeHeader(rows[0]);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columns = hasHeader ? buildColumnsFromHeaders(rows[0]) : buildColumnsForDataRows(dataRows);
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
    firstName: String(record.firstName || (record.notionPageId ? "there" : record.name.split(/\s+/)[0]) || ""),
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

function previewHtmlWithLocalSocialIcons(html) {
  const icons = { "LinkedIn-app-icon.png": "linkedin.png", "instagram-app-icon.png": "instagram.png", "luma-app-icon.png": "luma.png" };
  return String(html || "").replace(/https:\/\/tum-socialaiclub\.de\/assets\/socials-logos\/(LinkedIn-app-icon\.png|instagram-app-icon\.png|luma-app-icon\.png)/g, (_url, name) => `/social-icons/${icons[name]}`);
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
  working = working.replace(/href=(["'])\{\{\s*([^}]+)\s*\}\}\1/gi, (_match, quote, rawTarget) => {
    const href = normalizeLinkTarget(resolveButtonTarget(rawTarget, recipient), recipient);
    return `href=${quote}${escapeHtml(href)}${quote}`;
  });
  working = working.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawKey) => pushToken(renderVariableValue(rawKey, recipient)));
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
  return includeEmailFonts(constrainLogoDimensions(result));
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
    recipientColumns.map((column) => String(column.key || column.label || "").trim()).filter(Boolean)
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
      .map((column) => String(column.key || "").trim())
      .filter(Boolean)
      .filter((label) => !isConformVariableLabel(label));

    elements.recipientVariableWarning.textContent = invalidLabels.length
      ? `Warning: These column names are awkward as placeholders because they contain spaces or special characters: ${invalidLabels.join(", ")}. Use names like firstName or interviewLink.`
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
  if (!trace.length) return "No SMTP trace data received.";
  return trace
    .map((entry) => {
      const label = entry.direction === "C" ? "CLIENT" : entry.direction === "S" ? "SERVER" : "INFO";
      return `[${new Date(entry.at).toLocaleTimeString("en-GB")}] ${label} ${entry.message}`;
    })
    .join("\n");
}

function showLogs(trace = [], heading = "") {
  const body = formatTrace(trace);
  elements.smtpLogs.textContent = heading ? `${heading}\n${body}` : body;
}

function updateAuthUi() {
  const isOauth = elements.authMode.value === "xoauth2";
  elements.secretLabel.textContent = isOauth ? "OAuth Access Token" : "App password";
  elements.appPassword.placeholder = isOauth ? "ya29... Access Token" : "16-character app password";
}

function syncRawRecipientsFromTable() {
  const rows = recipients.map((recipient) => recipientColumns.map((column) => {
    const value = String(recipient[column.key] || "");
    return /["\n\t]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }));

  elements.rawRecipients.value = rows.map((row) => row.join("\t")).join("\n");
}

function collectDraft() {
  const draftName = String(elements.draftName.value || "").trim() || "Untitled draft";
  return {
    draftName,
    tableName: normalizeTableName(elements.tableName?.value),
    accountEmail: elements.accountEmail.value.trim(),
    authMode: elements.authMode.value,
    smtpSecurity: elements.smtpSecurity.value,
    fromName: elements.fromName.value.trim(),
    recipientColumns,
    recipients,
    audienceSource,
    subject: elements.subject.value,
    body: elements.body.value,
    htmlBody: elements.htmlBody.value,
    delayMs: elements.delayMs.value,
    designSettings: studioReady ? readDesignSettings() : undefined,
    savedAt: new Date().toISOString()
  };
}

function normalizeDraftName(value) {
  return String(value || "").trim() || "Untitled draft";
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
  persistCollection("drafts", collection).then(() => setSaveStatus("Saved to this computer. The app password was not saved.")).catch(() => setSaveStatus("Saved in this browser only. Disk save failed; retry saving."));
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
  const names = Object.keys(collection).sort((left, right) => left.localeCompare(right, "en"));
  const fallback = names.length ? names[0] : "";
  const activeName = selectedName && collection[selectedName] ? selectedName : fallback;

  if (!names.length) {
    elements.draftSelect.innerHTML = '<option value="">No saved drafts</option>';
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
  return String(value || "").trim() || "Default list";
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
  persistCollection("lists", collection).then(() => setTableSaveStatus("List saved to this computer.")).catch(() => setTableSaveStatus("Saved in this browser only. Disk save failed; retry saving."));
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
  const names = Object.keys(collection).sort((left, right) => left.localeCompare(right, "en"));
  const fallback = names.length ? names[0] : "";
  const activeName = selectedName && collection[selectedName] ? selectedName : fallback;

  if (!names.length) {
    elements.tableSelect.innerHTML = '<option value="">No saved lists</option>';
    elements.tableSelect.value = "";
    if (elements.deleteTableButton) elements.deleteTableButton.disabled = true;
    document.dispatchEvent(new CustomEvent('mailbot:lists-changed'));
    return;
  }

  elements.tableSelect.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  elements.tableSelect.value = activeName;
  if (elements.deleteTableButton) elements.deleteTableButton.disabled = false;
  document.dispatchEvent(new CustomEvent('mailbot:lists-changed'));
}

function formatSavedAt(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
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
      setSaveStatus("A draft with this name already exists. Choose another name.");
      return false;
    }
    if (previousName !== draft.draftName) delete collection[previousName];
    collection[draft.draftName] = draft;
    writeDraftCollection(collection);
    updateDraftSelectOptions(draft.draftName);
    setSelectedDraftName(draft.draftName);
    setSaveStatus(`Saved: ${formatSavedAt(draft.savedAt)}. The app password was not saved.`);
    return true;
  } catch {
    setSaveStatus("Could not save in this browser.");
    return false;
  }
}

function collectTableState() {
  return {
    tableName: normalizeTableName(elements.tableName?.value),
    recipientColumns,
    recipients,
    audienceSource,
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
    setTableSaveStatus(`List saved: ${formatSavedAt(table.savedAt)}`);
    return true;
  } catch {
    setTableSaveStatus("Could not save the list.");
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

function hydrateRecipientData(columns, rows, source = null) {
  audienceSource = source;
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
    hydrateRecipientData(table.recipientColumns, table.recipients, table.audienceSource);
    updateTable();
    updatePreview();
    updateTableSelectOptions(normalizeTableName(table.tableName));
    setSelectedTableName(table.tableName);
    document.dispatchEvent(new CustomEvent('mailbot:list-loaded', { detail: { source: audienceSource } }));
    if (showStatus) {
      setTableSaveStatus(`List loaded: ${formatSavedAt(table.savedAt)}`);
    }
    return true;
  } catch {
    setTableSaveStatus("Could not load the saved list.");
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
    if (showStatus) setTableSaveStatus("No saved list with this name was found.");
    return false;
  }

  return applyTableState(table, showStatus);
}

function deleteTableState() {
  const selectedName = normalizeTableName(elements.tableSelect?.value || elements.tableName?.value);
  const collection = readTableCollection();

  if (!collection[selectedName]) {
    setTableSaveStatus("No saved list to delete was found.");
    return false;
  }

  delete collection[selectedName];

  try {
    writeTableCollection(collection);
    const remainingNames = Object.keys(collection).sort((left, right) => left.localeCompare(right, "en"));
    const nextName = remainingNames[0] || "Default list";
    updateTableSelectOptions(nextName);
    setSelectedTableName(nextName);
    setTableSaveStatus(`List "${selectedName}" deleted.`);
    return true;
  } catch {
    setTableSaveStatus("Could not delete the list.");
    return false;
  }
}

function applyDraft(draft, showStatus = true) {
  try {
    isHydratingDraft = true;
    elements.draftName.value = normalizeDraftName(draft.draftName);
    if (elements.tableName && (draft.tableName || draft.audienceSource)) elements.tableName.value = draft.tableName || getSelectedTableName() || "Notion audience";
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
      hydrateRecipientData(draft.recipientColumns, draft.recipients, draft.audienceSource);
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
      setSaveStatus(`Loaded: ${formatSavedAt(draft.savedAt)}. Re-enter the app password.`);
    }
    return true;
  } catch {
    setSaveStatus("Could not read saved data.");
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
    if (showStatus) setSaveStatus("No saved draft with this name was found.");
    return false;
  }

  return applyDraft(draft, showStatus);
}

function deleteDraft() {
  const selectedName = normalizeDraftName(elements.draftSelect.value || elements.draftName.value);
  const collection = readDraftCollection();

  if (!collection[selectedName]) {
    setSaveStatus("No saved draft to delete was found.");
    return false;
  }

  delete collection[selectedName];

  try {
    writeDraftCollection(collection);
    const remainingNames = Object.keys(collection).sort((left, right) => left.localeCompare(right, "en"));
    const nextName = remainingNames[0] || "Untitled draft";
    elements.draftName.value = nextName;
    updateDraftSelectOptions(nextName);
    setSelectedDraftName(nextName);
    setSaveStatus(`Draft "${selectedName}" deleted.`);
    return true;
  } catch {
    setSaveStatus("Could not delete the draft.");
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
  recipientEditing = true;
  document.querySelector("#editTableMode").checked = true;
  const emptyRecipient = Object.fromEntries(recipientColumns.map((column) => [column.key, ""]));
  recipients.push(ensureRequiredRecipientFields(emptyRecipient));
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function addColumn() {
  const rawLabel = window.prompt("New column name", "interviewLink");
  if (!rawLabel) return;
  const label = rawLabel.trim();
  if (!label) return;
  const nextColumn = canonicalColumnFromHeader(label);

  if (recipientColumns.some((column) => column.key === nextColumn.key)) {
    setStatus(`Column "${nextColumn.label}" already exists.`, "error");
    return;
  }

  recipientColumns.push(nextColumn);
  recipients = recipients.map((recipient) => ({ ...recipient, [nextColumn.key]: String(recipient[nextColumn.key] || "") }));
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus(`Column "${nextColumn.label}" added.`, "ok");
}

function deleteColumn(index) {
  const column = recipientColumns[index];
  if (!column) return;
  if (recipientColumns.length <= 1) {
    setStatus("At least one column must remain.", "error");
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
  setStatus(`Column "${column.label}" deleted.`, "ok");
}

function renameColumn(index, nextLabel) {
  const trimmed = String(nextLabel || "").trim();
  if (!trimmed) return;
  const current = recipientColumns[index];
  const next = canonicalColumnFromHeader(trimmed);
  next.role = recipientColumns[index].role || next.role;

  if (recipientColumns.some((column, columnIndex) => columnIndex !== index && column.key === next.key)) {
    setStatus(`Column "${next.label}" already exists.`, "error");
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

function recipientField(recipient, label) {
  const column = recipientColumns.find(c => c.label.toLowerCase() === label.toLowerCase());
  return String(recipient[column?.key || label] || '');
}

function recipientApplication(recipient) {
  const complete = recipientField(recipient, 'Completed applications');
  const partial = recipientField(recipient, 'Incomplete applications');
  return [complete ? `${complete} · completed` : '', partial ? `${partial} · incomplete` : ''].filter(Boolean).join('; ') || '—';
}

function updateTable() {
  const purposeNames = {deadline:'Application deadline',newsletter:'Newsletter',recruiting:'Recruiting invitation',reminder:'Application reminder',browse:'Contact review'};
  const audienceContext = document.querySelector('#audienceContext');
  if (audienceContext) audienceContext.textContent = audienceSource
    ? `Notion snapshot · ${purposeNames[audienceSource.purpose] || 'Saved audience'} · updated ${formatSavedAt(audienceSource.loadedAt)}${audienceSource.purpose === 'browse' ? ' · Review only' : ''}`
    : recipients.length ? 'Local list · Saved with this campaign' : 'Notion, a saved list, or a CSV import.';
  const audienceName = document.querySelector('#activeAudienceName');
  if (audienceName) audienceName.textContent = recipients.length || audienceSource ? normalizeTableName(elements.tableName?.value) : 'No recipients selected';
  const changeButton = document.querySelector('#changeRecipients');
  if (changeButton) { changeButton.textContent = recipients.length ? 'Change audience' : 'Choose recipients'; changeButton.classList.toggle('primary', !recipients.length); }
  const refresh = document.querySelector('#refreshAudience'); if (refresh) refresh.hidden = !audienceSource?.sourceId;
  const save = document.querySelector('#openSaveList'); if (save) save.disabled = !recipients.length;
  if (elements.addRecipientButton) { elements.addRecipientButton.disabled = Boolean(audienceSource?.sourceId); elements.addRecipientButton.title = audienceSource?.sourceId ? 'Add new contacts in Notion, then refresh this audience.' : ''; }
  elements.recipientCount.textContent = `${recipients.length} recipients`;
  elements.duplicateCount.textContent = `${parseStats.duplicates} duplicates`;
  elements.invalidCount.textContent = `${parseStats.invalid} invalid`;
  if (elements.summaryRecipientCount) elements.summaryRecipientCount.textContent = String(recipients.length);
  if (!recipientEditing) {
    elements.recipientHead.innerHTML = '<tr><th>Name</th><th>Email</th><th>Lists</th><th><span class="sr-only">Contact details</span></th></tr>';
    elements.recipientRows.innerHTML = recipients.length ? recipients.map((row,index)=>`<tr><td>${escapeHtml(row.name || '—')}</td><td>${escapeHtml(row.email)}</td><td><div class="contact-list-tags">${(recipientField(row,'Lists') || [recipientApplication(row),recipientField(row,'Origins')].filter(x=>x&&x!=='—').join('; ') || 'Local list').split('; ').map(tag=>`<span>${escapeHtml(tag)}</span>`).join('')}</div></td><td><button type="button" class="ghost" data-contact-details="${index}" aria-label="Details for ${escapeHtml(row.name || row.email)}">Details</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-table">Choose recipients to build this campaign’s audience.</td></tr>';
    updateEditorVariables();
    return;
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
              aria-label="Column name ${escapeHtml(column.label)}"
            />
            <button type="button" class="table-icon-button" data-delete-column="${index}" aria-label="Delete column">×</button>
          </div>
          <select class="table-role-select" data-column-role-index="${index}" aria-label="Delivery role ${escapeHtml(column.label)}">
            <option value="text" ${column.role === "text" ? "selected" : ""}>Text</option>
            <option value="to" ${column.role === "to" ? "selected" : ""} >To</option>
            <option value="cc" ${column.role === "cc" ? "selected" : ""}>Cc</option>
            <option value="bcc" ${column.role === "bcc" ? "selected" : ""}>Bcc</option>
            <option value="replyTo" ${column.role === "replyTo" ? "selected" : ""}>Reply-To</option>
          </select>
        </th>
      `).join("")}
      <th>Action</th>
      <th><button type="button" class="table-icon-button table-add-column" data-add-column="true" aria-label="Add column">+</button></th>
    </tr>
  `;

  if (!recipients.length) {
    elements.recipientRows.innerHTML = `<tr><td colspan="${recipientColumns.length + 2}">No recipients detected yet.</td></tr>`;
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
        <td><button type="button" class="ghost mini-button" data-remove-row="${rowIndex}">Delete</button></td>
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
    elements.messagePreviewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "No recipient";
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
    messagePreview.srcdoc = previewHtmlWithLocalSocialIcons(renderedHtml) || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">No email design yet.</p>";
  }
  elements.previewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "No recipient";
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
  elements.htmlPreview.srcdoc = previewHtmlWithBlockedImages(previewHtmlWithLocalSocialIcons(renderedHtml) || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">No email design yet.</p>");

  const canSend = Boolean(
    emailPattern.test(elements.accountEmail.value.trim())
      && elements.appPassword.value.trim()
      && elements.subject.value.trim()
      && elements.body.value.trim()
      && elements.htmlBody.value.includes("{{content}}")
      && recipients.length
  );
  elements.testButton.disabled = sending || !canSend || !emailPattern.test(document.querySelector("#testEmail").value.trim());
  elements.sendButton.disabled = serverSendActive || sending || !canSend || audienceSource?.purpose === "browse";
  if (elements.summaryReady) {
    elements.summaryReady.textContent = canSend && audienceSource?.purpose !== "browse" ? "Yes" : "No";
  }
  if (studioReady) syncStudio();
}

async function testAuth() {
  if (!elements.accountEmail.value.trim() || !elements.appPassword.value.trim()) {
    setStatus("Gmail address and app password/OAuth token are required.", "error");
    showLogs([], "Connection test not started.");
    return;
  }

  elements.testAuthButton.disabled = true;
  setStatus("Testing SMTP connection...", "");
  showLogs([], "SMTP connection test running...");

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
    showLogs(payload.trace || [], response.ok ? "Connection test successful." : "Connection test failed.");

    if (!response.ok) {
      throw new Error(payload.error || "Connection test failed.");
    }

    setStatus("Gmail SMTP login successful. You can now send a test email.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.testAuthButton.disabled = false;
    updatePreview();
  }
}

function parseCurrentInput() {
  audienceSource = null;
  // A new import must not inherit a previous Notion list's column order.
  recipientColumns = [...defaultRecipientColumns];
  recipients = parseRecipients(elements.rawRecipients.value);
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  setStatus(`${recipients.length} valid recipients detected. The list is ready to edit.`, recipients.length ? "ok" : "error");
}

async function send(testOnly) {
  if (!recipients.length || sending) return;
  const testEmail = document.querySelector("#testEmail").value.trim();
  if (testOnly && !emailPattern.test(testEmail)) { setStatus("Enter a valid test address.", "error"); return; }

  const verb = testOnly ? "Test email" : `${recipients.length} emails`;
  const confirmed = testOnly || window.confirm(`Send ${verb} from ${elements.accountEmail.value.trim()}?`);
  if (!confirmed) return;

  sending = true;
  elements.testButton.disabled = true;
  elements.sendButton.disabled = true;
  setStatus(`Sending ${verb}... Keep this browser tab open.`);

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
        draftName: elements.draftName.value.trim(),
        subject: elements.subject.value,
      body: elements.body.value,
        htmlBody: elements.htmlBody.value,
        recipientColumns,
        recipients,
        audienceSource,
        delayMs: Number(elements.delayMs.value),
        testOnly,
        testEmail,
        previewIndex
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      showLogs(payload.trace || [], payload.error ? `Send blocked: ${payload.error}` : "Send failed.");
      throw new Error(payload.error || "Send failed.");
    }

    const failed = payload.results.filter((result) => !result.ok);
    const auditWarnings = payload.results.filter(result => result.auditWarning);
    const lastTrace = payload.results.find((result) => result.trace?.length)?.trace || payload.trace || [];
    showLogs(lastTrace, failed.length ? "SMTP trace contains an error." : "SMTP trace successful.");
    if (failed.length) {
      setStatus(`${payload.sent}/${payload.total} sent. Failed for: ${failed.map((item) => item.email).join(", ")}`, "error");
    } else if (auditWarnings.length) {
      setStatus(`${payload.sent}/${payload.total} sent. Notion history needs synchronization for ${auditWarnings.length} emails. Do not resend.`, 'error');
    } else {
      setStatus(`${payload.sent}/${payload.total} sent successfully.${payload.skipped ? ` ${payload.skipped} already sent emails skipped.` : ''}`, "ok");
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
  elements.tableName.value = 'Imported recipients';
  updateTable();
  document.querySelector('#audienceDialog').close();
  queueAutosave();
});

elements.addRecipientButton.addEventListener("click", addRecipient);

elements.saveTableButton?.addEventListener('click', () => {
  if (!pendingReusableList) return;
  const name = normalizeTableName(document.querySelector('#reusableListName').value);
  try {
    const table = {...pendingReusableList,tableName:name,savedAt:new Date().toISOString()};
    const collection = readTableCollection(); collection[name] = table; writeTableCollection(collection);
    updateTableSelectOptions(name); setSelectedTableName(name);
    if (pendingListIsCurrent) { elements.tableName.value = name; updateTable(); saveDraft(); }
    document.querySelector('#saveListDialog').close();
    setTableSaveStatus(`Saved reusable list: ${name}`); setStatus('Reusable list saved locally.','ok');
  } catch { setStatus('Could not save the list. Check browser storage and retry.','error'); }
});

elements.loadTableButton?.addEventListener('click', () => {
  const selected = readTableCollection()[elements.tableSelect.value];
  if (selected?.audienceSource?.purpose === 'browse') { document.dispatchEvent(new CustomEvent('mailbot:review-list-selected', {detail:{source:selected.audienceSource}})); return; }
  const loaded = loadTableState(true);
  if (loaded) { document.querySelector('#audienceDialog').close(); saveDraft(); activatePage('recipients'); }
  setStatus(loaded ? 'Saved audience attached to this campaign.' : 'Could not load the list.', loaded ? 'ok' : 'error');
});

elements.deleteTableButton?.addEventListener("click", () => {
  const deleted = deleteTableState();
  setStatus(deleted ? "Recipient list deleted." : "Could not delete the list.", deleted ? "ok" : "error");
});

elements.clearButton.addEventListener("click", () => {
  elements.rawRecipients.value = "";
  recipientColumns = [...defaultRecipientColumns];
  recipients = [];
  audienceSource = null;
  parseStats = { invalid: 0, duplicates: 0 };
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus("List cleared.");
});

elements.saveDraftButton.addEventListener("click", () => {
  const saved = saveDraft();
  setStatus(
    saved ? "Sender details, recipient list, and email template were saved locally." : "Could not save in this browser.",
    saved ? "ok" : "error"
  );
});

elements.loadDraftButton.addEventListener("click", () => {
  const loaded = loadDraft(true);
  setStatus(loaded ? "Saved data loaded." : "No saved data found.", loaded ? "ok" : "error");
});

elements.importDraftButton.addEventListener("click", () => elements.draftJsonFile.click());
elements.draftJsonFile.addEventListener("change", async () => {
  const file = elements.draftJsonFile.files?.[0];
  elements.draftJsonFile.value = "";
  if (!file) return;
  try {
    const draft = JSON.parse(await file.text());
    if (!draft || typeof draft !== "object" || !draft.draftName) throw new Error("This file is not a Mailbot draft JSON.");
    if (!applyDraft(draft, false)) throw new Error("Mailbot could not load this draft.");
    saveDraft();
    activatePage("message");
    setStatus("Imported CLI draft “" + draft.draftName + "”. Re-enter sender credentials if needed.", "ok");
  } catch (error) {
    setStatus(error.message || "Could not import this draft.", "error");
  }
});
elements.exportDraftButton.addEventListener("click", () => {
  const content = JSON.stringify(collectDraft(), null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = (elements.draftName.value.trim() || "mailbot-draft").replace(/[^a-z0-9._-]+/gi, "-") + ".json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Draft JSON exported without account credentials.", "ok");
});

elements.deleteDraftButton.addEventListener("click", () => {
  const deleted = deleteDraft();
  setStatus(deleted ? "Saved draft deleted." : "Could not delete the draft.", deleted ? "ok" : "error");
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
  setStatus('CSV ready. Choose “Use imported recipients” to attach it.');
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

[elements.authMode, elements.smtpSecurity].forEach((element) => {
  element.addEventListener("change", () => {
    updateAuthUi();
    updatePreview();
    queueAutosave();
  });
});

elements.delayMs.addEventListener("change", queueAutosave);
elements.testButton.addEventListener("click", () => send(true));
elements.sendButton.addEventListener("click", () => send(false));
elements.testAuthButton.addEventListener("click", testAuth);
elements.clearLogsButton.addEventListener("click", () => {
  elements.smtpLogs.textContent = 'No SMTP logs yet. Use “Test connection” or send a test email.';
});

try {
  const workspaceStorage = await import('./workspace-store.js');
  persistCollection = workspaceStorage.persistCollection;
  await workspaceStorage.restoreWorkspace({ drafts: draftCollectionStorageKey, lists: tableCollectionStorageKey });
} catch { setSaveStatus("Disk storage is unavailable. Browser copies are still available; retry saving when the server is running."); }
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
  span.title = target + ' · Click to edit';
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
    editorUndo.length = 0; editorRedo.length = 0; recordEditorHistory();
  }
}

function commitVisualEditor() {
  recordEditorHistory();
  const editor = document.querySelector('#visualEditor');
  const clone = editor.cloneNode(true);
  // Browser formatting commands can leave empty wrappers behind.
  [...clone.querySelectorAll('span')].reverse().forEach(span => {
    const choice = span.dataset.mailFontChoice;
    if (['Albert Sans','League Spartan'].includes(choice)) span.style.fontFamily = `'${choice}',Arial,Helvetica,sans-serif`;
    if (!span.getAttribute('style')?.trim() && !choice && [...span.attributes].every(attr=>['style','data-mail-typography'].includes(attr.name))) span.replaceWith(...span.childNodes);
  });
  const macros = [];
  clone.querySelectorAll('.mail-button').forEach(el => { const index = macros.push(`button{{${el.dataset.label},${el.dataset.target},${el.dataset.variant || 'gradient'}}}`) - 1; el.replaceWith(document.createComment(`mail-button-${index}`)); });
  elements.body.value = clone.innerHTML.replace(/<!--mail-button-(\d+)-->/g, (_,index) => macros[Number(index)]);
  editor.dataset.source = elements.body.value;
  updatePreview();
  queueAutosave();
}

function editorSnapshot() {
  const editor = document.querySelector('#visualEditor');
  const selection = window.getSelection();
  const offsets = [];
  if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
    for (const [node, offset] of [[selection.anchorNode, selection.anchorOffset], [selection.focusNode, selection.focusOffset]]) {
      const range = document.createRange(); range.selectNodeContents(editor); range.setEnd(node, offset); offsets.push(range.toString().length);
    }
  }
  return {html:editor.innerHTML, offsets};
}
function recordEditorHistory() {
  if (restoringEditorHistory) return;
  const snapshot = editorSnapshot();
  if (editorUndo.at(-1)?.html === snapshot.html) return;
  editorUndo.push(snapshot); if (editorUndo.length > 200) editorUndo.shift(); editorRedo.length = 0;
}
function travelEditorHistory(redo = false) {
  const editor = document.querySelector('#visualEditor');
  if (!redo && editorUndo.length < 2 || redo && !editorRedo.length) return;
  if (redo) editorUndo.push(editorRedo.pop()); else editorRedo.push(editorUndo.pop());
  const snapshot = editorUndo.at(-1);
  restoringEditorHistory = true;
  editor.innerHTML = snapshot.html; editor.focus();
  const locate = offset => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { if (offset <= node.length) return [node,offset]; offset -= node.length; }
    return [editor,editor.childNodes.length];
  };
  if (snapshot.offsets.length === 2) window.getSelection().setBaseAndExtent(...locate(snapshot.offsets[0]), ...locate(snapshot.offsets[1]));
  rememberEditorSelection(); commitVisualEditor(); restoringEditorHistory = false;
}
function syncTypographyToolbar() {
  const editor = document.querySelector('#visualEditor'), selection = window.getSelection();
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  const range = selection.getRangeAt(0), nodes = [];
  if (range.collapsed) nodes.push(selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
  else {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) if (node.textContent.trim() && range.intersectsNode(node)) nodes.push(node.parentElement);
  }
  if (!nodes.length) return;
  const styles = nodes.map(node => getComputedStyle(node));
  const fields = [['editorFont', style=>style.fontFamily.split(',')[0].replace(/["']/g,'').trim()], ['editorFontSize', style=>String(Math.round(parseFloat(style.fontSize)))], ['editorFontWeight', style=>style.fontWeight === 'normal' ? '400' : style.fontWeight === 'bold' ? '700' : style.fontWeight]];
  for (const [id,read] of fields) {
    const control = document.getElementById(id), values = [...new Set(styles.map(read))];
    if (document.activeElement === control) continue;
    control.value = values.length === 1 ? values[0] : '';
    control.title = values.length > 1 ? 'Mixed formatting' : values[0];
    if (control.tagName === 'INPUT') control.placeholder = values.length > 1 ? 'Mixed' : '';
  }
  document.querySelectorAll('[data-format="bold"],[data-format="italic"]').forEach(button=>button.setAttribute('aria-pressed',String(document.queryCommandState(button.dataset.format))));
}

function rememberEditorSelection() {
  const selection = window.getSelection();
  if (selection.rangeCount && document.querySelector('#visualEditor').contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
  syncTypographyToolbar();
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
      `$1<img src="${clubEmailLogoUrl}" width="320" height="26" alt="TUM Social AI Club" style="display:block;width:320px;max-width:100%;height:26px;max-height:26px;border:0;">$2`);
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
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>body{margin:0}p{line-height:1.7;margin:0 0 20px}h2{font-size:24px;line-height:1.3;margin:0 0 22px}a{color:${d.accent}}@media(max-width:480px){.mail-content{padding:24px 20px!important}.mail-outer{padding:12px 0!important}}</style></head><body data-mail-accent="${d.accent}" data-mail-font="${d.font.includes('Georgia')?'serif':'sans'}" style="margin:0;background:${card?d.background:'#ffffff'};font-family:${d.font};color:#303830"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="mail-outer" style="padding:${card?'32px 12px':'16px 0'}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:${d.width}px;margin:auto;background:white;${card?'border-radius:12px;':''}"><tr><td height="66" style="height:66px;padding:0 16px;vertical-align:middle;background:#fff;border:1px solid rgba(10,45,87,0.10);border-radius:24px;border-collapse:separate;overflow:hidden;box-shadow:0 4px 12px rgba(10,45,87,0.06)"><img src="${clubEmailLogoUrl}" width="320" height="26" alt="TUM Social AI Club" style="display:block;width:320px;max-width:100%;height:26px;max-height:26px;border:0"></td></tr><tr><td height="16" style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr><tr><td class="mail-content" style="padding:${d.padding}px;font-size:15px;border:1px solid rgba(10,45,87,0.08);border-radius:24px;box-shadow:0 8px 20px rgba(10,45,87,0.06)">{{content}}</td></tr></table></td></tr></table></body></html>`;
}

function updateDesignPreview() {
  document.querySelector('#paddingValue').textContent = document.querySelector('#designPadding').value + ' px';
  document.querySelector('#designPreview').srcdoc = renderHtmlMessage(buildDesignTemplate(), elements.body.value, recipients[previewIndex] || {name:"Alex Example",email:"alex@example.com"});
}

function syncStudio() {
  syncVisualEditor();
  const select = document.querySelector('#previewSelect');
  const options = recipients.map((r,i) => `<option value="${i}">${escapeHtml(r.name || r.email)}</option>`).join('') || '<option value="0">Example without recipient</option>';
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = String(previewIndex);
  const checks = [
    ...(!audienceSource ? [] : [[audienceSource.purpose !== 'browse', 'Notion sending purpose selected; eligibility rechecked before delivery', 'Review-only Notion list: choose a sending purpose']]),
    [emailPattern.test(elements.accountEmail.value.trim()) && !!elements.appPassword.value.trim(),'Sender and credentials added','Set up sender account'],
    [recipients.length > 0,`${recipients.length} recipients in the list`,'Add recipients'],
    [!!elements.subject.value.trim(),'Subject added','Add a subject'],
    [!!elements.body.value.trim(),'Email content added','Write your email'],
    [elements.htmlBody.value.includes('{{content}}'),'Email layout added','Add {{content}} to the layout']
  ];
  document.querySelector('#sendChecklist').innerHTML = checks.map(([ok,yes,no])=>`<div class="${ok?'done':''}">${ok?'✓':'○'} &nbsp; ${escapeHtml(ok?yes:no)}</div>`).join('');
}

function initStudio() {
  studioReady = true;
  const editor = document.querySelector('#visualEditor');
  document.addEventListener('selectionchange', rememberEditorSelection);
  recordEditorHistory();
  editor.addEventListener('beforeinput',event=>{
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault(); travelEditorHistory(event.inputType === 'historyRedo');
    }
  });
  document.querySelector('#formatToolbar').addEventListener('keydown',event=>{
    if ((event.metaKey || event.ctrlKey) && ['z','y'].includes(event.key.toLowerCase())) { event.preventDefault(); travelEditorHistory(event.shiftKey || event.key.toLowerCase() === 'y'); }
  });
  editor.addEventListener('keydown',event=>{
    if ((event.metaKey || event.ctrlKey) && ['z','y'].includes(event.key.toLowerCase())) { event.preventDefault(); travelEditorHistory(event.shiftKey || event.key.toLowerCase() === 'y'); }
  });
  editor.addEventListener('input',commitVisualEditor);
  editor.addEventListener('paste',event=>{
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    insertEditorHtml(escapeHtml(text).replace(/\n/g,'<br>'));
  });
  document.querySelector('#visualMode').addEventListener('click',()=>setEditorMode('visual'));
  document.querySelector('#sourceMode').addEventListener('click',()=>setEditorMode('source'));
  document.querySelector('#formatToolbar').addEventListener('mousedown',event=>{
    if (event.target.closest('button')) event.preventDefault();
  });
  const applyTypography = (kind, value) => {
    restoreEditorSelection();
    document.execCommand(kind === 'size' ? 'fontSize' : 'fontName', false, kind === 'font' ? value : kind === 'weight' ? 'mailbot-weight' : '7');
    editor.querySelectorAll(kind === 'size' ? 'font[size="7"]' : kind === 'weight' ? 'font[face="mailbot-weight"]' : 'font[face]').forEach(font => {
      const span = document.createElement('span');
      while (font.firstChild) span.appendChild(font.firstChild);
      if (kind === 'font') {
        span.dataset.mailFontChoice = value;
        span.style.fontFamily = `'${value}',Arial,Helvetica,sans-serif`;
      } else {
        span.dataset.mailTypography = 'true';
        if (kind === 'weight') span.style.fontWeight = value;
        else span.style.fontSize = `${value}px`;
      }
      font.replaceWith(span);
    });
    rememberEditorSelection();
    commitVisualEditor();
  };
  document.querySelector('#editorFont').addEventListener('change',event=>applyTypography('font',event.target.value));
  document.querySelector('#editorFontWeight').addEventListener('change',event=>applyTypography('weight',event.target.value));
  document.querySelector('#editorFontSize').addEventListener('change',event=>{
    const size = Number(event.target.value);
    if (Number.isFinite(size) && size >= 1 && size <= 200) applyTypography('size',size);
  });
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
      document.querySelector('#linkError').textContent='Enter a valid link or existing column variable. The label cannot contain braces, commas, or |.'; return;
    }
    const html=linkKind==='button'?buttonChip(label,target,variant):`<a href="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
    document.querySelector('#linkDialog').close();
    if(editingButton) { editingButton.outerHTML=html; commitVisualEditor(); }
    else insertEditorHtml(html);
  });
  document.querySelector('#deleteLink').addEventListener('click',()=>{if(editingButton)editingButton.remove();commitVisualEditor();document.querySelector('#linkDialog').close();});
  document.querySelectorAll('.design-controls input,.design-controls select').forEach(el=>el.addEventListener('input',()=>{
    updateDesignPreview();document.querySelector('#designState').textContent='Selection · not applied';
  }));
  document.querySelector('#applyDesign').addEventListener('click',()=>{
    elements.htmlBody.value=buildDesignTemplate();updatePreview();queueAutosave();document.querySelector('#designState').textContent='Applied to draft';setStatus('Design applied to this draft.','ok');
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
    const collection=readDraftCollection();let name='New draft';let i=2;while(collection[name])name=`New draft ${i++}`;
    setSelectedDraftName(name);elements.draftName.value=name;elements.subject.value='';elements.body.value='<p>Hi {{firstName}},</p><p><br></p><p>Best,<br>The Social AI Club Team</p>';
    recipients=[];audienceSource=null;elements.tableName.value='Default list';syncRawRecipientsFromTable();updateTable();updatePreview();saveDraft();activatePage('recipients');
  });
  document.querySelector('#deleteDraftButton').addEventListener('click',()=>{
    clearTimeout(autosaveTimer);
    if(!loadDraft(false)){elements.subject.value='';elements.body.value='';recipients=[];syncRawRecipientsFromTable();updateTable();updatePreview();}
  });
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();saveDraft();setStatus('Draft saved.','ok');}});
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
  document.querySelector('#linkDialogTitle').textContent=kind==='button'?(button?'Edit button':'Insert button'):'Insert link';
  document.querySelector('#linkLabel').value=button?.dataset.label||'';
  document.querySelector('#linkTarget').value=button?.dataset.target||'';
  document.querySelector('#buttonVariant').value=button?.dataset.variant||'gradient';
  document.querySelector('#buttonVariantField').hidden=kind!=='button';
  document.querySelector('#linkError').textContent='';
  document.querySelector('#saveLink').textContent=button?'Apply':'Insert';
  document.querySelector('#deleteLink').hidden=!button;
  document.querySelector('#linkDialog').showModal();
}

function openReusableList(snapshot = null) {
  pendingListIsCurrent = !snapshot;
  pendingReusableList = snapshot || collectTableState();
  document.querySelector('#reusableListName').value = pendingReusableList.tableName || 'Saved audience';
  document.querySelector('#reusableListHelp').textContent = `${pendingReusableList.recipients.length} contacts · A local snapshot for future campaigns.`;
  document.querySelector('#saveListDialog').showModal();
}

document.querySelector('#audienceDialog').addEventListener('close',syncRawRecipientsFromTable);
document.querySelector('#openSaveList').addEventListener('click',()=>openReusableList());
document.querySelector('#editTableMode').addEventListener('change',event=>{recipientEditing=event.target.checked;updateTable();});
document.querySelector('#designDetails').addEventListener('toggle',event=>{if(event.target.open)updateDesignPreview();});
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click',()=>document.querySelector('#'+button.dataset.closeDialog).close());
elements.recipientRows.addEventListener('click',event=>{
  const button=event.target.closest('[data-contact-details]');if(!button)return;
  const row=recipients[Number(button.dataset.contactDetails)];if(!row)return;
  document.querySelector('#contactDialogTitle').textContent=row.name || row.email;
  document.querySelector('#contactDetails').innerHTML=recipientColumns.map(column=>`<div><dt>${escapeHtml(column.label)}</dt><dd>${escapeHtml(row[column.key] || '—')}</dd></div>`).join('');
  document.querySelector('#contactDialog').showModal();
});

import('./notion-ui.js').then(({initNotionBrowser}) => initNotionBrowser({
  setStatus,
  getCurrentSource:()=>audienceSource,
  getSavedLists:()=>readTableCollection(),
  async renameSavedList(oldName,newName) {
    const {renameNamedList}=await import('./recipient-views.js');
    const collection=renameNamedList(readTableCollection(),oldName,newName);
    const name=String(newName).trim();
    writeTableCollection(collection);updateTableSelectOptions(name);setSelectedTableName(name);
    if(elements.tableName.value===oldName){elements.tableName.value=name;updateTable();saveDraft();}
    setStatus(`List renamed to “${name}”.`,'ok');
    return name;
  },
  saveSnapshot:openReusableList,
  useSnapshot(snapshot) {
    hydrateRecipientData(snapshot.recipientColumns, snapshot.recipients, snapshot.audienceSource);
    elements.tableName.value = snapshot.tableName;
    updateTable(); updatePreview(); saveDraft();
    setStatus(`${recipients.length} recipients attached to this campaign.`, 'ok');
  }
})).catch(error => setStatus(`Audience selection could not start: ${error.message}`, 'error'));
uiInitialized = true;
const initialPage = window.location.hash.slice(1);
activatePage(['recipients','message','review','contacts','account','preview','send'].includes(initialPage) ? initialPage : 'recipients');

import('./table-layout.js').then(({initContentSizedTables})=>initContentSizedTables());


async function refreshSendProgress() {
  const panel = document.getElementById('sendProgress');
  if (!panel) return;
  try {
    let response = await fetch('/api/send/status', {cache:'no-store'});
    let progress;
    if (response.ok) progress = await response.json();
    if (!response.ok) {
      response = await fetch('/send-progress.json', {cache:'no-store'});
      if (!response.ok) return;
      progress = await response.json();
    }
    if (!progress?.total) {
      const wasActive = serverSendActive; serverSendActive = false; panel.hidden = true;
      if (wasActive) updatePreview();
      return;
    }
    panel.hidden = false;
    const stale = Date.now() - Date.parse(progress.lastActivity || progress.updatedAt) > 60000;
    document.getElementById('sendProgressTitle').textContent = progress.state === 'finished' ? 'Send finished' : progress.state === 'interrupted' ? 'Send interrupted' : stale ? 'No recent progress' : progress.state === 'observing' ? 'Monitoring existing send' : 'Sending in progress';
    const bar = document.getElementById('sendProgressBar');bar.max=progress.total;bar.value=progress.processed;
    document.getElementById('sendProgressCounts').textContent = `${progress.sent} sent · ${progress.failed} failed · ${progress.skipped} skipped · ${progress.processed} / ${progress.total} processed`;
    document.getElementById('sendProgressDetail').textContent = progress.phase || (progress.state === 'observing' ? 'Live delivery journal. A pause may mean the server is waiting for Google or Notion.' : 'SMTP acceptance does not confirm inbox delivery.');
    const wasActive = serverSendActive;
    serverSendActive = progress.state === 'running' || progress.state === 'observing';
    if (serverSendActive) elements.sendButton.disabled = true;
    else if (wasActive) updatePreview();
  } catch { if (!panel.hidden) document.getElementById('sendProgressDetail').textContent = 'Connection lost. Send status is unavailable; do not start another send.'; }
}
refreshSendProgress();
setInterval(refreshSendProgress, 2000);
