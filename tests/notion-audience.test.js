import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationHistory,deriveProperties,eligibility,matchFilter,filterAudience,recipientSnapshot} from '../public/audience.js';
import {validateNotionRecipients,defaultSourceId} from '../server/notion-audience.js';
const phase='Winter 2026';
const contact=(id,properties={})=>({id,properties:deriveProperties({Name:'Alex Example','First name':'Alex','Last name':'Example',Email:`${id}@example.org`,'Subscription status':'Subscribed','Current member':false,...properties})});

test('application history separates phases, completion and finalized marketing opt-ins',()=>{
 const h=applicationHistory({'Application state':'Summer 2026: completed; Winter 2026: partial','Source records':'Tally kd5oKM | old | completed | newsletter opt-in: yes\nTally 0QXpQA | new | partial | newsletter opt-in: yes'});
 assert.deepEqual(h,{complete:['Summer 2026'],partial:[phase],optIns:['Summer 2026']});
 assert.deepEqual(applicationHistory({'Application state':'Winter 2026: partial; Winter 2026: completed'}).partial,[]);
});
test('recruiting, newsletters, reminders and review audiences are distinct',()=>{
 const previous=contact('previous',{'Application state':'Summer 2026: completed'});
 const started=contact('started',{'Application state':'Winter 2026: partial','Application reminder eligible':true,'Subscription status':'Not subscribed'});
 const done=contact('done',{'Application state':'Winter 2026: completed','Application reminder eligible':true});
 const member=contact('member',{'Current member':true});
 const event=contact('event',{'Subscription status':'Not subscribed',Origins:['Luma']});
 const contacts=[previous,started,done,member,event];
 assert.deepEqual(filterAudience(contacts,{purpose:'recruiting',phase}).contacts.map(c=>c.id),['previous','event']);
 assert.deepEqual(filterAudience(contacts,{purpose:'reminder',phase}).contacts.map(c=>c.id),['started']);
 assert.equal(filterAudience(contacts,{purpose:'newsletter',phase}).contacts.length,3);
 assert.equal(filterAudience(contacts,{purpose:'browse',phase}).contacts.length,5);
 assert.equal(eligibility(done,'reminder',phase),false);
 assert.equal(eligibility(contact('unknown',{'Current member':null}),'recruiting',phase),false);
});
test('nested filters narrow an eligible audience and preserve false/empty/multiple values',()=>{
 const props={Email:'Alex@example.org','Current member':false,Origins:['Luma','Winter 2026 application'],'Confirmed At':'2026-10-15',Score:4};
 assert.equal(matchFilter(props,{match:'all',rules:[{property:'Current member',operator:'equals',value:'false'},{match:'any',rules:[{property:'Origins',operator:'contains',value:'Luma'},{property:'Email',operator:'contains',value:'nomatch'}]},{property:'Score',operator:'gte',value:4}]}),true);
 assert.equal(matchFilter(props,{property:'Email',operator:'not_contains',value:'alex'}),false);
 assert.equal(matchFilter(props,{property:'Confirmed At',operator:'before',value:'2026-10-16'}),true);
 assert.equal(matchFilter(props,{property:'Missing',operator:'empty'}),true);
 const snapshot=recipientSnapshot([{id:'page',properties:props}],['Current member','Origins']);
 assert.equal(snapshot.recipients[0].notionPageId,'page');
 assert.equal(snapshot.recipients[0].currentMember,'false');
 assert.equal(snapshot.recipients[0].origins,'Luma; Winter 2026 application');
 assert.equal(snapshot.recipientColumns.find(c=>c.key==='firstName').label,'First name');
});
test('delivery revalidates consent, completion, membership and contact identity from Notion',async()=>{
 const savedEnv={...process.env},originalFetch=global.fetch;
 process.env.NOTION_DATA_SOURCE_ID=defaultSourceId;process.env.NOTION_API_KEY='synthetic-test';process.env.NOTION_CURRENT_APPLICATION_PHASE=phase;
 let c=contact('page');
 global.fetch=async()=>new Response(JSON.stringify({results:[{id:'page',properties:Object.fromEntries(Object.entries(c.properties).map(([k,v])=>[k,typeof v==='boolean'?{type:'checkbox',checkbox:v}:Array.isArray(v)?{type:'multi_select',multi_select:v.map(name=>({name}))}:{type:'rich_text',rich_text:[{plain_text:v}]}]))}],has_more:false}),{status:200});
 const audience={sourceId:defaultSourceId,purpose:'recruiting',phase};
 const recipients=[{notionPageId:'page',email:'page@example.org'}];
 try{
  await validateNotionRecipients(recipients,audience);
  for(const props of [{'Subscription status':'Unsubscribed'},{'Current member':true},{'Application state':'Winter 2026: completed'}]){
   c=contact('page',props);await assert.rejects(validateNotionRecipients(recipients,audience),/no longer eligible/);
  }
  await assert.rejects(validateNotionRecipients(recipients,{...audience,purpose:'browse'}),/Review-only/);
  await assert.rejects(validateNotionRecipients(recipients,{...audience,phase:'Summer 2026'}),/phase has changed/);
 }finally{global.fetch=originalFetch;process.env=savedEnv;}
});

