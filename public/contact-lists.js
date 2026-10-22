// One visible list field, with the original consent record retained for delivery checks.
export function contactLists(p) {
  const tags = new Set(p.Lists || []);
  for (const origin of p.Origins || []) {
    const phase = /^(.*) application$/.exec(origin)?.[1];
    tags.add(phase ? `Application · ${phase}` : origin);
  }
  for (const phase of p['Application phases'] || []) tags.add(`Application · ${phase}`);
  for (const phase of p['Completed applications'] || []) tags.add(`${phase} · Submitted`);
  for (const phase of p['Incomplete applications'] || []) {
    if (!(p['Completed applications'] || []).includes(phase)) tags.add(`${phase} · Started`);
  }
  // An event RSVP records provenance, never marketing consent or attendance.
  for (const event of p['Luma events'] || []) tags.add(`Luma · ${event}`);
  for (const phase of p['Marketing opt-in phases'] || []) tags.add(`Marketing opt-in · ${phase}`);
  if (p['Current member'] === true) tags.add('Club member');
  if (/website|newsletter signup/i.test(String(p.Source || '')) || p['Consent method'] === 'Double opt-in') tags.add('Website newsletter');
  for (const status of ['Marketing opt-in', 'Marketing · Unsubscribed', 'Marketing · Pending confirmation']) tags.delete(status);
  if (p['Subscription status'] === 'Subscribed') tags.add('Marketing opt-in');
  if (p['Subscription status'] === 'Unsubscribed') tags.add('Marketing · Unsubscribed');
  if (p['Subscription status'] === 'Pending confirmation') tags.add('Marketing · Pending confirmation');
  return [...tags].sort((a,b)=>a.localeCompare(b,'en'));
}
