import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createUnsubscribeToken } from '../server/unsubscribe.js';

// Exercise the actual request handler with an in-memory SMTP transport.
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
function setup() {
  const sent = [];
  const context = vm.createContext({setTimeout:(fn)=>setTimeout(fn,0), URL, console, process, maxRecipients:250, createUnsubscribeToken, deliveryAudit: {previousAttempt: async()=>null, prepare: async rows => new Map(rows.map(r=>[r.email.toLowerCase(),{email:r.email,pageId:'test-page'}])), begin: async data => data, finish: async () => null}, validateNotionRecipients: async () => {}, sendViaGmailSmtp: async mail => {sent.push(mail);return {trace:[]};}});
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
test('unsubscribe URL variables work inside links in both preview and outgoing email',()=>{
 const clientSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(clientSource.slice(0,clientSource.indexOf('elements.parseButton.addEventListener')),client);
 const {context:server}=setup();
 const recipient={...recipients[0],unsubscribeUrl:'https://tum-socialaiclub.de/unsubscribe/signed-token'};
 const recipientColumns=[...columns,{key:'unsubscribeUrl',label:'Unsubscribe URL',role:'text'}];
 const body='<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>';
 const clientHtml=client.renderHtmlMessage(template,body,recipient);
 const serverHtml=server.renderHtmlMessage(template,body,recipient,recipientColumns);
 assert.equal(clientHtml,serverHtml);
 assert.match(serverHtml,/href="https:\/\/tum-socialaiclub\.de\/unsubscribe\/signed-token"/);
 assert.doesNotMatch(serverHtml,/href="<a href=/);
});
test('mass send generates a per-recipient unsubscribe link without exposing the email in the URL',async()=>{
  const old={PUBLIC_BASE_URL:process.env.PUBLIC_BASE_URL,NEWSLETTER_TOKEN_SECRET:process.env.NEWSLETTER_TOKEN_SECRET,MAILBOT_UNSUBSCRIBE_SECRET:process.env.MAILBOT_UNSUBSCRIBE_SECRET,NOTION_DATA_SOURCE_ID:process.env.NOTION_DATA_SOURCE_ID,NOTION_EMAIL_PROPERTY:process.env.NOTION_EMAIL_PROPERTY,NOTION_OPT_IN_PROPERTY:process.env.NOTION_OPT_IN_PROPERTY,NEWSLETTER_NOTION_DATA_SOURCE_ID:process.env.NEWSLETTER_NOTION_DATA_SOURCE_ID,NEWSLETTER_NOTION_SUBSCRIBED_PROPERTY:process.env.NEWSLETTER_NOTION_SUBSCRIBED_PROPERTY};
 Object.assign(process.env,{PUBLIC_BASE_URL:'https://tum-socialaiclub.de',NEWSLETTER_TOKEN_SECRET:'server-integration-test-secret-at-least-32-bytes',MAILBOT_UNSUBSCRIBE_SECRET:'server-integration-test-secret-at-least-32-bytes',NOTION_DATA_SOURCE_ID:'source-id',NOTION_EMAIL_PROPERTY:'Email',NOTION_OPT_IN_PROPERTY:'Marketing Updates Opt In'});
 try {
  const {context,sent}=setup();
  const campaign={...payload,testOnly:false,body:'<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',recipientColumns:[...columns,{key:'notionPageId',label:'Notion Page ID',role:'text'}],recipients:[{...recipients[0],notionPageId:'page-123'}]};
  const result=await request(context,campaign);
  assert.equal(result.status,200);assert.equal(sent.length,1);
  assert.match(sent[0].htmlBody,/href="https:\/\/tum-socialaiclub\.de\/unsubscribe\//);
  assert.doesNotMatch(sent[0].htmlBody,/href="[^"]*alex@example\.com/);
  const token = new URL(sent[0].htmlBody.match(/href="([^"]+\/unsubscribe\/([^"]+))"/)[1]).pathname.split("/").at(-1);
  const { verifyUnsubscribeToken } = await import("../server/unsubscribe.js");
  assert.equal(verifyUnsubscribeToken(token).dataSourceId, "source-id");
  assert.equal(verifyUnsubscribeToken(token).optInProperty, "Marketing Updates Opt In");
 } finally {
  for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('ineligible Notion audience never reaches SMTP',async()=>{
 const {context,sent}=setup();context.validateNotionRecipients=async()=>{throw Error('Contact is no longer eligible');};
 const result=await request(context,{...payload,testOnly:false,recipients:[{...recipients[0],notionPageId:'page'}]});
 assert.equal(result.status,500);assert.equal(sent.length,0);assert.match(result.output.error,/no longer eligible/);
});
test('Notion first names personalize consistently and missing explicit first name uses a neutral greeting',()=>{
 const clientSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(clientSource.slice(0,clientSource.indexOf('elements.parseButton.addEventListener')),client);
 const {context:server}=setup();
 for(const firstName of ['Alex','']){
  const recipient={name:'Full Legal Name',email:'example@example.org',firstName,notionPageId:'page'};
  assert.equal(client.renderTemplate('Hi {{firstName}},',recipient),firstName?'Hi Alex,':'Hi there,');
  assert.equal(client.renderTemplate('Hi {{firstName}},',recipient),server.renderTemplate('Hi {{firstName}},',recipient));
 }
});

test('Notion logging failure never turns an accepted email into a failed email result',async()=>{
 const {context,sent}=setup();
 context.deliveryAudit.finish=async()=>{throw Error('Disk unavailable');};
 const result=await request(context,{...payload,testOnly:false,recipients:recipients.slice(0,1)});
 assert.equal(sent.length,1);assert.equal(result.output.sent,1);assert.equal(result.output.results[0].ok,true);
 assert.match(result.output.results[0].auditWarning,/Do not resend/);
});
test('test emails never create contact delivery history',async()=>{
 const {context}=setup();
 context.deliveryAudit.prepare=async()=>{throw Error('Must not log test email');};
 context.deliveryAudit.begin=async()=>{throw Error('Must not log test email');};
 const result=await request(context,payload);assert.equal(result.output.sent,1);
});

test('SMTP failure is logged as a failed attempt and never reported sent',async()=>{
 const {context}=setup();const recorded=[];
 context.sendViaGmailSmtp=async()=>{throw Error('SMTP refused');};
 context.deliveryAudit.finish=async(event,status)=>{recorded.push(status);return null;};
 const result=await request(context,{...payload,testOnly:false,recipients:recipients.slice(0,1)});
 assert.equal(result.output.sent,0);assert.equal(result.output.results[0].ok,false);assert.deepEqual(recorded,['Failed']);
});


test('a test send accepts a large preview audience but only sends to the explicit test address',async()=>{
 const {context,sent}=setup();
 const many=Array.from({length:422},(_,i)=>({name:'Person '+i,email:'person'+i+'@example.org'}));
 const result=await request(context,{...payload,recipients:many,testOnly:true});
 assert.equal(result.status,200);assert.equal(sent.length,1);assert.deepEqual([...sent[0].to],['test@example.com']);
});
test('a real campaign over 250 recipients is processed sequentially',async()=>{
 const {context,sent}=setup();
 const many=Array.from({length:251},(_,i)=>({name:'Person '+i,email:'person'+i+'@example.org'}));
 const result=await request(context,{...payload,recipients:many,testOnly:false});
 assert.equal(result.status,200);assert.equal(sent.length,251);assert.equal(result.output.sent,251);
});

test('blocked logo reserves its real 26px height instead of a square placeholder',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
 vm.runInContext(source.slice(0,source.indexOf('elements.parseButton.addEventListener')),client);
 const shell='<html><body><img src="https://tum-socialaiclub.de/assets/logos/LOGO_V6-ICON%2BTUM_SOCIAL_CLUB-single_line-dark_text.svg" width="320" style="height:auto;max-width:100%">{{content}}</body></html>';
 const rendered=client.renderHtmlMessage(shell,'<p>Hello</p>',recipients[0]);
 const {context}=setup();assert.equal(rendered,context.renderHtmlMessage(shell,'<p>Hello</p>',recipients[0],[]));
 assert.match(rendered,/<img height="26"/);assert.match(rendered,/height:26px/);
 vm.runInContext('previewImagesBlocked = true',client);
 assert.match(client.previewHtmlWithBlockedImages(rendered),/height:26px/);
 assert.doesNotMatch(client.previewHtmlWithBlockedImages(rendered),/height:240px/);
});

test('outgoing mail loads both Google fonts and keeps nested heading text in League Spartan',()=>{
 const {context}=setup();
 const html=context.renderHtmlMessage('<html><head></head><body>{{content}}</body></html>','<h2><span>Join <strong>us</strong></span></h2><p><a href="https://example.com">Body</a></p>',recipients[0],columns);
 assert.match(html,/@font-face/);
 assert.match(html,/fonts\.gstatic\.com\/s\/leaguespartan/);
 assert.match(html,/fonts\.gstatic\.com\/s\/albertsans/);
 assert.equal((html.match(/@font-face/g)||[]).length,18);
 const heading=html.match(/<h2[\s\S]*?<\/h2>/)[0];
 assert.doesNotMatch(heading,/Albert Sans/);
 assert.match(heading,/League Spartan/);
 assert.match(html,/<p[^>]*Albert Sans/);
 assert.doesNotMatch(html,/data:font|base64/);
});

 test('explicit font choice, size and weight survive outgoing rendering',()=>{
 const {context}=setup();
 const html=context.renderHtmlMessage('<html><head></head><body>{{content}}</body></html>',`<h2><span data-mail-font-choice="Albert Sans" style="font-family:'Albert Sans',Arial,sans-serif">Heading</span></h2><p><span data-mail-font-choice="League Spartan" style="font-family:'League Spartan',Arial,sans-serif"><span data-mail-typography="true" style="font-size:23px;font-weight:500">Body</span></span></p>`,recipients[0],columns);
 assert.match(html,/<span data-mail-font-choice="Albert Sans" style="font-family:'Albert Sans'/);
 assert.match(html,/<span data-mail-font-choice="League Spartan" style="font-family:'League Spartan'/);
 assert.match(html,/style="font-size:23px;font-weight:500"/);
 });

test('resuming skips SMTP for previously accepted or uncertain recipients',async()=>{
 const {context,sent}=setup();
 context.deliveryAudit.previousAttempt=async()=> 'Sent';
 const result=await request(context,{...payload,testOnly:false});
 assert.equal(result.status,200);assert.equal(sent.length,0);assert.equal(result.output.sent,0);assert.equal(result.output.skipped,2);
 context.deliveryAudit.previousAttempt=async()=> 'Unknown';
 const unknown=await request(context,{...payload,testOnly:false});
 assert.equal(sent.length,0);assert.equal(unknown.output.results[0].ok,false);
 assert.match(unknown.output.results[0].error,/unknown result/);
});

test('send progress exposes counters and finishes without revealing addresses',async()=>{
 const {context}=setup();
 const result=await request(context,{...payload,testOnly:false});
 assert.equal(result.status,200);
 const progress=context.handleSend.progress;
 assert.equal(progress.state,'finished');assert.equal(progress.sent,2);assert.equal(progress.processed,2);assert.equal(progress.total,2);
 assert.doesNotMatch(JSON.stringify(progress),/@example/);
 assert.equal(context.handleSend.active,false);
});
