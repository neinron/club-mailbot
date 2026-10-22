import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

function client() {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ document: { querySelector: () => ({}), querySelectorAll: () => [] } });
  vm.runInContext(source.slice(0, source.indexOf('elements.parseButton.addEventListener')), context);
  return context;
}

test('headered CSV maps explicit first names independently of previous Notion column order', () => {
  const context = client();
  vm.runInContext('recipientColumns = [{key:"lastName"},{key:"firstName"},{key:"email"}]', context);
  const rows = context.parseRecipients('First name,Last name,Email\nAlex,Example,alex@example.org\nSam,Sample,sam@example.org');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Alex Example');
  assert.equal(context.renderTemplate('Hello {{firstName}},', rows[0]), 'Hello Alex,');
  assert.equal(vm.runInContext('parseStats.invalid', context), 0);
});

test('duplicate CSV headers retain the email column position', () => {
  const context = client();
  const rows = context.parseRecipients('Name,Name,Email\nAlex Example,Extra,alex@example.org');
  assert.equal(rows[0].name, 'Alex Example');
  assert.equal(rows[0].email, 'alex@example.org');
});

test('headerless CSV still validates and deduplicates recipients', () => {
  const context = client();
  const rows = context.parseRecipients('Alex Example,alex@example.org\nDuplicate,ALEX@example.org\nInvalid,no-address');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Alex Example');
  assert.equal(vm.runInContext('parseStats.duplicates', context), 1);
  assert.equal(vm.runInContext('parseStats.invalid', context), 1);
});
