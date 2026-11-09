let serverSendActive = false;
let lastDelivery = null;
let activeSendIdentity = '';
let latestSendProgress = null;
let rememberedCredentialKey = "";
function credentialKey() { return `${elements.accountEmail.value.trim().toLowerCase()}|${elements.authMode.value}`; }
function hasCredentials() { return Boolean(elements.appPassword.value.trim() || rememberedCredentialKey === credentialKey()); }
const editorUndo = [];
const editorRedo = [];
let restoringEditorHistory = false;
let applyingEditorFormat = false;
let composerResizeObserver = null;
let persistCollection = () => Promise.reject(new Error("Storage is not ready."));
let studioReady = false;
let editorMode = "visual";
let previewIndex = 0;
let previewImagesBlocked = false;
let previewTheme = "light";
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

const visualEditor = document.querySelector('#visualEditor');

const elements = {
  workspaceTitle: document.querySelector("#workspaceTitle"),
  accountEmail: document.querySelector("#accountEmail"),
  appPassword: document.querySelector("#appPassword"),
  authMode: document.querySelector("#authMode"),
  smtpSecurity: document.querySelector("#smtpSecurity"),
  secretLabel: document.querySelector("#secretLabel"),
  fromName: document.querySelector("#fromName"),
  replyTo: document.querySelector("#replyTo"),
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
let audienceDetails = null;
let notionFields;
let legacyNotionSchema;
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
  if (pageName === 'preview') pageName = 'review';
  document.body.dataset.page = pageName;
  document.querySelectorAll(".page-nav .page-link").forEach(link => link.setAttribute("aria-current", link.dataset.pageTarget === pageName ? "page" : "false"));
  elements.pages.forEach((page) => {
    page.classList.toggle("active", page.dataset.page === pageName);
  });

  elements.pageLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.pageTarget === pageName);
  });

  const titles = {recipients:'Recipients', message:'Message', review:'Review', send:'Send', contacts:'Contacts & lists', account:'Settings'};
  const activeLink = elements.pageLinks.find((link) => link.dataset.pageTarget === pageName);
  if (elements.workspaceTitle && activeLink) {
    elements.workspaceTitle.textContent = titles[pageName] || activeLink.querySelector("span")?.textContent || "Mailbot";
  }
  if (uiInitialized && !sending) setStatus('');
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
  const key = slugifyHeader(originalLabel);
  return { key, label: isNotionPageColumn({key}) ? "Notion Page" : originalLabel, role: "text" };
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
    gradient: { background: "#c4dfff", color: "#0a2d57", radius: 16, padding: "14px 22px", weight: 700, effects: "background-origin:border-box;background-repeat:no-repeat;background-image:radial-gradient(circle at 18% 24%,rgba(75,255,192,.5),transparent 42%),radial-gradient(circle at 82% 72%,rgba(74,152,255,.68),transparent 48%),linear-gradient(120deg,#DEECFF 0%,#c4dfff 42%,#a8ceff 72%,#DEECFF 100%);box-shadow:0 4px 10px rgba(10,45,87,.12);" },
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

function previewHtmlWithTheme(html) {
  if (!html || previewTheme !== 'dark') return html;
  const doc = new DOMParser().parseFromString(html,'text/html');
  doc.documentElement.dataset.mailbotPreviewTheme = 'dark';
  const style = doc.createElement('style');
  style.textContent = `html,body{background:#15181d!important;color:#e5ecf5!important;color-scheme:dark}
    td,table,div,section{border-color:#3d4653!important;box-shadow:none!important}
    td[style*="background:#fff"],td[style*="background: #fff"],td[style*="background-color:#ffffff"],td[bgcolor="#ffffff"],table[style*="background:white"],table[style*="background:#fff"]{background:#202731!important}
    h1,h2,h3,p,li,span,strong,b{color:#e5ecf5!important}
    a:not([data-club-mailbot-variant]){color:#98caff!important}
    [data-mailbot-navbar="true"]{background:#fff!important;background-image:linear-gradient(#fff,#fff)!important;color-scheme:only light!important;border-color:#e1e6ed!important}
    [data-mailbot-navbar="true"] img{background:#fff!important}
    [data-club-mailbot-variant="gradient"]{color:#0a2d57!important}
    [data-club-mailbot-variant="primary"]{color:#fff!important}
    table[data-mailbot-keep-white],td[data-mailbot-keep-white],a[data-mailbot-keep-white]{background-color:#f7f8fa!important;background-image:linear-gradient(#f7f8fa,#f7f8fa)!important;color-scheme:only light!important}
    a[data-mailbot-keep-white]{color:#0a2d57!important;-webkit-text-fill-color:#0a2d57!important}`;
  doc.head.append(style);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}