test('structured Notion properties are authoritative after migration',()=>{
 const p=deriveProperties({'Completed applications':[], 'Incomplete applications':['Winter 2026'],'Marketing opt-in phases':[],'Application state':'Winter 2026: completed','Source records':'Tally 0QXpQA | completed | newsletter opt-in: yes'});
 assert.deepEqual(p['Completed applications'],[]);assert.deepEqual(p['Incomplete applications'],['Winter 2026']);assert.deepEqual(p['Marketing opt-in phases'],[]);
 assert.equal(matchFilter({at:'2026-10-18T17:30:00Z'},{property:'at',operator:'on',value:'2026-10-18'}),true);
});

test('ambiguous duplicate addresses and invalid addresses never form a sending audience',()=>{
 const yes=contact('a',{Email:'same@example.org'}),no=contact('b',{Email:'SAME@example.org','Subscription status':'Unsubscribed'});
 const invalid=contact('invalid',{Email:'not-an-email'});
 assert.equal(filterAudience([yes,no,invalid],{purpose:'newsletter',phase}).contacts.length,0);
 assert.equal(filterAudience([yes,no,invalid],{purpose:'browse',phase}).contacts.length,3);
});

test('each following filter can independently join with AND or OR in displayed order',()=>{
 const yes={property:'Name',operator:'equals',value:'Alex'},no={property:'Name',operator:'equals',value:'Sam'};
 assert.equal(matchFilter({Name:'Alex'},{match:'all',rules:[yes,{...no,join:'any'}]}),true);
 assert.equal(matchFilter({Name:'Alex'},{match:'any',rules:[yes,{...no,join:'all'}]}),false);
 assert.equal(matchFilter({Name:'Alex'},{rules:[yes,{...no,join:'any'},{...no,join:'all'}]}),false);
 assert.equal(matchFilter({Name:'Alex'},{rules:[no,{rules:[yes,no],match:'any',join:'any'}]}),true);
 assert.equal(matchFilter({Name:'Alex'},{rules:[no,{...no,join:'all'},{...yes,join:'any'}]}),true);
});

test('application invitations allow absent opt-in but always respect active opt-outs',()=>{
 for(const status of ['Subscribed','Not subscribed','Pending confirmation','',undefined]){
  const c=contact('eligible',{'Subscription status':status});
  assert.equal(eligibility(c,'recruiting',phase),true);
  assert.equal(eligibility(c,'newsletter',phase),status==='Subscribed');
 }
 assert.equal(eligibility(contact('unsubscribed',{'Subscription status':'Unsubscribed'}),'recruiting',phase),false);
 for(const props of [{'Current member':true},{'Incomplete applications':[phase]},{'Completed applications':[phase]},{Email:'invalid'}]){
  assert.equal(eligibility(contact('excluded',{'Subscription status':'Not subscribed',...props}),'recruiting',phase),false);
 }
});
