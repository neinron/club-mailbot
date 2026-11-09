export const touchpointField = 'Touchpoints';

const renamedTags = [
  ['Website newsletter', 'Web signup'],
  ['Club member', 'Member'],
  ['Marketing opt-in', 'Opted in'],
  ['Marketing · Unsubscribed', 'Unsubscribed'],
  ['Marketing · Pending confirmation', 'Opt-in pending'],
  ['Luma · Demo Day — 21 April 2026', 'Luma Event · 21.04.26 · Demo Day'],
  ['Luma · Online Application Q&A — 27 April 2026', 'Luma Event · 27.04.26 · App Q&A'],
  ['Luma · Reliable AI: TUM Social AI Club x AWS — 21 May 2026', 'Luma Event · 21.05.26 · Reliable AI'],
  ['Luma · From Prompts to Agents — 8 October 2026', 'Luma Event · 08.10.26 · AI Agents'],
  ['Luma · Demo Day Second Edition — 13 October 2026', 'Luma Event · 13.10.26 · Demo Day 2']
];
const newLabels = new Map(renamedTags.map(([old, label]) => [old.toLowerCase(), label]));
const oldLabels = new Map(renamedTags.map(([old, label]) => [label, old]));
const months = 'January February March April May June July August September October November December'.split(' ');

export function touchpointLabel(tag) {
  const known = newLabels.get(tag.toLowerCase());
  if (known) return known;
  const phase = tag.match(/^(?:(Application|Marketing opt-in) · )?((?:Summer|Winter) )20(\d{2})( · (?:Started|Submitted))?$/i);
  if (phase && (phase[1] || phase[4])) return phase[2] + phase[3] + (phase[1] ? ` · ${phase[1].toLowerCase() === 'application' ? 'Application' : 'Opt-in'}` : phase[4] || '');
  if (!tag.startsWith('Luma · ')) return tag;
  const event = tag.slice('Luma · '.length);
  const date = event.match(/^(.*?) — (\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  const month = date ? months.indexOf(date[3]) + 1 : 0;
  if (!month) return `Luma Event · ${event}`;
  const [, name, day, , year] = date;
  return `Luma Event · ${day.padStart(2, '0')}.${String(month).padStart(2, '0')}.${year.slice(-2)} · ${name}`;
}

export function legacyTouchpointLabel(tag) {
  if (oldLabels.has(tag)) return oldLabels.get(tag);
  const phase = tag.match(/^((?:Summer|Winter) )(\d{2}) · (Application|Opt-in|Started|Submitted)$/i);
  if (!phase) return tag;
  const season = phase[1] + '20' + phase[2];
  if (phase[3] === 'Application') return `Application · ${season}`;
  if (phase[3] === 'Opt-in') return `Marketing opt-in · ${season}`;
  return `${season} · ${phase[3]}`;
}

// Derive labels from source fields. Consent and eligibility remain separate.
export function contactLists(p) {
  const tags = new Set((p[touchpointField] || p.Lists || []).map(touchpointLabel));
  for (const origin of p.Origins || []) {
    const phase = /^(.*) application$/.exec(origin)?.[1];
    if (origin === 'Website') tags.add('Web signup');
    else if (origin === 'Mailbot') tags.add('Manual import');
    else tags.add(phase ? touchpointLabel(`Application · ${phase}`) : origin);
  }
  const phases = [...(p['Application phases'] || []), ...(p['Completed applications'] || []), ...(p['Incomplete applications'] || [])];
  for (const phase of phases) tags.add(touchpointLabel(`Application · ${phase}`));
  for (const phase of p['Completed applications'] || []) tags.add(touchpointLabel(`${phase} · Submitted`));
  for (const phase of p['Incomplete applications'] || []) {
    if (!(p['Completed applications'] || []).includes(phase)) tags.add(touchpointLabel(`${phase} · Started`));
  }
  for (const event of p['Luma events'] || []) tags.add(touchpointLabel(`Luma · ${event}`));
  for (const phase of p['Marketing opt-in phases'] || []) tags.add(touchpointLabel(`Marketing opt-in · ${phase}`));
  if (p['Current member'] === true) tags.add('Member');
  if (/website|newsletter signup/i.test(String(p.Source || '')) || p['Consent method'] === 'Double opt-in') tags.add('Web signup');
  for (const status of ['Opted in', 'Unsubscribed', 'Opt-in pending']) tags.delete(status);
  return [...tags].sort((a,b)=>a.localeCompare(b,'en'));
}
