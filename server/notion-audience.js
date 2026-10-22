import { notionRequest, queryNotionSource, notionPropertyValue } from './notion-cli.js';
import { deriveProperties, eligibility } from '../public/audience.js';

export const defaultSourceId = 'ee78a5b5-8a15-48e5-b5fd-16f821e57d1c';
export const defaultDatabaseId = '8312015036a44b90be22b9b05cd1b9df';
export function notionConfig() {
  return { configured: Boolean(process.env.NOTION_API_KEY), sourceId: process.env.NOTION_DATA_SOURCE_ID || defaultSourceId,
    databaseUrl: process.env.NOTION_DATABASE_URL || `https://www.notion.so/${defaultDatabaseId}`,
    currentPhase: process.env.NOTION_CURRENT_APPLICATION_PHASE || 'Winter 2026' };
}
function value(property) {
  if (['created_time', 'last_edited_time'].includes(property.type)) return property[property.type];
  if (['created_by','last_edited_by'].includes(property.type)) return property[property.type]?.name || '';
  if (property.type === 'people') return property.people.map(p => p.name || p.id);
  if (property.type === 'formula') return value(property.formula);
  if (property.type === 'relation') return property.relation.map(p => p.id);
  return notionPropertyValue(property);
}
export function contactFromPage(page) {
  return { id: page.id, url: page.url, properties: deriveProperties(Object.fromEntries(Object.entries(page.properties || {}).map(([k,p]) => [k, value(p)]))) };
}
export async function loadNotionAudience() {
  const config = notionConfig();
  if (!config.configured) throw new Error('Notion is not configured. Add NOTION_API_KEY to the local .env file and restart Mailbot.');
  const schema = await notionRequest(`/data_sources/${encodeURIComponent(config.sourceId)}`);
  const pages = await queryNotionSource(config.sourceId);
  const contacts = pages.filter(p => !p.archived && !p.in_trash).map(contactFromPage);
  const fields = Object.entries(schema.properties).map(([name,p]) => ({ name,
    type: ['title','rich_text','email','url','phone_number'].includes(p.type) ? 'text' : ['created_time','last_edited_time'].includes(p.type) ? 'date' : p.type === 'status' ? 'select' : ['select','multi_select','checkbox','number','date'].includes(p.type) ? p.type : 'text',
    options: (p[p.type]?.options || []).map(o => o.name) }));
  for (const name of ['Completed applications','Incomplete applications','Marketing opt-in phases','Lists']) {
    const options = [...new Set(contacts.flatMap(c => c.properties[name]))].sort();
    const field = fields.find(f => f.name === name);
    if (field) field.options = [...new Set([...field.options, ...options])];
    else fields.push({ name, type: 'multi_select', options });
  }
  return { ...config, fields, contacts, loadedAt: new Date().toISOString() };
}

// Re-read Notion before delivery: a saved local snapshot cannot override an opt-out
// or a subsequently completed application. No SMTP action happens in this module.
export async function validateNotionRecipients(recipients, audience) {
  const notionRows = recipients.filter(r => r.notionPageId);
  if (!notionRows.length && !audience) return;
  if (audience && notionRows.length !== recipients.length) throw new Error('Every contact in a Notion audience needs its original Notion Page ID. Reload the saved audience.');
  const config = notionConfig();
  if (!audience || audience.sourceId !== config.sourceId || !['newsletter','recruiting','reminder','deadline'].includes(audience.purpose)) {
    throw new Error('Choose a sending purpose in the Notion audience browser. Review-only lists cannot be sent.');
  }
  if (audience.phase !== config.currentPhase) throw new Error('The current application phase has changed. Refresh this audience from Notion.');
  const pages = await queryNotionSource(config.sourceId);
  const byId = new Map(pages.filter(p => !p.archived && !p.in_trash).map(p => [p.id, contactFromPage(p)]));
  const emailCounts = new Map();
  for (const contact of byId.values()) {
    const email = String(contact.properties.Email || '').trim().toLowerCase();
    emailCounts.set(email, (emailCounts.get(email) || 0)+1);
  }
  for (const row of notionRows) {
    const current = byId.get(row.notionPageId);
    if (!current || emailCounts.get(row.email.toLowerCase()) !== 1 || String(current.properties.Email).toLowerCase() !== row.email.toLowerCase() || !eligibility(current, audience.purpose, config.currentPhase)) {
      throw new Error('This saved list contains a contact who is no longer eligible. Refresh and filter the Notion audience before sending.');
    }
  }
}
