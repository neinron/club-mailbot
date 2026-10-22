import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveProperties,eligibility,filterAudience} from '../public/audience.js';
test('one Lists field retains event provenance, phase, stage and phase-specific consent',()=>{
 const p=deriveProperties({Origins:['Summer 2026 application','Luma'],'Completed applications':['Summer 2026'],'Incomplete applications':['Winter 2026'],'Marketing opt-in phases':['Summer 2026'],'Luma events':['Demo Day'],'Subscription status':'Subscribed','Current member':true,Lists:['Custom group']});
 for(const tag of ['Application · Summer 2026','Summer 2026 · Submitted','Winter 2026 · Started','Marketing opt-in · Summer 2026','Marketing opt-in','Luma · Demo Day','Club member','Custom group'])assert.ok(p.Lists.includes(tag),tag);
 assert.ok(!p.Lists.includes('Winter 2026 · Submitted'));
});
test('stale marketing tag never overrides opt-out and Luma never grants consent',()=>{
 for(const status of ['Unsubscribed','Not subscribed','Pending confirmation']){
  const c={properties:deriveProperties({Email:'alex@example.org',Lists:['Marketing opt-in'],'Subscription status':status,'Current member':false,Origins:['Luma']})};
  assert.ok(!c.properties.Lists.includes('Marketing opt-in'));
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
