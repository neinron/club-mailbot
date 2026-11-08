import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const context = vm.createContext({});
for (const [start, end] of [
  ['function campaignIdentity(', 'async function confirmCampaignSend('],
  ['function campaignProgress(', 'function renderCampaignProgress('],
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
const identity = context.campaignIdentity('Offers', 'Welcome', 'sender@example.com');
const receipt = { identity, emails: ['person@example.com'], total: 1, failed: 0 };
test('finished delivery from another campaign never appears on this draft', () => {
  const other = {campaignKey:context.campaignProgressKey(context.campaignIdentity('Rejections','Update','sender@example.com')),total:101,state:'finished'};
  assert.equal(context.campaignProgress(other, identity, '', null), null);
  assert.equal(context.campaignProgress(other, identity, '', receipt).sent, 1);
});
test('metadata scopes current sending status, including after page reload', () => {
  const progress = {campaignKey:context.campaignProgressKey(context.campaignIdentity('Offers','Welcome','SENDER@example.com')),total:1,state:'running'};
  assert.equal(context.campaignProgress(progress, identity, '', receipt), progress);
});
test('legacy server status requires an active send from this browser', () => {
  const progress = {total:101,state:'finished'};
  assert.equal(context.campaignProgress(progress, identity, '', null), null);
  assert.equal(context.campaignProgress(progress, identity, identity, null), progress);
});
test('changing subject or sender invalidates the saved delivery receipt', () => {
  for (const changed of [context.campaignIdentity('Offers','Changed','sender@example.com'),context.campaignIdentity('Offers','Welcome','other@example.com')]) {
    assert.equal(context.campaignProgress(null, changed, '', receipt), null);
  }
});
