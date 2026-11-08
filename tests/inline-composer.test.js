import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const client=vm.createContext({document:{querySelector:()=>({}),querySelectorAll:()=>[]}});
vm.runInContext(source.slice(0,source.indexOf('elements.parseButton.addEventListener')),client);
vm.runInContext(source.slice(source.indexOf('function renderUnresolvedMessage('),source.indexOf('function fitComposerFrame(')),client);
const design='<html><head></head><body><header>Club logo</header><main>{{content}}</main></body></html>';
test('inline composer renders real heading typography while retaining unresolved campaign variables',()=>{
 const html=client.renderUnresolvedMessage(design,'<h1>Hello {{firstName}}</h1><p>Join {{suggestedDepartment}}.</p>');
 assert.match(html,/Club logo/);assert.match(html,/Hello \{\{firstName\}\}/);assert.match(html,/Join \{\{suggestedDepartment\}\}/);assert.match(html,/League Spartan/);assert.match(html,/Albert Sans/);assert.doesNotMatch(html,/MAILBOT_EDIT_VARIABLE/);
});
test('inline composer retains variable link targets and button metadata for later editing',()=>{
 const button=client.renderButtonMarkup('Respond','https://example.invalid/response',{},'html','gradient');
 const html=client.renderUnresolvedMessage(design,`<div class="mail-button" data-target="responseLink" data-variant="gradient">${button}</div><a href="{{responseLink}}">Details for {{firstName}}</a>`);
 assert.match(html,/data-target="responseLink"/);assert.match(html,/data-variant="gradient"/);assert.match(html,/href="\{\{responseLink\}\}"/);assert.match(html,/Details for \{\{firstName\}\}/);assert.match(html,/background-image:radial-gradient/);
});
