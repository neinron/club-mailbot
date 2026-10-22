import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deliveryRecorder,deliveryProperties} from '../server/delivery-audit.js';

async function fixture(run) {
  const directory=await mkdtemp(join(tmpdir(),'mailbot-audit-'));
  const page={id:'contact-1',properties:{Email:{type:'email',email:'alex@example.org'}}};
  const blocks=[];let failAppend=false, failSummary=false;
  const schema={properties:Object.fromEntries(Object.entries(deliveryProperties).map(([name,value])=>[name,{type:Object.keys(value)[0]}]))};
  const request=async(path,{method='GET',body}={})=>{
    if(path.startsWith('/data_sources/'))return schema;
    if(path.startsWith('/blocks/')&&method==='GET')return {results:blocks,has_more:false};
    if(path.startsWith('/blocks/')&&method==='PATCH'){
      blocks.push(...body.children);
      if(failAppend){failAppend=false;throw Error('Response lost after append');}
      return {};
    }
    if(path.startsWith('/pages/')&&method==='PATCH'){
      if(failSummary){failSummary=false;throw Error('Summary offline');}
      for(const [name,value]of Object.entries(body.properties))page.properties[name]={type:Object.keys(value)[0],...value};return page;
    }
    if(path.startsWith('/pages/'))return page;
    throw Error('Unexpected request '+path);
  };
  const options={directory,sourceId:'source',request,query:async()=>[page]};
  const recorder=deliveryRecorder(options);
  const metadata={contacts:[{pageId:page.id,email:'alex@example.org'}],subject:'Applications close Sunday',campaign:'Deadline',sender:'contact@example.org',purpose:'deadline'};
  try{await run({recorder,metadata,page,blocks,options,setFailAppend:()=>failAppend=true,setFailSummary:()=>failSummary=true});}
  finally{await rm(directory,{recursive:true,force:true});}
}
test('SMTP success records one history entry and last sent metadata',()=>fixture(async({recorder,metadata,page,blocks})=>{
  const contacts=await recorder.prepare([{email:'ALEX@example.org',notionPageId:'contact-1'}]);assert.equal(contacts.size,1);
  const event=await recorder.begin(metadata);assert.equal(await recorder.finish(event,'Sent'),null);
  assert.equal(page.properties['Last email status'].select.name,'Sent');
  assert.equal(page.properties['Last email sent at'].date.start,event.at);
  assert.equal(page.properties['Last email campaign'].rich_text[0].text.content,'Deadline');
  assert.equal(blocks.length,1);
}));
test('uncertain Notion write is retried without duplicate history entries or SMTP',()=>fixture(async({recorder,metadata,blocks,options,setFailAppend})=>{
  const event=await recorder.begin(metadata);setFailAppend();
  assert.match(await recorder.finish(event,'Sent'),/pending/);
  assert.equal(blocks.length,1);
  const recovered=deliveryRecorder(options);assert.deepEqual(await recovered.retry(),{pending:0});
  assert.equal(blocks.length,1);
  await recovered.retry();assert.equal(blocks.length,1);
}));
test('failed attempts never become successful sent dates; interrupted attempts remain unknown',()=>fixture(async({recorder,metadata,page,options})=>{
  const failed=await recorder.begin(metadata);await recorder.finish(failed,'Failed');
  assert.equal(page.properties['Last email status'].select.name,'Failed');assert.equal(page.properties['Last email sent at'],undefined);
  await recorder.begin(metadata);
  // An active send is not recovered by the periodic retry in the same process.
  await recorder.retry();assert.equal(page.properties['Last email status'].select.name,'Failed');
  await deliveryRecorder(options).retry();assert.equal(page.properties['Last email status'].select.name,'Unknown');
  assert.equal(page.properties['Last email sent at'],undefined);
}));
test('delivery audit fails closed on changed contact identity',()=>fixture(async({recorder})=>{
  await assert.rejects(recorder.prepare([{email:'alex@example.org',notionPageId:'other'}]),/identity/);
}));

test('resume survives restart and blocks sent or uncertain attempts but allows failed attempts',()=>fixture(async({recorder,metadata,options})=>{
 assert.equal(await recorder.previousAttempt(metadata),null);
 const event=await recorder.begin(metadata);
 assert.equal(await deliveryRecorder(options).previousAttempt(metadata),'Unknown');
 await recorder.finish(event,'Failed');
 assert.equal(await deliveryRecorder(options).previousAttempt(metadata),null);
 const next=await recorder.begin(metadata);await recorder.finish(next,'Sent');
 assert.equal(await deliveryRecorder(options).previousAttempt(metadata),'Sent');
 assert.equal(await recorder.previousAttempt({...metadata,subject:'Different campaign subject'}),null);
}));
