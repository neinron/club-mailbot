import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(){
 const context=vm.createContext({recipientColumns:[{key:'email',label:'Email',role:'to'},{key:'firstName',label:'First name',role:'text'}],recipients:[{email:'person@example.invalid',firstName:'Alex'}],syncRawRecipientsFromTable(){},updateTable(){},updatePreview(){},queueAutosave(){},setStatus(){}});
 vm.runInContext(source.slice(source.indexOf('function renameColumn('),source.indexOf('function updateColumnRole(')),context);return context;
}
test('renaming a visible column keeps delivery roles and personalization keys unchanged',()=>{
 const context=setup();context.renameColumn(0,'Contact address');context.renameColumn(1,'Given name');
 assert.equal(context.recipientColumns[0].key,'email');assert.equal(context.recipientColumns[0].role,'to');assert.equal(context.recipientColumns[1].key,'firstName');assert.equal(context.recipientColumns[1].label,'Given name');assert.equal(context.recipients[0].firstName,'Alex');assert.equal(context.recipients[0].email,'person@example.invalid');
});
test('duplicate column labels are rejected without merging or losing data',()=>{
 const context=setup();context.renameColumn(1,'email');assert.equal(context.recipientColumns[1].label,'First name');assert.equal(context.recipients[0].firstName,'Alex');
});
