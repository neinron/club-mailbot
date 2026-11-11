import { contactLists, legacyTouchpointLabel, touchpointField, touchpointLabel } from './contact-lists.js';
import { attachNotionFields } from './notion-fields.js';
// Shared by the browser and server so saved audiences use the same rules.
export const purposes = {
  recruiting: 'Recruiting invitation', newsletter: 'Newsletter',
  reminder: 'Finish your application', deadline: 'Application deadline', browse: 'Browse all contacts (review only)'
};

export function applicationHistory(properties) {
  const hasComplete = Array.isArray(properties['Completed applications']);
  const hasPartial = Array.isArray(properties['Incomplete applications']);
  const hasOptIns = Array.isArray(properties['Marketing opt-in phases']);
  const complete = new Set(properties['Completed applications'] || []);
  const partial = new Set(properties['Incomplete applications'] || []);
  const optIns = new Set(properties['Marketing opt-in phases'] || []);
  for (const match of String(properties['Application state'] || '').matchAll(/([^;]+?):\s*(completed|partial)/g)) {
    if (match[2] === 'completed' && !hasComplete) complete.add(match[1].trim());
    if (match[2] === 'partial' && !hasPartial) partial.add(match[1].trim());
  }
  for (const line of String(properties['Source records'] || '').split(/\n|<br\s*\/?\s*>/i)) {
    const phase = /Tally kd5oKM\b/.test(line) ? 'Summer 2026' : /Tally 0QXpQA\b/.test(line) ? 'Winter 2026' : null;
    if (!hasOptIns && phase && /\bcompleted\b/.test(line) && /newsletter opt-in:\s*yes/i.test(line)) optIns.add(phase);
  }
  for (const phase of complete) partial.delete(phase);
  return { complete: [...complete], partial: [...partial], optIns: [...optIns] };
}

export function deriveProperties(properties) {
  const history = applicationHistory(properties);
  const result = { ...properties, 'Completed applications': history.complete,
    'Incomplete applications': history.partial, 'Marketing opt-in phases': history.optIns };
  result['Application phases'] ??= [...new Set([...history.complete, ...history.partial])];
  result['Luma check-in recorded'] ??= /\bchecked in: \d{4}-\d{2}-\d{2}T/.test(String(properties['Source records'] || ''));
  result[touchpointField] = contactLists(result);
  result.Origins ??= result[touchpointField].flatMap(tag => {
    if (tag === 'Web signup') return ['Website'];
    if (tag === 'Manual import') return ['Mailbot'];
    if (tag === 'Luma') return [tag];
    const match = legacyTouchpointLabel(tag).match(/^Application · (.+)$/);
    return match ? [`${match[1]} application`] : [];
  });
  result['Newsletter opt-in recorded'] ??= history.optIns.length > 0
    || /newsletter opt-in:\s*yes/i.test(String(properties['Source records'] || ''))
    || ['Double opt-in', 'Imported opt-in'].includes(properties['Consent method']);
  delete result.Lists;
  return result;
}

export function eligibility(contact, purpose, phase) {
  const p = contact.properties;
  const complete = (p['Completed applications'] || []).includes(phase);
  const partial = (p['Incomplete applications'] || []).includes(phase);
  if (purpose === 'browse') return true;
  if (p['Email delivery status'] === 'Suppressed') return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.Email || '').trim())) return false;
  if (purpose === 'newsletter') return p['Subscription status'] === 'Subscribed';
  if (purpose === 'recruiting') return p['Subscription status'] !== 'Unsubscribed' && p['Current member'] === false && !complete && !partial;
  if (purpose === 'deadline') return p['Subscription status'] !== 'Unsubscribed' && p['Current member'] === false && !complete;
  if (purpose === 'reminder') return p['Current member'] === false && partial && !complete && p['Application reminder eligible'] === true;
  return false;
}

// An explicitly requested club-member copy is scoped to a particular contact
// and reminder audience. It never subscribes anyone or bypasses an opt-out.
export function memberCopyAllowed(contact, {purpose,memberCopies=[]} = {}) {
  const p=contact.properties;
  return p['Email delivery status'] !== 'Suppressed' && purpose === 'reminder' && p['Current member'] === true && p['Subscription status'] !== 'Unsubscribed' && memberCopies.some(copy=>copy.notionPageId === contact.id && String(copy.email||'').trim().toLowerCase() === String(p.Email||'').trim().toLowerCase());
}

const textOperators = ['equals','not_equals','contains','not_contains','starts_with','ends_with','empty','not_empty'];
export const operators = {
  text: textOperators, select: textOperators, multi_select: textOperators,
  checkbox: ['equals'], number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  date: ['on', 'before', 'after', 'on_or_before', 'on_or_after', 'empty', 'not_empty']
};

