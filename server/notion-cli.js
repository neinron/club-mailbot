const apiVersion = "2025-09-03";

function getToken() {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("Set NOTION_API_KEY in your environment; never pass secrets as command-line arguments.");
  return token;
}

export async function notionRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, "Notion-Version": process.env.NOTION_VERSION || apiVersion, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${data.message || response.statusText}`);
  return data;
}

export function notionPropertyValue(property) {
  if (!property) return null;
  if (property.type === "title" || property.title) return (property.title || []).map((part) => part.plain_text || "").join("");
  if (property.type === "rich_text" || property.rich_text) return (property.rich_text || []).map((part) => part.plain_text || "").join("");
  if (property.type === "email") return property.email || "";
  if (property.type === "checkbox") return Boolean(property.checkbox);
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "status") return property.status?.name || "";
  if (property.type === "multi_select") return (property.multi_select || []).map((item) => item.name);
  if (property.type === "phone_number") return property.phone_number || "";
  if (property.type === "url") return property.url || "";
  if (property.type === "date") return property.date?.start || "";
  if (property.type === "number") return property.number;
  return null;
}

export async function queryNotionSource(sourceId, filter) {
  const all = [];
  let start_cursor;
  do {
    const result = await notionRequest(`/data_sources/${encodeURIComponent(sourceId)}/query`, { method: "POST", body: { page_size: 100, ...(start_cursor ? { start_cursor } : {}), ...(filter ? { filter } : {}) } });
    all.push(...(result.results || []));
    start_cursor = result.has_more ? result.next_cursor : null;
  } while (start_cursor);
  return all;
}

export async function updateNotionCheckbox(pageId, propertyName, value) {
  const page = await notionRequest(`/pages/${encodeURIComponent(pageId)}`);
  const properties = page.properties?.['Subscription status']?.type === 'select'
    ? {
      'Subscription status': { select: { name: value ? 'Subscribed' : 'Unsubscribed' } },
      ...(page.properties?.Subscribed?.type === 'checkbox' ? { Subscribed: { checkbox: Boolean(value) } } : {}),
      ...(!value ? { 'Unsubscribed at': { date: { start: new Date().toISOString() } } } : {}),
    }
    : page.properties?.[propertyName]?.type === 'select'
      ? { [propertyName]: { select: { name: value ? 'Subscribed' : 'Unsubscribed' } } }
      : { [propertyName]: { checkbox: Boolean(value) } };
  return notionRequest(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: { properties }
  });
}

export function isNotionSubscribed(page, propertyName = 'Subscribed') {
  const status = page.properties?.['Subscription status'];
  if (status) return notionPropertyValue(status) === 'Subscribed';
  const value = notionPropertyValue(page.properties?.[propertyName]);
  return value === true || value === 'Subscribed';
}

export async function createNotionNewsletterPage({ sourceId, name, email, confirmedAt, source = "Website" }, fields = {}) {
  const { nameProperty = "Name", emailProperty = "Email", subscribedProperty = "Subscribed", dateProperty = "Confirmed At", sourceProperty = "Source" } = fields;
  const properties = {
    [nameProperty]: { title: [{ text: { content: name } }] },
    [emailProperty]: { email },
    [subscribedProperty]: { checkbox: true },
    [dateProperty]: { date: { start: confirmedAt } },
    [sourceProperty]: { rich_text: [{ text: { content: source } }] }
  };
  return notionRequest("/pages", {
    method: "POST",
    body: { parent: { type: "data_source_id", data_source_id: sourceId }, properties }
  });
}

export async function updateNotionNewsletterPage(pageId, { name, confirmedAt, source = "Website" }, fields = {}) {
  const { nameProperty = "Name", subscribedProperty = "Subscribed", dateProperty = "Confirmed At", sourceProperty = "Source" } = fields;
  return notionRequest(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: {
      properties: {
        [nameProperty]: { title: [{ text: { content: name } }] },
        [subscribedProperty]: { checkbox: true },
        [dateProperty]: { date: { start: confirmedAt } },
        [sourceProperty]: { rich_text: [{ text: { content: source } }] }
      }
    }
  });
}

export async function findNotionContacts({ sourceId, emailProperty, email, optInProperty, optIn = true }) {
  const matches = await queryNotionSource(sourceId, { property: emailProperty, email: { equals: email } });
  return matches.filter((page) => {
    if (optIn) return isNotionSubscribed(page, optInProperty);
    const status = page.properties?.['Subscription status'];
    return status ? notionPropertyValue(status) === 'Unsubscribed' : notionPropertyValue(page.properties?.[optInProperty]) === false;
  });
}
