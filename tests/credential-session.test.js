import test from 'node:test';
import assert from 'node:assert/strict';
import {createCredentialSession} from '../server/credential-session.js';
test('memory credentials are account scoped, expire, and do not survive a new server session',()=>{
 let time=0; const session=createCredentialSession({now:()=>time});
 session.remember('Club@example.com','appPassword','private');
 assert.equal(session.get('club@example.com','appPassword'),'private');
 assert.equal(session.get('other@example.com','appPassword'),'');
 assert.equal(session.get('club@example.com','xoauth2'),'');
 assert.equal(createCredentialSession().get('club@example.com','appPassword'),'');
 time=8*60*60_000;assert.equal(session.get('club@example.com','appPassword'),'');
});
test('forget clears credentials and OAuth sessions expire sooner',()=>{
 let time=0;const session=createCredentialSession({now:()=>time});
 session.remember('a@example.com','xoauth2','private');time=50*60_000;
 assert.equal(session.get('a@example.com','xoauth2'),'');
 session.remember('a@example.com','appPassword','private');session.forget();
 assert.equal(session.get('a@example.com','appPassword'),'');
});
