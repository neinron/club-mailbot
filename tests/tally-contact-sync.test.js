import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTallyContact,normalizeEmail} from '../server/tally-contact-sync.js';
const row={id:'response',formId:'0QXpQA',phase:'Winter 2026',email:' ALEX@example.org ',firstName:'Alex',lastName:'Example',submittedAt:'2026-10-18T12:00:00Z',completed:false,optInAnswer:['Updates']};
test('completed responses supersede partials while retaining other phases and event provenance',()=>{
 const p=mergeTallyContact({'Incomplete applications':['Winter 2026'],'Completed applications':['Summer 2026'],Origins:['Luma'],Lists:['Custom list','Winter 2026 · Started'],'Luma events':['Demo Day'],'Subscription status':'Not subscribed'},[{...row,completed:true},row]);
 assert.deepEqual(p['Incomplete applications'],[]);assert.ok(p['Completed applications'].includes('Winter 2026'));assert.ok(p['Completed applications'].includes('Summer 2026'));
 assert.ok(!p.Lists.includes('Winter 2026 · Started'));assert.ok(p.Lists.includes('Winter 2026 · Submitted'));assert.ok(p.Lists.includes('Custom list'));assert.ok(p.Lists.includes('Luma · Demo Day'));
 assert.equal(p['Application reminder eligible'],false);assert.equal(p['Subscription status'],'Subscribed');
});
test('partial opt-in never subscribes and existing opt-out is never overwritten',()=>{
 assert.equal(mergeTallyContact(null,[row])['Subscription status'],'Not subscribed');
 const p=mergeTallyContact({'Subscription status':'Unsubscribed','Unsubscribed at':'2026-10-17'},[{...row,completed:true}]);
 assert.equal(p['Subscription status'],'Unsubscribed');assert.equal(p.Subscribed,false);assert.equal(p['Unsubscribed at'],'2026-10-17');
});
test('membership, confirmed consent and names are preserved; repeated sync is idempotent',()=>{
 const old={'Current member':true,'First name':'Existing','Last name':'Name',Name:'Existing Name','Subscription status':'Subscribed','Consent method':'Double opt-in','Confirmed At':'2026-10-16'};
 const p=mergeTallyContact(old,[row]);assert.equal(p['Application reminder eligible'],false);assert.equal(p['First name'],'Existing');assert.equal(p['Consent method'],'Double opt-in');assert.equal(p['Confirmed At'],'2026-10-16');
 assert.deepEqual(mergeTallyContact(p,[row]),p);
 assert.equal(normalizeEmail(' ALEX@Example.org '),'alex@example.org');assert.notEqual(normalizeEmail('alex+event@example.org'),normalizeEmail('alex@example.org'));
});
