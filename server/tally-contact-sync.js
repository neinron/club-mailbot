import { contactLists } from '../public/contact-lists.js';
import { deriveProperties } from '../public/audience.js';
export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
const unique = values => [...new Set(values.filter(Boolean))];
export function mergeTallyContact(existing, rows, currentPhase='Winter 2026', now=new Date().toISOString()) {
  const old=deriveProperties(existing||{}),p={...old};
  const ordered=[...rows].sort((a,b)=>Number(b.completed)-Number(a.completed)||String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const person=ordered.find(r=>String(r.firstName||r.lastName||'').trim())||ordered[0];
  p.Email=normalizeEmail(person.email);
  // Keep a real existing name; fill absent name components from the newest completed response.
  p['First name']=String(old['First name']||person.firstName||'').trim();
  p['Last name']=String(old['Last name']||person.lastName||'').trim();
  p.Name=String(old.Name||[p['First name'],p['Last name']].filter(Boolean).join(' ')||p.Email).trim();
  p.Origins=unique([...(old.Origins||[]),...rows.map(r=>r.phase+' application')]);
  p['Application phases']=unique([...(old['Application phases']||[]),...rows.map(r=>r.phase)]);
  p['Completed applications']=unique([...(old['Completed applications']||[]),...rows.filter(r=>r.completed).map(r=>r.phase)]);
  p['Incomplete applications']=unique([...(old['Incomplete applications']||[]),...rows.filter(r=>!r.completed).map(r=>r.phase)]).filter(phase=>!p['Completed applications'].includes(phase));
  const consentRows=rows.filter(r=>r.completed&&Array.isArray(r.optInAnswer)&&r.optInAnswer.length>0);
  p['Marketing opt-in phases']=unique([...(old['Marketing opt-in phases']||[]),...consentRows.map(r=>r.phase)]);
  p['Current member']=old['Current member']===true;
  p['Application reminder eligible']=p['Incomplete applications'].includes(currentPhase)&&!p['Current member'];
  p['Newsletter opt-in recorded']=old['Newsletter opt-in recorded']===true||consentRows.length>0;
  const status=old['Subscription status'];
  p['Subscription status']=status&&status!=='Not subscribed'?status:consentRows.length?'Subscribed':'Not subscribed';
  p.Subscribed=p['Subscription status']==='Subscribed';
  p['Contact purpose']=unique([...(old['Contact purpose']||[]).filter(v=>v!=='Application reminder'),...(p['Application reminder eligible']?['Application reminder']:[]),...(p.Subscribed?['Newsletter']:[])]);
  const evidence=String(old['Source records']||'').split('\n').filter(Boolean);
  for(const r of rows){
    const prefix=`Tally ${r.formId} | ${r.id} | `;
    // Historical evidence is appended, not erased when a partial is submitted.
    const line=prefix+`${r.completed?'completed':'partial'} | ${r.submittedAt} | newsletter opt-in: ${r.completed&&Array.isArray(r.optInAnswer)&&r.optInAnswer.length?'yes':'no'}`;
    if(!evidence.includes(line))evidence.push(line);
  }
  p['Source records']=unique(evidence).join('\n');
  p.Source=old.Source||'Tally';
  if(p['Subscription status']!==status){p['Status changed at']=now;p['Status change source']='Import';}
  if(p.Subscribed&&!old['Consent method'])p['Consent method']='Imported opt-in';
  if(p.Subscribed&&!old['Consent version']&&consentRows.length)p['Consent version']='Tally '+consentRows[0].formId+' completed opt-in';
  const phases=new Set(rows.map(r=>r.phase));
  p.Lists=(old.Lists||[]).filter(tag=>![...phases].some(phase=>[`${phase} · Started`,`${phase} · Submitted`,`Application · ${phase}`,`Marketing opt-in · ${phase}`].includes(tag)));
  p.Lists=contactLists(p);
  return p;
}