function localMailImageAssets() { return {
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/team-banner-title-size.png': '/assets/mail-team-banner-title-size.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/harvard-horizontal.png': '/assets/mail-harvard-horizontal.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/team-banner-dark-gradient.png': '/assets/mail-team-banner-dark-gradient.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/team-banner-no-gradient.png': '/assets/mail-team-banner-no-gradient.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/team-banner-white.png': '/assets/mail-team-banner-white.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/openai.png': '/assets/mail-openai.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/un-women.png': '/assets/mail-un-women.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/harvard.png': '/assets/mail-harvard.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/aws.png': '/assets/mail-aws.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/oliver-wyman.png': '/assets/mail-oliver-wyman.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/club-logo-white.png?v=c79e437': '/assets/mail-club-logo-white.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/engineering.png': '/assets/mail-engineering.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/social-partnerships.png': '/assets/mail-social-partnerships.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/strategic-partnerships.png': '/assets/mail-strategic-partnerships.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/community.png': '/assets/mail-community.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/marketing.png': '/assets/mail-marketing.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/strategy-finance-legal.png': '/assets/mail-strategy-finance-legal.png',
  'https://tum-socialaiclub.de/assets/mail/recruiting-2026/team-banner.png': '/assets/mail-team-banner.png',

  'https://tum-socialaiclub.de/assets/logos/LOGO_V6-ICON%2BTUM_SOCIAL_CLUB-single_line-white_text.svg': '/assets/club-logo-white.svg',
  'https://tum-socialaiclub.de/assets/logos/department-pills/engineering.png': '/assets/original-pill-engineering.png',
  'https://tum-socialaiclub.de/assets/logos/department-pills/social-partnerships.png': '/assets/original-pill-social-partnerships.png',
  'https://tum-socialaiclub.de/assets/logos/department-pills/strategic-partnerships.png': '/assets/original-pill-strategic-partnerships.png',
  'https://tum-socialaiclub.de/assets/logos/department-pills/community.png': '/assets/original-pill-community.png',
  'https://tum-socialaiclub.de/assets/logos/department-pills/marketing.png': '/assets/original-pill-marketing.png',
  'https://tum-socialaiclub.de/assets/logos/department-pills/strategy-finance-legal.png': '/assets/original-pill-strategy-finance-legal.png',

  'https://tum-socialaiclub.de/assets/logos/V6_ICON%2BDEPARTMENT-ENGINEERING.png': '/assets/department-0.png',
  'https://tum-socialaiclub.de/assets/logos/V6_ICON%2BDEPARTMENT-SOCIAL-PARTNERSHIPS.png': '/assets/department-1.png',
  'https://tum-socialaiclub.de/assets/logos/V6_ICON%2BDEPARTMENT-STRATEGIC-PARTNERSHIPS.png': '/assets/department-2.png',
  'https://tum-socialaiclub.de/assets/logos/V6_ICON%2BDEPARTMENT-COMMUNITY.png': '/assets/department-3.png',
  'https://tum-socialaiclub.de/assets/logos/V6-ICON%2BDEPARTMENT-MARKETING.png': '/assets/department-4.png',
  'https://tum-socialaiclub.de/assets/logos/V6_ICON%2BDEPARTMENT-FINANCE-LEGAL.png': '/assets/department-5.png',

  'https://tum-socialaiclub.de/cms/strategic-partner-logos/supporter/harvard-crest.png': '/assets/partner-harvard-crest.png',
  'https://tum-socialaiclub.de/cms/strategic-partner-logos/silver/oliver-wyman-logo.png': '/assets/partner-oliver-wyman.png',
  'https://tum-socialaiclub.de/cms/strategic-partner-logos/supporter/openai-logo.svg': '/assets/partner-openai-original.svg',
  'https://tum-socialaiclub.de/cms/all-partner-logos/Un-women-for-all-women-and-girls-coloured.png': '/assets/partner-un-women-original.png',
  'https://tum-socialaiclub.de/cms/strategic-partner-logos/supporter/harvard.svg': '/assets/partner-harvard.svg',
  'https://tum-socialaiclub.de/assets/club/community-applause-700.jpg': '/assets/community-applause-700.jpg',
  'https://tum-socialaiclub.de/cms/team/team-kickoff.jpg': '/assets/team-kickoff.jpg',
  'https://tum-socialaiclub.de/cms/all-partner-logos/openai-blue.svg': '/assets/partner-openai.svg',
  'https://tum-socialaiclub.de/cms/all-partner-logos/un-women-blue.svg': '/assets/partner-un-women.svg',
  'https://tum-socialaiclub.de/cms/all-partner-logos/aws-coloured.svg': '/assets/partner-aws.svg',
  'https://www.harvard.edu/wp-content/uploads/2020/10/cropped-logo-branding-compressed.png': '/assets/harvard-official.png',
}; }
function previewHtmlWithLocalCommunityPhoto(html) {
  let result = String(html || '');
  for (const [remote, local] of Object.entries(localMailImageAssets())) result = result.replaceAll(remote, `${location.origin}${local}`);
  return result;
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

function protectLogoHeader(html) {
  const logo = /<img\b[^>]*LOGO_V6-ICON(?:%2B|\+)TUM_SOCIAL_CLUB-single_line-dark_text\.svg[^>]*>/i.exec(html);
  if (!logo) return html;
  const cells = [...html.slice(0, logo.index).matchAll(/<td\b[^>]*>/gi)];
  const cell = cells.at(-1);
  if (!cell) return html;
  let tag = cell[0].replace(/\sbgcolor=(["']).*?\1/i, '').replace(/\sdata-mailbot-navbar=(["']).*?\1/i, '');
  const white = 'background-color:#ffffff!important;background-image:linear-gradient(#ffffff,#ffffff);color-scheme:only light;';
  tag = /style=(["'])(.*?)\1/i.test(tag) ? tag.replace(/style=(["'])(.*?)\1/i, (_m,q,style)=>`style=${q}${style};${white}${q}`) : tag.replace(/>$/, ` style="${white}">`);
  tag = tag.replace(/>$/, ' bgcolor="#ffffff" data-mailbot-navbar="true">');
  return html.slice(0,cell.index)+tag+html.slice(cell.index+cell[0].length);
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
  return includeEmailFonts(protectLogoHeader(constrainLogoDimensions(result)));
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
  const failed=/failed|could not|browser only/i.test(message);
  const state=document.getElementById('workspaceSaveState');
  if(state)state.textContent=failed?'Save failed':/unsaved|saving/i.test(message)?'Saving…':'Saved locally';
  if(failed)setStatus(message,'error');
}

function setTableSaveStatus(message) {
  if (elements.tableSaveStatus) {
    elements.tableSaveStatus.textContent = message;
    if(/failed|could not|browser only/i.test(message))setStatus(message,'error');
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
  refreshCredentialSession();
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
    replyTo: elements.replyTo.value.trim(),
    recipientColumns,
    recipients,
    audienceSource,
    audienceDetails,
    subject: elements.subject.value,
    body: elements.body.value,
    htmlBody: elements.htmlBody.value,
    delayMs: elements.delayMs.value,
    designSettings: studioReady ? readDesignSettings() : undefined,
    lastDelivery,
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

async function renameSavedList(oldName, requestedName) {
  const {renameNamedList} = await import('./recipient-views.js');
  const name = requestedName.trim();
  const collection = renameNamedList(readTableCollection(), oldName, name);
  writeTableCollection(collection);
  updateTableSelectOptions(name);
  setSelectedTableName(name);
  if (elements.tableName.value === oldName) {
    elements.tableName.value = name;
    updateTable();
    saveDraft();
  }
  setStatus(`Group renamed to “${name}”.`,'ok');
  return name;
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
    audienceDetails,
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

function isNotionPageColumn(column) {
  return ['applicationpage', 'notionpage', 'notionpageid'].includes(String(column?.key || '').replace(/[^a-z]/gi, '').toLowerCase());
}

function hydrateRecipientData(columns, rows, source = null, details = null) {
  audienceSource = source;
  audienceDetails = details;
  recipientColumns = Array.isArray(columns) && columns.length
    ? columns.map((column) => ({
      key: String(column.key || slugifyHeader(column.label || column.key || "property")).trim(),
      label: isNotionPageColumn(column) ? "Notion Page" : String(column.label || column.key || "Property").trim(),
      role: normalizeColumnRole(column.role),
      ...(typeof column.notion?.type === 'string' && Array.isArray(column.notion.options) ? {notion:column.notion} : {})
    }))
    : [...defaultRecipientColumns];
  recipients = Array.isArray(rows) ? rows.map(ensureRequiredRecipientFields) : [];
  syncRawRecipientsFromTable();
  parseStats = { invalid: 0, duplicates: 0 };
  if (!notionFields) return;
  if (recipientColumns.some(column => column.key === 'applicationPage')) {
    recipientColumns = notionFields.attachNotionFields(recipientColumns, [], true);
  }
  const originalFields = new Set(['name','first name','last name','email',...(source?.fields || []).map(name=>name.toLowerCase())]);
  if (source?.sourceId && recipientColumns.some(column => !column.notion && originalFields.has(column.label.toLowerCase()))) {
    const activeColumns = recipientColumns;
    legacyNotionSchema ||= fetch('/api/notion/fields').then(response => {
      if (!response.ok) throw new Error('Notion fields unavailable.');
      return response.json();
    }).catch(() => {
      legacyNotionSchema = null;
      return null;
    });
    legacyNotionSchema.then(schema => {
      if (recipientColumns !== activeColumns || schema?.sourceId !== source.sourceId) return;
      recipientColumns = notionFields.attachNotionFields(recipientColumns, schema.fields);
      updateTable();
    });
  }
}

function applyTableState(table, showStatus = true) {
  try {
    isHydratingDraft = true;
    if (elements.tableName) {
      elements.tableName.value = normalizeTableName(table.tableName);
    }
    hydrateRecipientData(table.recipientColumns, table.recipients, table.audienceSource, table.audienceDetails);
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
    lastDelivery = draft.lastDelivery || null;
    elements.draftName.value = normalizeDraftName(draft.draftName);
    if (elements.tableName && (draft.tableName || draft.audienceSource)) elements.tableName.value = draft.tableName || getSelectedTableName() || "Notion audience";
    elements.accountEmail.value = draft.accountEmail || "";
    elements.authMode.value = draft.authMode === "xoauth2" ? "xoauth2" : "appPassword";
    elements.smtpSecurity.value = draft.smtpSecurity === "starttls587" ? "starttls587" : "ssl465";
    elements.fromName.value = draft.fromName || "Club Team";
    elements.replyTo.value = draft.replyTo || "";
    elements.subject.value = draft.subject || "";
    elements.body.value = draft.body || "";
    elements.htmlBody.value = withClubLogo(draft.htmlBody || "");
    elements.delayMs.value = draft.delayMs || "1200";
    restoreDesignSettings(draft.designSettings);
    previewIndex = 0;

    if (Array.isArray(draft.recipients)) {
      hydrateRecipientData(draft.recipientColumns, draft.recipients, draft.audienceSource, draft.audienceDetails);
    } else {
      hydrateRecipientData(defaultRecipientColumns, parseRecipients(draft.rawRecipients || ""));
    }

    updateAuthUi();
    updateTable();
    updatePreview();
    updateDraftSelectOptions(normalizeDraftName(draft.draftName));
    setSelectedDraftName(draft.draftName);
    if (showStatus) {
      setSaveStatus(`Loaded: ${formatSavedAt(draft.savedAt)}.`);
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

function markAudienceCustomized() {
  audienceDetails = { ...audienceDetails, customized: true };
}

function removeRecipient(index) {
  recipients.splice(index, 1);
  markAudienceCustomized();
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function addRecipient(atStart = false) {
  recipientEditing = true;
  document.querySelector("#editTableMode").checked = true;
  const emptyRecipient = Object.fromEntries(recipientColumns.map((column) => [column.key, ""]));
  if (atStart === true) recipients.unshift(ensureRequiredRecipientFields(emptyRecipient));
  else recipients.push(ensureRequiredRecipientFields(emptyRecipient));
  markAudienceCustomized();
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function addColumn() {
  const rawLabel = arguments[0] || window.prompt("New column name", "Column");
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
  markAudienceCustomized();
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
  setStatus(`Column "${nextColumn.label}" added.`, "ok");
}

function deleteColumn(index) {
  const column = recipientColumns[index];
  if (!column || isNotionPageColumn(column)) return;
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
  markAudienceCustomized();
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
  if (!current || current.label === trimmed || isNotionPageColumn(current)) return;
  if (recipientColumns.some((column,i) => i !== index && column.label.toLowerCase() === trimmed.toLowerCase())) { setStatus('A column with this name already exists.', 'error'); return; }
  recipientColumns[index] = {...current, label:trimmed};
  markAudienceCustomized();
  syncRawRecipientsFromTable();
  updateTable();
  updatePreview();
  queueAutosave();
}

function moveRecipientColumn(from, to) {
  const source = recipientColumns.findIndex(column => column.key === from);
  const target = recipientColumns.findIndex(column => column.key === to);
  if (source < 0 || target < 0 || source === target) return;
  const [column] = recipientColumns.splice(source, 1);
  recipientColumns.splice(target, 0, column);
  markAudienceCustomized();
  syncRawRecipientsFromTable();
  updateTable();
  queueAutosave();
}

function updateColumnRole(index, role) {
  recipientColumns[index].role = normalizeColumnRole(role);
  markAudienceCustomized();
  updateTable();
  updatePreview();
  queueAutosave();
}

function updateRecipientCell(index, key, value) {
  if (!recipients[index] || isNotionPageColumn({key})) return;
  const column = recipientColumns.find(column => column.key === key);
  const currentValue = String(recipients[index][key] ?? "");
  if (!column || currentValue === value || notionFields?.acceptsNotionValue(column.notion, value, currentValue) === false) return;
  const updated = { ...recipients[index], [key]: value };
  recipients[index] = ensureRequiredRecipientFields(updated);
  markAudienceCustomized();
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
      if (!column || isNotionPageColumn(column)) return;
      const nextValue = String(cell || "");
      const currentValue = String(recipients[recipientIndex]?.[column.key] || "");
      if (currentValue === nextValue) return;
      if (notionFields?.acceptsNotionValue(column.notion, nextValue, currentValue) === false) return;
      recipients[recipientIndex] = ensureRequiredRecipientFields({
        ...recipients[recipientIndex],
        [column.key]: nextValue
      });
      changed = true;
    });
  });

  if (!changed) return false;
  markAudienceCustomized();
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
  const save = document.querySelector('#openSaveList'); if (save) save.disabled = !recipients.length;
  if (elements.addRecipientButton) { elements.addRecipientButton.disabled = Boolean(audienceSource?.sourceId); elements.addRecipientButton.title = audienceSource?.sourceId ? 'Add new contacts in Notion, then refresh this audience.' : ''; }
  elements.recipientCount.textContent = `${recipients.length} ${recipients.length === 1 ? "recipient" : "recipients"}`;
  elements.duplicateCount.textContent = parseStats.duplicates ? `${parseStats.duplicates} duplicates removed` : '';
  elements.invalidCount.textContent = parseStats.invalid ? `${parseStats.invalid} invalid addresses excluded` : '';
  if (elements.summaryRecipientCount) elements.summaryRecipientCount.textContent = String(recipients.length);
  if (document.documentElement.dataset.studioReady === 'true') {
    const columns = recipientColumns.map(column => isNotionPageColumn(column)
      ? {...column, label:'Notion Page', readOnly:true}
      : column);
    document.dispatchEvent(new CustomEvent('mailbot:recipient-table', {detail:{columns,rows:recipients,canAdd:!audienceSource?.sourceId}}));
    publishCampaignState();
    updateEditorVariables();
    return;
  }
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

function fitPreviewFrame(frame) {
  if (!frame?.offsetWidth || !frame.contentDocument?.body) return;
  frame.style.height = '1px';
  const doc = frame.contentDocument;
  const height=Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 400);
  frame.style.height = `${height}px`;
  if (frame.id === 'messageHtmlPreview') {
    const holder=frame.parentElement;
    const scale=Math.min(1,holder.clientWidth / 680);
    frame.style.transform=`scale(${scale})`;
    holder.style.height=`${height * scale}px`;
  }
}

function fitVisiblePreviews() {
  fitPreviewFrame(elements.htmlPreview);
  fitPreviewFrame(elements.messageHtmlPreview);
  fitComposerFrame();
}

function validReplyTo() {
  const address = elements.replyTo.value.trim();
  return !address || (elements.replyTo.validity.valid && emailPattern.test(address));
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
    messagePreview.onload = () => { fitPreviewFrame(messagePreview); messagePreview.contentDocument?.fonts?.ready.then(() => fitPreviewFrame(messagePreview)); };
    messagePreview.srcdoc = previewHtmlWithTheme(previewHtmlWithLocalCommunityPhoto(previewHtmlWithLocalSocialIcons(renderedHtml))) || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">No email design yet.</p>";
  }
  const previewFrom = document.getElementById('previewFrom');
  if (previewFrom) previewFrom.textContent = `${elements.fromName.value || 'Sender'} <${elements.accountEmail.value || 'No sender connected'}>`;
  const replyTo = elements.replyTo.value.trim();
  const previewReplyToRow = document.getElementById('previewReplyToRow');
  previewReplyToRow.hidden = !replyTo;
  document.getElementById('previewReplyTo').textContent = replyTo;
  elements.replyTo.setAttribute('aria-invalid', String(!validReplyTo()));
  elements.previewRecipient.textContent = recipient ? `${recipient.name} · ${recipient.email}` : "No recipient";
  elements.previewSubject.textContent = renderTemplate(elements.subject.value, recipient);
  if (document.activeElement !== elements.previewBody) {
    elements.previewBody.value = elements.body.value;
  }
  elements.htmlPreview.onload = () => { fitPreviewFrame(elements.htmlPreview); elements.htmlPreview.contentDocument?.fonts?.ready.then(() => fitPreviewFrame(elements.htmlPreview)); };
  elements.htmlPreview.srcdoc = previewHtmlWithBlockedImages(previewHtmlWithTheme(previewHtmlWithLocalCommunityPhoto(previewHtmlWithLocalSocialIcons(renderedHtml))) || "<p style=\"font-family:Arial,sans-serif;color:#68727f;\">No email design yet.</p>");

  const canSend = Boolean(
    emailPattern.test(elements.accountEmail.value.trim())
      && hasCredentials()
      && validReplyTo()
      && elements.subject.value.trim()
      && elements.body.value.trim()
      && elements.htmlBody.value.includes("{{content}}")
      && recipients.length && recipients.every(row=>emailPattern.test(row.email))
  );
  elements.testButton.disabled = sending || !canSend || !emailPattern.test(document.querySelector("#testEmail").value.trim());
  elements.sendButton.disabled = serverSendActive || sending || !canSend || audienceSource?.purpose === "browse";
  const delivered = new Set(lastDelivery?.identity === currentCampaignIdentity() ? lastDelivery.emails || [] : []);
  const remaining = recipients.filter(row => !delivered.has(String(row.email).toLowerCase())).length;
  const alreadySent = recipients.length > 0 && remaining === 0;
  if (alreadySent) elements.sendButton.disabled = true;
  const sendLabel = document.getElementById('sendButtonLabel');
  if (sendLabel) sendLabel.textContent = alreadySent ? 'Campaign sent' : delivered.size ? `Send to ${remaining} remaining` : 'Send campaign';
  const sendNote = document.getElementById('sendAvailabilityNote');
  if (sendNote) sendNote.textContent = alreadySent ? 'Already sent to every recipient in this list.' : 'One personalized email per recipient.';
  if (elements.summaryReady) {
    elements.summaryReady.textContent = alreadySent ? 'Sent' : canSend && audienceSource?.purpose !== "browse" ? 'Ready' : 'Needs attention';
  }
  renderCampaignProgress(latestSendProgress);
  if (studioReady) syncStudio();
}

function campaignIdentity(draftName, subject, sender) {
  return JSON.stringify([String(draftName || '').trim(), String(subject || ''), String(sender || '').trim().toLowerCase()]);
}

function currentCampaignIdentity() {
  return campaignIdentity(elements.draftName.value, elements.subject.value, elements.accountEmail.value);
}

function campaignProgressKey(identity) {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function progressMatchesCampaign(progress, identity, activeIdentity) {
  if (!progress) return false;
  if (progress.campaignKey) return progress.campaignKey === campaignProgressKey(identity);
  return Boolean(activeIdentity && activeIdentity === identity);
}

async function confirmCampaignSend() {
  if (document.documentElement.dataset.studioReady === 'true') {
    return new Promise(resolve => document.dispatchEvent(new CustomEvent('mailbot:confirm-send', {
      detail: { count: recipients.length, sender: elements.accountEmail.value.trim(), subject: elements.subject.value, resolve }
    })));
  }
  return window.confirm(`Send ${recipients.length} emails from ${elements.accountEmail.value.trim()}?`);
}

async function testAuth() {
  if (!elements.accountEmail.value.trim() || !hasCredentials()) {
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

    await refreshCredentialSession();
    if (rememberedCredentialKey === credentialKey()) elements.appPassword.value = "";
    setStatus("Gmail SMTP login successful. Password remembered for this Mailbot session.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.testAuthButton.disabled = false;
    updatePreview();
  }
}

function parseCurrentInput() {
  audienceSource = null;
  audienceDetails = {kind:"csv"};
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
  if (!validReplyTo()) { setStatus("Enter a valid Reply-To email address.", "error"); return; }
  const testEmail = document.querySelector("#testEmail").value.trim();
  if (testOnly && !emailPattern.test(testEmail)) { setStatus("Enter a valid test address.", "error"); return; }

  const verb = testOnly ? "Test email" : `${recipients.length} emails`;
  const confirmed = testOnly || await confirmCampaignSend();
  if (!confirmed) return;

  sending = true;
  if (!testOnly) activeSendIdentity = currentCampaignIdentity();
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
        replyTo: elements.replyTo.value.trim(),
        draftName: elements.draftName.value.trim(),
        campaignKey: campaignProgressKey(currentCampaignIdentity()),
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
    if (!testOnly) {
      const identity = currentCampaignIdentity();
      const previous = lastDelivery?.identity === identity ? lastDelivery.emails || [] : [];
      lastDelivery = {
        identity,
        emails: [...new Set([...previous, ...payload.results.filter(result => result.ok).map(result => String(result.email).toLowerCase())])],
        total: payload.total,
        failed: failed.length,
        completedAt: new Date().toISOString(),
      };
      saveDraft();
    }
    const auditWarnings = payload.results.filter(result => result.auditWarning);
    const lastTrace = payload.results.find((result) => result.trace?.length)?.trace || payload.trace || [];
    showLogs(lastTrace, failed.length ? "SMTP trace contains an error." : "SMTP trace successful.");
    if (payload.stopped) {
      setStatus(`Sending stopped. ${payload.sent} sent · ${failed.length} failed · ${payload.remaining} not processed.`, 'ok');
    } else if (failed.length) {
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
  elements.tableName.value = document.querySelector('#csvGroupName').value.trim() || 'Imported recipients';
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
  markAudienceCustomized();
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

[elements.accountEmail, elements.appPassword, elements.fromName, elements.replyTo, elements.draftName, elements.subject, elements.htmlBody].forEach((element) => {
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
  elements.smtpLogs.textContent = 'No delivery details recorded in this session.';
});

try {
  notionFields = await import('./notion-fields.js');
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
  const wrapper = document.createElement('div');
  wrapper.className = 'mail-button';
  wrapper.contentEditable = 'false';
  wrapper.dataset.label = label;
  wrapper.dataset.target = target;
  wrapper.dataset.variant = variant;
  wrapper.innerHTML = renderButtonMarkup(label, /^(https?:|mailto:)/i.test(target) ? target : 'https://example.invalid', {}, 'html', variant);
  wrapper.title = 'Edit button';
  return wrapper.outerHTML;
}

// Render the real mail layout while retaining the editable campaign variables.
function renderUnresolvedMessage(design, content) {
  const variables = [];
  const masked = content.replace(/\{\{[^}]+\}\}/g, value => `%%MAILBOT_EDIT_VARIABLE_${variables.push(value)-1}%%`);
  return renderHtmlMessage(design, masked, {}).replace(/%%MAILBOT_EDIT_VARIABLE_(\d+)%%/g, (_match,index) => variables[Number(index)]);
}

function fitComposerFrame() {
  const frame = document.getElementById('composerFrame');
  if (!frame?.offsetWidth || !frame.contentDocument?.body) return;
  frame.style.height = '1px';
  frame.style.height = `${Math.max(frame.contentDocument.documentElement.scrollHeight, frame.contentDocument.body.scrollHeight, 400)}px`;
}

function visualHtml(source) {
  return cleanEditorHtml(source
    .replace(/button\{\{\s*([^,}]+)\s*,\s*([^,}]+?)(?:\s*,\s*([a-z]+))?\s*\}\}/gi, (_, label, target, variant) => buttonChip(label.trim(), target.trim(), variant || 'gradient'))
    .replace(/\{\{\s*button\s*:\s*([^|}]+)\|\s*([^|}]+?)(?:\|\s*([a-z]+))?\s*\}\}/gi, (_, label, target, variant) => buttonChip(label.trim(), target.trim(), variant || 'gradient')));
}

function syncVisualEditor() {
  const frame = document.getElementById('composerFrame');
  const source = elements.body.value;
  const design = elements.htmlBody.value;
  if (visualEditor.dataset.source === source && frame.dataset.design === design) return;
  composerResizeObserver?.disconnect();
  visualEditor.dataset.source = source;
  frame.dataset.design = design;
  savedEditorRange = null;
  document.getElementById('formatToolbar').inert = true;
  frame.setAttribute('aria-busy','true');
  const content = `<div id="mailbotEditorSlot">${visualHtml(source)}</div>`;
  const rendered = renderUnresolvedMessage(design, content);
  const editorStyles = `<style data-mailbot-editor="true">#visualEditor{outline:none;min-height:200px}#visualEditor:empty:before{content:'Write your email…';opacity:.45}#visualEditor .mail-button{cursor:pointer}#visualEditor .mail-button:hover{outline:1px dashed #7598c3;outline-offset:5px}#visualEditor a{cursor:text}</style>`;
  frame.onload = () => {
    const doc = frame.contentDocument;
    const slot = doc?.getElementById('mailbotEditorSlot');
    if (!slot) { document.getElementById('formatToolbar').inert=false; frame.setAttribute('aria-busy','false'); return; }
    document.getElementById('formatToolbar').inert = false;
    frame.setAttribute('aria-busy','false');
    visualEditor.removeAttribute('style');
    visualEditor.innerHTML = slot.innerHTML;
    slot.replaceWith(doc.adoptNode(visualEditor));
    doc.addEventListener('selectionchange', rememberEditorSelection);
    doc.addEventListener('load', fitComposerFrame, true);
    composerResizeObserver = new ResizeObserver(() => requestAnimationFrame(fitComposerFrame));
    composerResizeObserver.observe(visualEditor);
    doc.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
    editorUndo.length = 0; editorRedo.length = 0;
    recordEditorHistory();
    fitComposerFrame();
    doc.fonts?.ready.then(fitComposerFrame);
  };
  frame.srcdoc = previewHtmlWithLocalCommunityPhoto(previewHtmlWithLocalSocialIcons(rendered.replace(/<\/head>/i, `${editorStyles}</head>`)));
}

function commitVisualEditor() {
  recordEditorHistory();
  const editor = visualEditor;
  const clone = editor.cloneNode(true);
  // Local preview assets must never be saved into outgoing email HTML.
  clone.querySelectorAll('img').forEach(image => {
    for (const [remote, local] of Object.entries(localMailImageAssets())) {
      if (image.getAttribute('src') === `${location.origin}${local}`) image.setAttribute('src', remote);
    }
  });
  // Browser formatting commands can leave empty wrappers behind.
  [...clone.querySelectorAll('span')].reverse().forEach(span => {
    const choice = span.dataset.mailFontChoice;
    if (['Albert Sans','League Spartan'].includes(choice)) span.style.fontFamily = `'${choice}',Arial,Helvetica,sans-serif`;
    if (!span.getAttribute('style')?.trim() && !choice && [...span.attributes].every(attr=>['style','data-mail-typography'].includes(attr.name))) span.replaceWith(...span.childNodes);
  });
  const macros = [];
  clone.querySelectorAll('.mail-button').forEach(el => { const index = macros.push(`button{{${el.dataset.label},${el.dataset.target},${el.dataset.variant || 'gradient'}}}`) - 1; el.replaceWith(document.createComment(`mail-button-${index}`)); });
  let outgoingEditorHtml = clone.innerHTML;
  for (const [remote, local] of Object.entries(localMailImageAssets())) outgoingEditorHtml = outgoingEditorHtml.replaceAll(`${location.origin}${local}`, remote);
  elements.body.value = outgoingEditorHtml.replace(/<!--mail-button-(\d+)-->/g, (_,index) => macros[Number(index)]);
  editor.dataset.source = elements.body.value;
  requestAnimationFrame(fitComposerFrame);
  updatePreview();
  queueAutosave();
}

function editorSnapshot() {
  const editor = visualEditor;
  const selection = visualEditor.ownerDocument.getSelection();
  const offsets = [];
  if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
    for (const [node, offset] of [[selection.anchorNode, selection.anchorOffset], [selection.focusNode, selection.focusOffset]]) {
      const range = visualEditor.ownerDocument.createRange(); range.selectNodeContents(editor); range.setEnd(node, offset); offsets.push(range.toString().length);
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
  const editor = visualEditor;
  if (!redo && editorUndo.length < 2 || redo && !editorRedo.length) return;
  if (redo) editorUndo.push(editorRedo.pop()); else editorRedo.push(editorUndo.pop());
  const snapshot = editorUndo.at(-1);
  restoringEditorHistory = true;
  editor.innerHTML = snapshot.html; editor.focus();
  restoreEditorOffsets(snapshot.offsets);
  rememberEditorSelection(); commitVisualEditor(); restoringEditorHistory = false;
}
function restoreEditorOffsets(offsets) {
  if (offsets.length !== 2) return;
  const editor = visualEditor;
  const locate = offset => {
    const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) { if (offset < node.length) return [node,offset]; offset -= node.length; }
    return [editor,editor.childNodes.length];
  };
  editor.ownerDocument.getSelection().setBaseAndExtent(...locate(offsets[0]), ...locate(offsets[1]));
}

function syncTypographyToolbar() {
  const editor = visualEditor, selection = visualEditor.ownerDocument.getSelection();
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  const range = selection.getRangeAt(0), nodes = [];
  if (range.collapsed) nodes.push(selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
  else {
    const walker = visualEditor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || !range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (end > start) nodes.push(node.parentElement);
    }
  }
  if (!nodes.length) return;
  const styles = nodes.map(node => node.ownerDocument.defaultView.getComputedStyle(node));
  const fields = [['editorFont', style=>style.fontFamily.split(',')[0].replace(/["']/g,'').trim()], ['editorFontSize', style=>String(Math.round(parseFloat(style.fontSize)))], ['editorFontWeight', style=>style.fontWeight === 'normal' ? '400' : style.fontWeight === 'bold' ? '700' : style.fontWeight]];
  for (const [id,read] of fields) {
    const control = document.getElementById(id), values = [...new Set(styles.map(read))];
    if (document.activeElement === control) continue;
    control.value = values.length === 1 ? values[0] : '';
    control.title = values.length > 1 ? 'Mixed formatting' : values[0];
    if (control.tagName === 'INPUT') control.placeholder = values.length > 1 ? 'Mixed' : '';
  }
  document.querySelectorAll('[data-format="bold"],[data-format="italic"]').forEach(button=>button.setAttribute('aria-pressed',String(visualEditor.ownerDocument.queryCommandState(button.dataset.format))));
}

function rememberEditorSelection() {
  const selection = visualEditor.ownerDocument.getSelection();
  if (selection.rangeCount && visualEditor.contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
  syncTypographyToolbar();
}

function restoreEditorSelection() {
  const editor = visualEditor;
  editor.focus();
  const selection = visualEditor.ownerDocument.getSelection();
  selection.removeAllRanges();
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) selection.addRange(savedEditorRange);
  else { const range = visualEditor.ownerDocument.createRange(); range.selectNodeContents(editor); range.collapse(false); selection.addRange(range); }
}

function insertEditorHtml(html) {
  restoreEditorSelection();
  visualEditor.ownerDocument.execCommand('insertHTML', false, html);
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
  if (/single_line-white_text\.svg|club-logo-white\.png/.test(String(template))) return template;
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

function publishCampaignState() {
  const hasAudience = Boolean(recipients.length || audienceDetails || audienceSource || elements.tableName.value !== 'Default list');
  document.dispatchEvent(new CustomEvent('mailbot:campaign-state', { detail: {
    draftName: elements.draftName.value,
    tableName: hasAudience ? elements.tableName.value : 'Choose a group',
    canRefresh: Boolean(audienceSource?.sourceId),
    hasAudience,
    hasApplicationPages: recipientColumns.some(column => column.key.toLowerCase() === 'applicationpage'),
    audienceSource,
    audienceDetails
  }}));
}

function syncStudio() {
  syncVisualEditor();
  const select = document.querySelector('#previewSelect');
  const options = recipients.map((r,i) => `<option value="${i}">${escapeHtml(r.name ? `${r.name} · ${r.email}` : r.email)}</option>`).join('') || '<option value="0">Example without recipient</option>';
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = String(previewIndex);
  publishCampaignState();
  const campaignName = document.getElementById('activeCampaignName');
  if (campaignName) campaignName.textContent = elements.draftName.value || 'Untitled draft';
  const sender = document.getElementById('deliverySender');
  if (sender) sender.textContent = elements.accountEmail.value || 'No sender connected';
  for (const [page, complete] of [['recipients', recipients.length > 0], ['message', Boolean(elements.subject.value.trim() && elements.body.value.trim())]]) {
    document.querySelector(`.workflow-nav [data-page-target="${page}"]`)?.classList.toggle('complete', complete);
  }
  const checks = [
    ...(!audienceSource ? [] : [[audienceSource.purpose !== 'browse', 'Audience is eligible', 'Choose an audience for sending', 'recipients']]),
    [emailPattern.test(elements.accountEmail.value.trim()) && hasCredentials(),'Sender connected','Connect your sender account','account'],
    [recipients.length > 0,`${recipients.length} recipients selected`,'Choose recipients','recipients'],
    [recipients.every(row=>emailPattern.test(row.email)),'Recipient addresses ready','Complete the recipient email addresses','recipients'],
    [validReplyTo(),'Reply-To ready','Enter a valid Reply-To email','message'],
    [!!elements.subject.value.trim(),'Subject ready','Add a subject','message'],
    [!!elements.body.value.trim(),'Message ready','Write your message','message'],
    [elements.htmlBody.value.includes('{{content}}'),'Design ready','Choose an email design','message']
  ];
  document.querySelector('#sendChecklist').innerHTML = checks.filter(([ok])=>!ok).map(([ok,yes,no,page])=>`<button type="button" data-page-target="${page}">○ &nbsp; ${escapeHtml(no)} →</button>`).join('');
}

function initStudio() {
  studioReady = true;
  document.querySelector('.studio-brand')?.addEventListener('click',event=>{event.preventDefault();activatePage('recipients');});
  document.addEventListener('mailbot:page-changed', () => requestAnimationFrame(fitVisiblePreviews));

  window.addEventListener('resize', fitVisiblePreviews);
  const editor = visualEditor;
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
  editor.addEventListener('input',()=>{if(!applyingEditorFormat)commitVisualEditor();});
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
    const offsets = editorSnapshot().offsets;
    applyingEditorFormat = true;
    try {
      visualEditor.ownerDocument.execCommand(kind === 'size' ? 'fontSize' : 'fontName', false, kind === 'font' ? value : kind === 'weight' ? 'mailbot-weight' : '7');
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
      restoreEditorOffsets(offsets);
      rememberEditorSelection();
    } finally { applyingEditorFormat = false; }
    commitVisualEditor();
  };
  document.querySelector('#editorFont').addEventListener('change',event=>applyTypography('font',event.target.value));
  document.querySelector('#editorFontWeight').addEventListener('change',event=>applyTypography('weight',event.target.value));
  for (const [id, delta] of [['editorSizeDown',-2],['editorSizeUp',2]]) document.getElementById(id).addEventListener('click',()=>{
    const input=document.getElementById('editorFontSize');
    const size=Math.max(1,Math.min(200,Number(input.value || 16)+delta));
    input.value=String(size);applyTypography('size',size);
  });
  document.querySelector('#editorFontSize').addEventListener('change',event=>{
    const size = Number(event.target.value);
    if (Number.isFinite(size) && size >= 1 && size <= 200) applyTypography('size',size);
  });
  document.querySelector('#insertDivider').addEventListener('click',()=>insertEditorHtml('<hr style="border:0;border-top:1px solid #dbe3ec;margin:24px 0;">'));
  document.querySelectorAll('[data-format]').forEach(button=>button.addEventListener('click',()=>{
    restoreEditorSelection(); visualEditor.ownerDocument.execCommand(button.dataset.format,false,button.dataset.value || null); commitVisualEditor();
  }));
  document.querySelector('#insertButton').addEventListener('click',()=>openLinkDialog('button'));
  document.querySelector('#insertLink').addEventListener('click',()=>openLinkDialog('link'));
  editor.addEventListener('click',event=>{
    const button=event.target.closest('.mail-button');
    if(button) { event.preventDefault(); openLinkDialog('button',button); }
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
  for (const theme of ['light','dark']) document.getElementById(theme+'ThemePreview').addEventListener('click',()=>{
    previewTheme = theme;
    for (const name of ['light','dark']) {const button=document.getElementById(name+'ThemePreview');button.classList.toggle('selected',name===theme);button.setAttribute('aria-pressed',String(name===theme));}
    document.querySelector('.full-preview').classList.toggle('dark-theme-preview',theme==='dark');
    updatePreview();
  });
  document.querySelector('#loadedContentPreview').addEventListener('click',()=>setPreviewImagesBlocked(false));
  document.querySelector('#blockedContentPreview').addEventListener('click',()=>setPreviewImagesBlocked(true));
  document.querySelector('#showPreviewImages').addEventListener('click',()=>setPreviewImagesBlocked(false));
  for(const mode of ['desktop','mobile']) document.querySelector(`#${mode}Preview`).addEventListener('click',()=>{
    document.querySelector('.full-preview').classList.toggle('mobile',mode==='mobile');
    document.querySelector('#desktopPreview').classList.toggle('selected',mode==='desktop');
    document.querySelector('#mobilePreview').classList.toggle('selected',mode==='mobile');
    fitVisiblePreviews();
  });
  document.querySelector('#testEmail').addEventListener('input',updatePreview);
  document.querySelector('#sendChecklist').addEventListener('click', event => {
    const target = event.target.closest('[data-page-target]');
    if (target) activatePage(target.dataset.pageTarget);
  });
  document.addEventListener('mailbot:move-column', event=>moveRecipientColumn(event.detail.from,event.detail.to));
  document.addEventListener('mailbot:recipient-cell', event=>{
    const {index,key,value} = event.detail;
    updateRecipientCell(index,key,value);
  });
  document.addEventListener('mailbot:delete-column', event=>deleteColumn(event.detail.index));
  document.addEventListener('mailbot:rename-column', event=>renameColumn(event.detail.index,event.detail.label));
  document.addEventListener('mailbot:add-column', event=>addColumn(event.detail.label));
  document.addEventListener('mailbot:add-person', ()=>{
    addRecipient(true);
    requestAnimationFrame(()=>document.querySelector('#recipientRows input[data-row-index="0"]')?.focus());
  });
  document.getElementById('newRecipientList').addEventListener('click',()=>{
    const collection=readTableCollection();let name='New group',index=2;
    while(collection[name])name=`New group ${index++}`;
    recipients=[];audienceSource=null;audienceDetails=null;recipientColumns=[{key:'name',label:'Name',role:'text'},{key:'email',label:'Email',role:'to'}];
    elements.tableName.value=name;syncRawRecipientsFromTable();updateTable();updatePreview();saveDraft();
  });
  document.addEventListener('mailbot:rename-group', async event => {
    const name = event.detail.name.trim();
    const oldName = elements.tableName.value;
    if (!name || name === oldName) return;
    try {
      const groups = readTableCollection();
      if (Object.hasOwn(groups, oldName)) {
        await renameSavedList(oldName, name);
        return;
      }
      if (Object.hasOwn(groups, name)) throw new Error('A group with this title already exists.');
      elements.tableName.value = name;
      updateTable();
      saveDraft();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  document.addEventListener('mailbot:select-draft',event=>{
    const name=event.detail.name;if(!readDraftCollection()[name])return;
    clearTimeout(autosaveTimer);saveDraft();elements.draftSelect.value=name;loadDraft(false);
  });
  document.addEventListener('mailbot:rename-draft',event=>{
    const name=normalizeDraftName(event.detail.name), oldName=normalizeDraftName(elements.draftName.value);
    if(name===oldName)return;const collection=readDraftCollection();
    if(collection[name]){setStatus('A draft with this title already exists.','error');return;}
    clearTimeout(autosaveTimer);const draft=collectDraft();draft.draftName=name;
    if(draft.lastDelivery?.identity===campaignIdentity(oldName,draft.subject,draft.accountEmail))draft.lastDelivery={...draft.lastDelivery,identity:campaignIdentity(name,draft.subject,draft.accountEmail)};
    delete collection[oldName];collection[name]=draft;writeDraftCollection(collection);applyDraft(draft,false);
  });
  document.addEventListener('mailbot:delete-draft',event=>{
    const name=event.detail.name;clearTimeout(autosaveTimer);
    if(name!==elements.draftName.value)saveDraft();
    const collection=readDraftCollection();if(!collection[name])return;delete collection[name];writeDraftCollection(collection);
    const next=Object.keys(collection)[0];updateDraftSelectOptions(next || '');
    if(name===elements.draftName.value){if(next)applyDraft(collection[next],false);else document.getElementById('newDraft').click();}
  });
  document.addEventListener('mailbot:use-saved-list', event => {
    const name = event.detail?.name;
    const list = readTableCollection()[name];
    if (list && applyTableState(list, true)) { saveDraft(); setStatus(`Using ${name}.`, 'ok'); }
  });
  document.querySelector('#sidebarDrafts').addEventListener('click',event=>{
    const button=event.target.closest('[data-draft]');if(!button)return;
    clearTimeout(autosaveTimer);saveDraft();
    elements.draftSelect.value=button.dataset.draft;loadDraft(true);activatePage('message');
  });
  document.querySelector('#newDraft').addEventListener('click',()=>{
    clearTimeout(autosaveTimer);if(readDraftCollection()[elements.draftName.value])saveDraft();
    const collection=readDraftCollection();let name='New mail';let i=2;while(collection[name])name=`New mail ${i++}`;
    lastDelivery = null;
    setSelectedDraftName(name);elements.draftName.value=name;elements.subject.value='';elements.replyTo.value='';elements.body.value='<p>Hi {{firstName}},</p><p><br></p><p>Best,<br>The Social AI Club Team</p>';
    recipients=[];audienceSource=null;audienceDetails=null;recipientColumns=[{key:'name',label:'Name',role:'text'},{key:'email',label:'Email',role:'to'}];elements.tableName.value='Default list';syncRawRecipientsFromTable();updateTable();updatePreview();saveDraft();activatePage('recipients');
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
  document.getElementById('composerCanvas').hidden=mode!=='visual';
  document.querySelector('#formatToolbar').hidden=mode!=='visual';
  elements.body.hidden=mode==='visual';
  document.querySelector('#visualMode').classList.toggle('selected',mode==='visual');
  document.querySelector('#sourceMode').classList.toggle('selected',mode==='source');
  if(mode==='visual'){syncVisualEditor();requestAnimationFrame(fitComposerFrame);}
}

function setPreviewImagesBlocked(blocked) {
  previewImagesBlocked = blocked;
  document.dispatchEvent(new CustomEvent('mailbot:preview-images', {detail:{blocked}}));
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
  document.querySelector('#reusableListHelp').textContent = `${pendingReusableList.recipients.length} ${pendingReusableList.recipients.length === 1 ? "contact" : "contacts"} · Saved on this computer.`;
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
  getCurrentGroup:()=>({name:elements.tableName.value, draft:elements.draftName.value, details:audienceDetails}),
  getSavedLists:()=>readTableCollection(),
  renameSavedList,
  saveSnapshot:openReusableList,
  useSnapshot(snapshot) {
    hydrateRecipientData(snapshot.recipientColumns, snapshot.recipients, snapshot.audienceSource, snapshot.audienceDetails);
    elements.tableName.value = snapshot.tableName;
    updateTable(); updatePreview(); saveDraft();
    setStatus(`${recipients.length} ${recipients.length===1?'recipient':'recipients'} attached to this campaign.`, 'ok');
  }
})).catch(error => setStatus(`Audience selection could not start: ${error.message}`, 'error'));
uiInitialized = true;
const initialPage = window.location.hash.slice(1);
activatePage(['recipients','message','review','contacts','account','preview','send'].includes(initialPage) ? initialPage : 'recipients');

import('./table-layout.js').then(({initContentSizedTables})=>initContentSizedTables());


function campaignProgress(progress, identity, activeIdentity, receipt) {
  if (progressMatchesCampaign(progress, identity, activeIdentity) && progress.total) return progress;
  if (receipt?.identity !== identity || !receipt.emails?.length) return null;
  return { state: 'finished', total: receipt.total || receipt.emails.length,
    processed: receipt.emails.length + (receipt.failed || 0), sent: receipt.emails.length,
    failed: receipt.failed || 0, skipped: 0, updatedAt: receipt.completedAt,
    phase: 'Delivery recorded for this campaign.' };
}

function renderCampaignProgress(progress) {
  const panel = document.getElementById('sendProgress');
  if (!panel) return;
  const current = campaignProgress(progress, currentCampaignIdentity(), activeSendIdentity, lastDelivery);
  panel.hidden = !current;
  const stopButton = document.getElementById('stopSendButton');
  stopButton.hidden = !current || !['running', 'stopping'].includes(current.state);
  stopButton.disabled = current?.state !== 'running';
  stopButton.textContent = current?.state === 'stopping' ? 'Stopping…' : 'Stop sending';
  if (!current) return;
  const stale = Date.now() - Date.parse(current.lastActivity || current.updatedAt) > 60000;
  document.getElementById('sendProgressTitle').textContent = current.state === 'finished' ? (current.sent >= current.total && !current.failed ? 'Campaign sent' : 'Delivery finished') : current.state === 'stopped' ? 'Sending stopped' : current.state === 'stopping' ? 'Stopping send…' : current.state === 'interrupted' ? 'Send interrupted' : stale ? 'No recent progress' : 'Sending in progress';
  const bar = document.getElementById('sendProgressBar');
  bar.max = current.total; bar.value = current.processed;
  document.getElementById('sendProgressCounts').textContent = `${current.sent} sent · ${current.failed} failed · ${current.skipped} skipped · ${current.processed} / ${current.total} processed`;
  document.getElementById('sendProgressDetail').textContent = current.phase || '';
}

async function refreshSendProgress() {
  try {
    let response = await fetch('/api/send/status', {cache:'no-store'});
    if (!response.ok) response = await fetch('/send-progress.json', {cache:'no-store'});
    if (!response.ok) return;
    latestSendProgress = await response.json();
    const wasActive = serverSendActive;
    serverSendActive = ['running', 'observing', 'stopping'].includes(latestSendProgress?.state);
    renderCampaignProgress(latestSendProgress);
    if (serverSendActive) elements.sendButton.disabled = true;
    else if (wasActive) updatePreview();
  } catch {
    if (serverSendActive) document.getElementById('sendProgressDetail').textContent = 'Connection lost. Waiting for the delivery status.';
  }
}
document.getElementById('stopSendButton').addEventListener('click', async () => {
  const button = document.getElementById('stopSendButton');
  button.disabled = true;
  button.textContent = 'Stopping…';
  try {
    const response = await fetch('/api/send/stop', {method:'POST'});
    if (!response.ok) throw new Error('Could not request stop. Check the connection and try again.');
    setStatus('Stop requested. The current email may finish; no further emails will start.');
    await refreshSendProgress();
  } catch (error) {
    setStatus(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Stop sending';
  }
});
refreshSendProgress();
setInterval(refreshSendProgress, 2000);


async function refreshCredentialSession() {
  const status = document.getElementById('credentialSessionStatus');
  if (!status) return;
  const key = credentialKey();
  try {
    const response = await fetch('/api/account/session', {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({accountEmail:elements.accountEmail.value.trim(),authMode:elements.authMode.value})
    });
    if (!response.ok) throw new Error('Session unavailable');
    const data = await response.json();
    if (credentialKey() !== key) return;
    rememberedCredentialKey = data.available ? key : '';
    status.textContent = data.available
      ? 'Password remembered in Mailbot memory. Refreshing is fine. Restarting Mailbot or session expiry clears it.'
      : 'Connect once to remember your password in Mailbot memory for up to 8 hours (OAuth: 50 minutes). Nothing is saved to disk.';
    document.getElementById('forgetPasswordButton').hidden = !data.available;
    if (data.available && !elements.appPassword.value) elements.appPassword.placeholder = 'Remembered for this Mailbot session';
    updatePreview();
  } catch { rememberedCredentialKey = ''; updatePreview(); }
}
elements.accountEmail.addEventListener('change', () => { elements.appPassword.value = ''; refreshCredentialSession(); });
document.getElementById('forgetPasswordButton').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/account/forget', {method:'POST'});
    if (!response.ok) throw new Error('Could not forget the password.');
    rememberedCredentialKey = ''; elements.appPassword.value = '';
    updateAuthUi(); updatePreview();
    setStatus('Password forgotten. Enter it again to connect.', 'ok');
  } catch (error) { setStatus(error.message, 'error'); }
});
setInterval(refreshCredentialSession, 30_000);
refreshCredentialSession();
