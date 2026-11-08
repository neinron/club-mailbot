import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendControl} from '../server/send-control.js';

test('stop during the pacing delay prevents the next recipient and permits a later run', async () => {
  const control = createSendControl(); control.start();
  const sent = [];
  const run = (async () => {
    for (const recipient of ['one','two']) {
      if (control.stopped) break;
      sent.push(recipient);
      await control.wait(60_000);
    }
  })();
  control.stop(); await run;
  assert.deepEqual(sent,['one']);
  control.start(); assert.equal(control.stopped,false);
});

test('stop preserves the current handoff result but prevents subsequent handoffs', async () => {
  const control = createSendControl(); control.start();
  let finishHandoff;
  const handoff = new Promise(resolve => {finishHandoff=resolve;});
  const journal=[];
  const run=(async()=>{
    for(const recipient of ['one','two']) {
      if(control.stopped) break;
      await handoff;
      journal.push({recipient,status:'Sent'});
    }
  })();
  control.stop(); finishHandoff(); await run;
  assert.deepEqual(journal,[{recipient:'one',status:'Sent'}]);
});
