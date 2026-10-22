import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceStore } from '../server/workspace-store.js';
import { eligibility } from '../public/audience.js';

test('named lists and drafts survive reopening the disk store, including renames and deletions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mailbot-store-'));
  try {
    const store = workspaceStore(directory);
    await Promise.all([store.save('drafts', { Reminder: { body: 'Hello', appPassword: 'never-store' } }), store.save('lists', { Old: { recipients: [] } })]);
    await store.save('lists', { Deadline: { recipients: [{ email: 'test@example.org' }] } });
    const restored = await workspaceStore(directory).read();
    assert.equal(restored.drafts.Reminder.body, 'Hello');
    assert.equal(restored.drafts.Reminder.appPassword, undefined);
    assert.deepEqual(Object.keys(restored.lists), ['Deadline']);
    assert.equal((await stat(join(directory, 'workspace.json'))).mode & 0o777, 0o600);
    await store.save('drafts', {});
    assert.deepEqual((await workspaceStore(directory).read()).drafts, {});
    assert.throws(() => store.save('../public', {}));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('deadline audience includes started and unstarted applications but excludes submitted, members and opt-outs', () => {
  const base = { Email: 'test@example.org', 'Current member': false, 'Subscription status': 'Not subscribed' };
  const eligible = changes => eligibility({ properties: { ...base, ...changes } }, 'deadline', 'Winter 2026');
  assert.equal(eligible({}), true);
  assert.equal(eligible({ 'Incomplete applications': ['Winter 2026'] }), true);
  assert.equal(eligible({ 'Completed applications': ['Summer 2026'] }), true);
  assert.equal(eligible({ 'Completed applications': ['Winter 2026'] }), false);
  assert.equal(eligible({ 'Current member': true }), false);
  assert.equal(eligible({ 'Subscription status': 'Unsubscribed' }), false);
});

test('browser migration restores disk lists and preserves edits after a failed disk save', async () => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage;
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key,value) => memory.set(key,value), removeItem: key => memory.delete(key) };
  let disk = { drafts: {}, lists: {} }, offline = false;
  globalThis.fetch = async (url, options = {}) => {
    if (offline) throw new Error('Offline');
    if (options.method === 'PUT') disk[url.split('/').at(-1)] = JSON.parse(options.body);
    return { ok: true, json: async () => structuredClone(disk) };
  };
  try {
    const { restoreWorkspace, persistCollection } = await import('../public/workspace-store.js');
    memory.set('lists', JSON.stringify({ Deadline: { savedAt: '2026-10-19', recipients: [] } }));
    await restoreWorkspace({ drafts: 'drafts', lists: 'lists' });
    assert.ok(disk.lists.Deadline);
    memory.set('lists', '{}');
    await restoreWorkspace({ drafts: 'drafts', lists: 'lists' });
    assert.ok(JSON.parse(memory.get('lists')).Deadline);
    offline = true;
    memory.set('lists', '{}');
    await assert.rejects(persistCollection('lists', {}));
    offline = false;
    await restoreWorkspace({ drafts: 'drafts', lists: 'lists' });
    assert.deepEqual(disk.lists, {});
    assert.equal(memory.get('lists.disk-dirty'), undefined);
  } finally { globalThis.fetch = oldFetch; globalThis.localStorage = oldStorage; }
});