export function matchFilter(properties, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.rules)) {
    // Each row joins the accumulated result above it. Existing all/any groups
    // remain equivalent until a row explicitly changes its connector.
    if (!filter.rules.length) return true;
    let result = matchFilter(properties, filter.rules[0]);
    for (const rule of filter.rules.slice(1)) {
      const matches = matchFilter(properties, rule);
      result = (rule.join || filter.match) === 'any' ? result || matches : result && matches;
    }
    return result;
  }
  const isTouchpoint = Object.hasOwn(properties, touchpointField) && [touchpointField, 'Lists'].includes(filter.property);
  let actual = properties[isTouchpoint ? touchpointField : filter.property];
  const empty = actual == null || actual === '' || (Array.isArray(actual) && !actual.length);
  if (filter.operator === 'empty') return empty;
  if (filter.operator === 'not_empty') return !empty;
  if (typeof actual === 'boolean') return filter.operator === 'equals' && actual === (filter.value === true || filter.value === 'true');
  const a = String(actual ?? '').toLocaleLowerCase();
  const query = String(filter.value ?? '');
  const b = (isTouchpoint && !filter.partialMatch ? touchpointLabel(query) : query).toLocaleLowerCase();
  // Older saved filters can still select a subscription status by its former tag.
  const oldStatusTag = {Subscribed:'Opted in',Unsubscribed:'Unsubscribed','Pending confirmation':'Opt-in pending'}[properties['Subscription status']];
  if (isTouchpoint && Array.isArray(actual) && oldStatusTag) actual = [...actual, oldStatusTag];
  const anyValue = predicate => Array.isArray(actual)
    ? actual.some(value=>predicate(String(value).toLocaleLowerCase()))
    : predicate(a);
  const contains = () => Array.isArray(actual)
    ? actual.some(value => {
        const item = String(value).toLocaleLowerCase();
        return filter.partialMatch
          ? item.includes(b) || (isTouchpoint && legacyTouchpointLabel(value).toLocaleLowerCase().includes(b))
          : item === b;
      })
    : a.includes(b);
  const equals = () => Array.isArray(actual)
    ? actual.some(item=>String(item).toLocaleLowerCase()===b)
    : a===b;
  switch (filter.operator) {
    case 'contains': return contains();
    case 'not_contains': return !contains();
    case 'equals': return equals();
    case 'not_equals': return !equals();
    case 'starts_with': return anyValue(value=>value.startsWith(b));
    case 'ends_with': return anyValue(value=>value.endsWith(b));
    case 'on': return !empty && a.slice(0,10) === b.slice(0,10);
    case 'on_or_before': return !empty && a.slice(0,10) <= b.slice(0,10);
    case 'on_or_after': return !empty && a.slice(0,10) >= b.slice(0,10);
    case 'before': return !empty && Date.parse(actual) < Date.parse(filter.value);
    case 'after': return !empty && Date.parse(actual) > Date.parse(filter.value);
    case 'gt': return !empty && Number(actual) > Number(filter.value);
    case 'gte': return !empty && Number(actual) >= Number(filter.value);
    case 'lt': return !empty && Number(actual) < Number(filter.value);
    case 'lte': return !empty && Number(actual) <= Number(filter.value);
    default: return false;
  }
}

export function filterAudience(contacts, { purpose = 'browse', phase, filter, search = '', sortProperty = 'Name', sortDirection = 'asc', limit = 0, memberCopies = [] } = {}) {
  const query = search.trim().toLocaleLowerCase();
  const emails = new Map();
  for (const c of contacts) {
    const email = String(c.properties.Email || '').trim().toLowerCase();
    emails.set(email, (emails.get(email) || 0)+1);
  }
  const eligible = contacts.filter(c => (eligibility(c, purpose, phase) || memberCopyAllowed(c,{purpose,memberCopies})) && (purpose === 'browse' || emails.get(String(c.properties.Email || '').trim().toLowerCase()) === 1));
  const matched = eligible.filter(c => matchFilter(c.properties, filter) && (!query || Object.values(c.properties).some(v => String(v ?? '').toLocaleLowerCase().includes(query))));
  matched.sort((a,b) => {
    const x = a.properties[sortProperty], y = b.properties[sortProperty];
    const order = typeof x === 'number' && typeof y === 'number' ? x-y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
    return sortDirection === 'desc' ? -order : order;
  });
  return { contacts: limit > 0 ? matched.slice(0, limit) : matched, eligible: eligible.length, matched: matched.length, excluded: contacts.length-eligible.length };
}

export function recipientSnapshot(contacts, fields, schema = []) {
  const canonical = { Name: 'name', 'First name': 'firstName', 'Last name': 'lastName', Email: 'email', [touchpointField]: 'lists', 'Marketing opt-in phases': 'marketingOptInPhases', 'Newsletter opt-in recorded': 'newsletterOptInRecorded', 'Luma check-in recorded': 'lumaCheckInRecorded' };
  const selected = [...new Set(['Name', 'First name', 'Last name', 'Email', ...fields.map(name => name === 'Lists' ? touchpointField : name)])];
  const used = new Set(['notionPageId']);
  const columns = selected.map((label, index) => {
    const words = label.normalize('NFKD').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
    const camel = words.map((word,i)=>i ? word[0].toUpperCase()+word.slice(1) : word[0]?.toLowerCase()+word.slice(1)).join('');
    let key = canonical[label] || (/^[a-zA-Z]/.test(camel) ? camel : `notionField${index}`);
    if (used.has(key) || ['constructor','prototype','__proto__'].includes(key)) key = `notionField${index}`;
    used.add(key);
    return { label, key, role: label === 'Email' ? 'to' : 'text' };
  });
  columns.push({ key: 'notionPageId', label: 'Notion Page ID', role: 'text' });
  const recipients = contacts.map(c => Object.fromEntries(columns.map(col => {
    const value = col.key === 'notionPageId' ? c.id : c.properties[col.label];
    return [col.key, Array.isArray(value) ? value.join('; ') : typeof value === 'boolean' ? String(value) : String(value ?? '')];
  })));
  return { recipientColumns: attachNotionFields(columns, schema), recipients };
}
