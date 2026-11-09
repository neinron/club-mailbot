import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { notionPropertyValue } from './notion-cli.js';

const text = content => [{ type: 'text', text: { content: String(content).slice(0, 1900) } }];
const norm = email => String(email || '').trim().toLowerCase();

export function deliveryRecorder({ directory, sourceId, request, query }) {
  let syncing = false;
  const active = new Set();
  async function save(event) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, event.id + '.json');
    await writeFile(path + '.tmp', JSON.stringify(event), { mode: 0o600 });
    await rename(path + '.tmp', path);
  }
  async function prepare(recipients) {
    const schema = await request(`/data_sources/${sourceId}`);
    const pages = await query(sourceId), byEmail = new Map();
    for (const page of pages.filter(p => !p.archived && !p.in_trash)) {
      const email = norm(notionPropertyValue(page.properties.Email));
      const matches = byEmail.get(email) || []; matches.push(page); byEmail.set(email, matches);
    }
    const provenance = schema.properties.Touchpoints?.multi_select?.options?.some(option => option.name === 'Manual import')
      ? { Touchpoints: { multi_select: [{ name: 'Manual import' }] } }
      : {};
    const contacts = new Map();
    for (const recipient of recipients) {
      const email = norm(recipient.email), matches = byEmail.get(email) || [];
      if (matches.length > 1) throw Error('Duplicate Notion contacts must be reconciled before sending.');
      let page = matches[0];
      if (recipient.notionPageId && (!page || page.id !== recipient.notionPageId)) throw Error('Notion contact identity changed. Refresh the list.');
      if (!page) {
        page = await request('/pages', { method: 'POST', body: {
          parent: { type: 'data_source_id', data_source_id: sourceId },
          properties: { Name: { title: text(recipient.name || email) }, Email: { email },
            'Subscription status': { select: { name: 'Not subscribed' } },
            ...provenance }
        } });
        byEmail.set(email, [page]);
      }
      contacts.set(email, { email, pageId: page.id });
    }
    return contacts;
  }
  async function previousAttempt(metadata) {
    let files;
    try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const emails = new Set(metadata.contacts.map(contact=>norm(contact.email)));
    for (const file of files.filter(name=>/^[a-f0-9-]+\.json$/.test(name))) {
      const event = JSON.parse(await readFile(join(directory,file),'utf8'));
      if (event.campaign === metadata.campaign && event.subject === metadata.subject && norm(event.sender) === norm(metadata.sender) && ['Sent','Unknown'].includes(event.status) && event.contacts.some(contact=>emails.has(norm(contact.email)))) return event.status;
    }
    return null;
  }
  async function begin(metadata) {
    const event = { ...metadata, id: randomUUID(), at: new Date().toISOString(), status: 'Unknown', pending: true, completedPages: [] };
    await save(event); // If local journaling fails, SMTP must not start.
    active.add(event.id);
    return event;
  }
  async function sync(event) {
    for (const contact of event.contacts) {
      if (event.completedPages.includes(contact.pageId)) continue;
      const page = await request(`/pages/${contact.pageId}`);
      if (page.archived || page.in_trash || norm(notionPropertyValue(page.properties.Email)) !== contact.email) throw Error('Audit contact changed or was removed.');
      const marker = `Mailbot delivery ${event.id}`;
      let cursor, found = false;
      do {
        const blocks = await request(`/blocks/${contact.pageId}/children?page_size=100${cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''}`);
        found ||= blocks.results.some(block => (block[block.type]?.rich_text || []).map(t => t.plain_text || t.text?.content || '').join('').includes(marker));
        cursor = blocks.has_more ? blocks.next_cursor : null;
      } while (cursor && !found);
      if (!found) {
        await request(`/blocks/${contact.pageId}/children`, { method: 'PATCH', body: { children: [{ object: 'block', type: 'paragraph', paragraph: {
          rich_text: text(`${marker}\n${event.status === 'Sent' ? 'Sent (accepted by SMTP; inbox delivery is not verified)' : event.status === 'Failed' ? 'Failed (SMTP did not confirm acceptance)' : 'Unknown (interrupted attempt; check before retrying)'}\nTime: ${event.at}\nCampaign: ${event.campaign}\nSubject: ${event.subject}\nSender: ${event.sender}\nPurpose: ${event.purpose || 'Manual list'}`)
        } }] } });
      }
      event.completedPages.push(contact.pageId); await save(event);
    }
    event.pending = false; await save(event);
  }
  async function finish(event, status) {
    try {
      event.status = status; event.at = new Date().toISOString();
      await save(event);
      try { await sync(event); return null; }
      catch { return 'Email result saved locally; Notion history is pending. Do not resend successful emails.'; }
    } finally { active.delete(event.id); }
  }
  async function retry() {
    if (syncing) return;
    syncing = true;
    let pending = 0;
    try {
      let files;
      try { files = await readdir(directory); } catch (e) { if (e.code === 'ENOENT') return { pending: 0 }; throw e; }
      for (const file of files.filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
        const event = JSON.parse(await readFile(join(directory, file), 'utf8'));
        if (!event.pending || active.has(event.id)) continue;
        try { await sync(event); } catch { pending++; }
      }
      return { pending };
    } finally { syncing = false; }
  }
  return { prepare, begin, finish, retry, previousAttempt };
}
