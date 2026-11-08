import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertDeliverableAddresses} from '../server/delivery-suppression.js';
test('delivery exclusions survive a new read, normalize case, and fail closed on corrupt data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mailbot-suppress-')),file=join(dir,'suppressed.json');
 try{
 await writeFile(file,JSON.stringify([{email:'bad@example.org',blocked:true}]));
 await assert.rejects(assertDeliverableAddresses(['BAD@example.org'],file),/delivery failure/);
 await assertDeliverableAddresses(['good@example.org'],file);
 await writeFile(file,'invalid');
 await assert.rejects(assertDeliverableAddresses(['good@example.org'],file),/blocked/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
