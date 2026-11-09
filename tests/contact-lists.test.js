import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveProperties,eligibility,filterAudience,recipientSnapshot} from '../public/audience.js';
test('one Touchpoints field retains event provenance, phase, stage and phase-specific consent',()=>{
 const p=deriveProperties({Origins:['Summer 2026 application','Luma'],'Completed applications':['Summer 2026'],'Incomplete applications':['Winter 2026'],'Marketing opt-in phases':['Summer 2026'],'Luma events':['Demo Day — 21 April 2026'],'Subscription status':'Subscribed','Current member':true,Lists:['Custom group']});
 for(const tag of ['Summer 26 · Application','Summer 26 · Submitted','Winter 26 · Started','Summer 26 · Opt-in','Luma Event · 21.04.26 · Demo Day','Member','Custom group'])assert.ok(p.Touchpoints.includes(tag),tag);
 assert.ok(!p.Touchpoints.includes('Winter 26 · Submitted'));
});
test('stale marketing tag never overrides opt-out and Luma never grants consent',()=>{
 for(const status of ['Unsubscribed','Not subscribed','Pending confirmation']){
  const c={properties:deriveProperties({Email:'alex@example.org',Lists:['Marketing opt-in'],'Subscription status':status,'Current member':false,Origins:['Luma']})};
  assert.ok(!c.properties.Touchpoints.includes('Opted in'));
  assert.equal(eligibility(c,'newsletter','Winter 2026'),false);
  assert.equal(eligibility(c,'recruiting','Winter 2026'),status!=='Unsubscribed');
 }
});
test('list filters combine with sending eligibility without changing who is eligible',()=>{
 const make=(id,props)=>({id,properties:deriveProperties({Name:id,Email:id+'@example.org','Current member':false,'Subscription status':'Subscribed',...props})});
 const contacts=[make('a',{'Completed applications':['Summer 2026']}),make('b',{'Incomplete applications':['Winter 2026'],'Application reminder eligible':true})];
 assert.deepEqual(filterAudience(contacts,{purpose:'recruiting',phase:'Winter 2026',filter:{property:'Lists',operator:'contains',value:'Summer 2026 · Submitted'}}).contacts.map(c=>c.id),['a']);
 assert.deepEqual(filterAudience(contacts,{purpose:'reminder',phase:'Winter 2026'}).contacts.map(c=>c.id),['b']);
});

test('saved filters and personalization keep working after the Touchpoints rename', () => {
 const contacts = [{ id: 'guest', properties: deriveProperties({
  Email: 'guest@example.org',
  Touchpoints: ['Luma Event · 13.10.26 · Demo Day 2'],
  'Luma events': ['Demo Day Second Edition — 13 October 2026']
 }) }];
 const oldEvent = 'Luma · Demo Day Second Edition — 13 October 2026';
 assert.deepEqual(contacts[0].properties.Touchpoints, ['Luma Event · 13.10.26 · Demo Day 2']);
 for (const filter of [
  { property: 'Lists', operator: 'equals', value: oldEvent },
  { property: 'Touchpoints', operator: 'contains', value: 'Luma · Demo Day', partialMatch: true }
 ]) assert.equal(filterAudience(contacts, { filter }).matched, 1);
 const snapshot = recipientSnapshot(contacts, ['Lists']);
 assert.equal(snapshot.recipientColumns.find(column => column.key === 'lists').label, 'Touchpoints');
 assert.equal(snapshot.recipients[0].lists, 'Luma Event · 13.10.26 · Demo Day 2');
});
