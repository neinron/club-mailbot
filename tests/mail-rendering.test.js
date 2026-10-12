import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';

// Exercise the actual request handler with an in-memory SMTP transport.
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
function setup() {
  const sent = [];
  const context = vm.createContext({setTimeout, URL, console, sendViaGmailSmtp: async mail => {sent.push(mail);return {trace:[]};}});
  vm.runInContext(serverSource.slice(serverSource.indexOf('const emailPattern'),serverSource.indexOf('async function serveStatic')).replace('if (recipients.length > maxRecipients)', 'if (recipients.length > 250)'),context);
  return {context,sent};
}
const columns=[{key:'name',label:'Name',role:'text'},{key:'email',label:'Email',role:'to'},{key:'copy',label:'Copy',role:'cc'}];
const recipients=[{name:'Alex Example',email:'alex@example.com',copy:'copy@example.com'},{name:'Sam Sample',email:'sam@example.com'}];
const template='<html><body data-mail-accent="#445566" data-mail-font="serif">{{content}}</body></html>';
const payload={accountEmail:'sender@example.com',authSecret:'test-only',subject:'Hello {{firstName}}',body:'<p>Hi {{firstName}},</p>button{{Apply,https://example.com/apply}}',htmlBody:template,recipientColumns:columns,recipients,testOnly:true,testEmail:'test@example.com',previewIndex:1};
async function request(context,body){
 const req=new EventEmitter();let status;let output;
 const res={writeHead(code){status=code;},end(data){output=JSON.parse(data);}};
 const pending=context.handleSend(req,res);req.emit('data',JSON.stringify(body));req.emit('end');await pending;return {status,output};
}
test('test send only targets explicit test address and selected personalization',async()=>{
 const {context,sent}=setup();const result=await request(context,payload);
 assert.equal(result.status,200);assert.equal(sent.length,1);
 assert.deepEqual([...sent[0].to],['test@example.com']);assert.equal(sent[0].cc.length,0);assert.equal(sent[0].bcc.length,0);
 assert.equal(sent[0].subject,'Hello Sam');assert.match(sent[0].htmlBody,/Hi Sam/);assert.match(sent[0].htmlBody,/#445566/);assert.match(sent[0].htmlBody,/Georgia,serif/);assert.match(sent[0].htmlBody,/https:\/\/example.com\/apply/);
 assert.equal(result.output.results[0].email,'test@example.com');
});
test('test send without an explicit address never reaches SMTP',async()=>{
 const {context,sent}=setup();const result=await request(context,{...payload,testEmail:''});assert.equal(result.status,400);assert.equal(sent.length,0);
});
test('missing content slot is rejected before SMTP',async()=>{
 const {context,sent}=setup();const result=await request(context,{...payload,htmlBody:'<p>Missing slot</p>'});assert.equal(result.status,400);assert.equal(sent.length,0);
});
test('normal send retains intended address and copy roles',async()=>{
 const {context,sent}=setup();const result=await request(context,{...payload,testOnly:false,recipients:recipients.slice(0,1)});assert.equal(result.status,200);assert.deepEqual([...sent[0].to],['alex@example.com']);assert.deepEqual([...sent[0].cc],['copy@example.com']);
});
test('browser and server agree on first-name personalization and generated design',()=>{
 const clientSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(clientSource.slice(0,clientSource.indexOf('elements.parseButton.addEventListener')),client);
 const {context:server}=setup();
 const body='<h2>Hello {{firstName}}</h2><p>{{lastName}}</p>button{{Apply,https://example.com/apply}}';
 assert.equal(client.renderHtmlMessage(template,body,recipients[0]),server.renderHtmlMessage(template,body,recipients[0],columns));
});
test('selected website button variant is rendered in preview and outgoing email',()=>{
 const clientSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(clientSource.slice(0,clientSource.indexOf('elements.parseButton.addEventListener')),client);
 const {context:server}=setup();
 const body='button{{Apply,https://example.com/apply,primary}}';
 const clientHtml=client.renderHtmlMessage(template,body,recipients[0]);
 const serverHtml=server.renderHtmlMessage(template,body,recipients[0],columns);
 assert.equal(clientHtml,serverHtml);
 assert.match(serverHtml,/data-club-mailbot-variant="primary"/);
 assert.match(serverHtml,/color:#ffffff/);
 const gradientHtml=client.renderHtmlMessage(template,'button{{Apply,https://example.com/apply}}',recipients[0]);
 assert.match(gradientHtml,/box-shadow:0 4px 10px rgba\(10,45,87,\.12\)/);
 assert.equal([...gradientHtml.matchAll(/box-shadow:/g)].length,1);
});
test('horizontal dividers are preserved in preview and outgoing email',()=>{
 const clientSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(clientSource.slice(0,clientSource.indexOf('elements.parseButton.addEventListener')),client);
 const {context:server}=setup();
 const body='<p>Above</p><hr style="border:0;border-top:1px solid #dbe3ec;margin:24px 0;"><p>Below</p>';
 const clientHtml=client.renderHtmlMessage(template,body,recipients[0]);
 const serverHtml=server.renderHtmlMessage(template,body,recipients[0],columns);
 assert.equal(clientHtml,serverHtml);
 assert.match(serverHtml,/<hr style="border:0;border-top:1px solid #dbe3ec;margin:24px 0;"/);
});
