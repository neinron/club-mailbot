const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailInTextPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function detectDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t"].map((delimiter) => {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') {
        if (quoted && firstLine[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && firstLine[index] === delimiter) count += 1;
    }
    return { delimiter, count };
  });
  return counts.sort((a, b) => b.count - a.count)[0].count ? counts.sort((a, b) => b.count - a.count)[0].delimiter : ",";
}

export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function isEmailHeader(value) {
  const normalized = normalizeHeader(value);
  return ["email", "e-mail", "mail", "email address", "e-mail address", "adresse", "emailadresse"].includes(normalized)
    || /\b(email|e-mail|mail address)\b/.test(normalized);
}

function isNameHeader(value) {
  return ["name", "full name", "fullname", "attendee", "guest name", "first name", "firstname", "vorname", "nachname"].includes(normalizeHeader(value));
}

function hasHeader(row) {
  return row.some(isEmailHeader) || (row.some(isNameHeader) && !row.some((cell) => emailPattern.test(cell)));
}

function findEmail(row) {
  for (const cell of row) {
    const match = String(cell || "").trim().match(emailInTextPattern)?.[0]?.toLowerCase();
    if (match && emailPattern.test(match)) return match;
  }
  return "";
}

function rowToContact(row, header) {
  const emailColumn = header?.findIndex(isEmailHeader) ?? -1;
  const email = emailColumn >= 0
    ? String(row[emailColumn] || "").trim().match(emailInTextPattern)?.[0]?.toLowerCase() || ""
    : findEmail(row);
  if (!emailPattern.test(email)) return { email: "", name: "" };

  let name = "";
  if (header) {
    const firstIndex = header.findIndex((value) => ["first name", "firstname", "vorname"].includes(normalizeHeader(value)));
    const lastIndex = header.findIndex((value) => ["last name", "lastname", "nachname"].includes(normalizeHeader(value)));
    if (firstIndex >= 0 || lastIndex >= 0) {
      name = [row[firstIndex] || "", row[lastIndex] || ""].filter(Boolean).join(" ").trim();
    }
    if (!name) {
      const nameColumn = header.findIndex(isNameHeader);
      if (nameColumn >= 0) name = String(row[nameColumn] || "").trim();
    }
  }
  if (!name) {
    name = row
      .filter((cell) => cell && !emailInTextPattern.test(cell) && !/^https?:\/\//i.test(cell))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { name: name || email.split("@")[0], email };
}

function getContacts(text, { collectStats = false } = {}) {
  const rows = parseDelimited(text);
  const header = rows.length && hasHeader(rows[0]) ? rows.shift() : null;
  const contacts = rows.map((row) => rowToContact(row, header));
  if (!collectStats) return contacts;
  return { contacts, inputCount: rows.length };
}

function getAllEmails(text) {
  return parseDelimited(text)
    .flatMap((row) => row.map((cell) => String(cell || "").match(emailInTextPattern)?.[0]?.toLowerCase() || ""))
    .filter((email) => emailPattern.test(email));
}

export function prepareRecipients(inputText, exclusionTexts = []) {
  const { contacts, inputCount } = getContacts(inputText, { collectStats: true });
  const exclusions = new Set(exclusionTexts.flatMap(getAllEmails));
  const seen = new Set();
  const recipients = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let excludedCount = 0;

  for (const contact of contacts) {
    if (!emailPattern.test(contact.email)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(contact.email)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(contact.email);
    if (exclusions.has(contact.email)) {
      excludedCount += 1;
      continue;
    }
    recipients.push(contact);
  }

  return {
    recipients,
    stats: {
      inputCount,
      validCount: contacts.filter((contact) => emailPattern.test(contact.email)).length,
      invalidCount,
      duplicateCount,
      excludedCount
    }
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toImportCsv(recipients) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => [recipient.name, recipient.email].map(escapeCsv).join(","))
    .join("\n") + (recipients?.length ? "\n" : "");
}
