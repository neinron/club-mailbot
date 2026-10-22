import test from 'node:test';
import assert from 'node:assert/strict';
import { isNotionSubscribed } from '../server/notion-cli.js';

test('newsletter select overrides stale legacy checkbox and fails closed for pending or missing status', () => {
  for (const [name, expected] of [['Subscribed', true], ['Pending confirmation', false], ['Unsubscribed', false], [null, false]]) {
    assert.equal(isNotionSubscribed({ properties: { Subscribed: { type: 'checkbox', checkbox: true }, 'Subscription status': { type: 'select', select: name ? { name } : null } } }), expected);
  }
  assert.equal(isNotionSubscribed({ properties: { Subscribed: { type: 'checkbox', checkbox: true } } }), true);
  assert.equal(isNotionSubscribed({ properties: { 'Marketing Updates Opt In': { type: 'checkbox', checkbox: false } } }, 'Marketing Updates Opt In'), false);
});
