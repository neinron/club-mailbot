import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as notionFields from '../public/notion-fields.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(){
 const context=vm.createContext({notionFields,audienceDetails:null,recipientColumns:[{key:'email',label:'Email',role:'to'},{key:'firstName',label:'First name',role:'text'}],recipients:[{email:'person@example.invalid',firstName:'Alex'}],ensureRequiredRecipientFields:row=>row,normalizeColumnRole:role=>role,syncRawRecipientsFromTable(){},updateTable(){},updatePreview(){},queueAutosave(){},setStatus(){}});
 vm.runInContext(source.slice(source.indexOf('function isNotionPageColumn('),source.indexOf('function applyTableState(')),context);
 vm.runInContext(source.slice(source.indexOf('function markAudienceCustomized('),source.indexOf('function recipientField(')),context);
 return context;
}
test('renaming a visible column keeps delivery roles and personalization keys unchanged',()=>{
 const context=setup();context.renameColumn(0,'Contact address');context.renameColumn(1,'Given name');
 assert.equal(context.recipientColumns[0].key,'email');assert.equal(context.recipientColumns[0].role,'to');assert.equal(context.recipientColumns[1].key,'firstName');assert.equal(context.recipientColumns[1].label,'Given name');assert.equal(context.recipients[0].firstName,'Alex');assert.equal(context.recipients[0].email,'person@example.invalid');
});
test('duplicate column labels are rejected without merging or losing data',()=>{
 const context=setup();context.renameColumn(1,'email');assert.equal(context.recipientColumns[1].label,'First name');assert.equal(context.recipients[0].firstName,'Alex');
});

test('moving columns preserves row values and delivery roles and marks the group customized',()=>{
 const context=setup();
 context.moveRecipientColumn('firstName','email');
 assert.deepEqual(context.recipientColumns.map(column=>column.key),['firstName','email']);
 assert.equal(context.recipientColumns[1].role,'to');
 assert.equal(context.recipients[0].firstName,'Alex');
 assert.equal(context.audienceDetails.customized,true);
});

test('Notion page columns cannot be renamed, deleted, or edited',()=>{
 const context=setup();
 const page='https://www.notion.so/11111111111111111111111111111111';
 context.recipientColumns.push({key:'applicationPage',label:'Notion Page',role:'text'});
 context.recipients[0].applicationPage=page;
 context.renameColumn(2,'Another label');
 context.deleteColumn(2);
 context.updateRecipientCell(0,'applicationPage','another link');
 assert.equal(context.recipientColumns[2].label,'Notion Page');
 assert.equal(context.recipients[0].applicationPage,page);
 assert.equal(context.audienceDetails,null);
});

test('existing application groups recover choice fields and retain them when a column is renamed',()=>{
 const context=setup();
 context.hydrateRecipientData([
  {key:'applicationPage',label:'Application Page',role:'text'},
  {key:'suggestedDepartment',label:'Suggested Department',role:'text'},
  {key:'decisionStatus',label:'Decision status',role:'text'}
 ],[{suggestedDepartment:'Engineering',decisionStatus:'Interview Invite sent'}]);
 assert.equal(context.recipientColumns[2].notion.name,'Status');
 context.renameColumn(1,'Department');
 assert.equal(context.recipientColumns[1].notion.name,'Suggested Department');
 context.updateRecipientCell(0,'suggestedDepartment','Invented department');
 assert.equal(context.recipients[0].suggestedDepartment,'Engineering');
 context.updateRecipientCell(0,'suggestedDepartment','Marketing');
 assert.equal(context.recipients[0].suggestedDepartment,'Marketing');
});
