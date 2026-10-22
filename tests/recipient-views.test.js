import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewSettings,activeViewFilter,namedViews} from '../public/recipient-views.js';
import {filterAudience} from '../public/audience.js';
test('opening the database starts with every contact regardless of campaign purpose',()=>{
 const contacts=[{id:'a',properties:{Name:'A',Email:'a@example.org','Subscription status':'Subscribed'}},{id:'b',properties:{Name:'B',Email:'b@example.org','Subscription status':'Not subscribed','Current member':true}}];
 const settings=viewSettings();
 assert.equal(filterAudience(contacts,{...settings,purpose:'browse'}).contacts.length,2);
 assert.equal(settings.purpose,undefined);
});
test('named list dropdown only uses locally saved list names, not Notion tags',()=>{
 assert.deepEqual(namedViews({'Recruiting list':{recipients:[]},'Event follow-up':{recipients:[]}}),['Event follow-up','Recruiting list']);
});
test('legacy saved filters survive opening as a database view without implicit purpose filtering',()=>{
 const source={purpose:'reminder',phase:'Winter 2026',list:'Winter 2026 · Started',filter:{match:'all',rules:[]},limit:50};
 const view=viewSettings(source);
 assert.equal(view.purpose,undefined);assert.equal(view.limit,50);
 assert.deepEqual(view.filter.rules[1],{property:'Lists',operator:'contains',value:'Winter 2026 · Started'});
 view.filter.rules[0].rules.push({property:'Email',operator:'contains',value:'test'});
 assert.equal(source.filter.rules.length,0);
});
test('incomplete filter conditions do not hide all contacts while the user builds a filter',()=>{
 const filter=activeViewFilter({match:'all',rules:[{property:'Lists',operator:'contains',value:''},{property:'Name',operator:'not_empty',value:''}]});
 assert.equal(filter.rules.length,1);assert.equal(filter.rules[0].property,'Name');
});

test('renaming a saved list preserves contacts, filters and other lists',async()=>{
 const {renameNamedList}=await import('../public/recipient-views.js');
 const original={Original:{tableName:'Original',recipients:[{email:'alex@example.org'}],audienceSource:{purpose:'browse',filter:{match:'all',rules:[]}}},Other:{tableName:'Other',recipients:[]}};
 const renamed=renameNamedList(original,'Original',' Updated ');
 assert.deepEqual(Object.keys(renamed),['Updated','Other']);
 assert.equal(renamed.Updated.tableName,'Updated');
 assert.deepEqual(renamed.Updated.recipients,original.Original.recipients);
 assert.deepEqual(renamed.Updated.audienceSource,original.Original.audienceSource);
 assert.equal(renamed.Other,original.Other);
 assert.ok(original.Original);
 assert.throws(()=>renameNamedList(original,'Original','Other'),/already exists/);
 assert.throws(()=>renameNamedList(original,'Original',' '),/Enter a list name/);
 assert.throws(()=>renameNamedList(original,'Missing','New'),/no longer exists/);
});

test('empty filter groups are ignored instead of broadening OR conditions',()=>{
 const f=activeViewFilter({match:'any',rules:[{property:'Name',operator:'equals',value:'Alex'},{rules:[{property:'Lists',operator:'contains',value:''}]}]});
 assert.equal(f.rules.length,1);
 assert.equal(activeViewFilter({rules:[]}),null);
});
