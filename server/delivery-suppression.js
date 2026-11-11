import {readFile} from 'node:fs/promises';

export async function assertDeliverableAddresses(addresses, file = new URL('../data/delivery-suppressions.json', import.meta.url)) {
  let entries;
  try { entries = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw new Error('Delivery exclusions could not be loaded. Sending is blocked.'); }
  if (!Array.isArray(entries)) throw new Error('Delivery exclusions are invalid. Sending is blocked.');
  const blocked = new Set(entries.filter(e=>e.blocked!==false).map(e=>String(e.email).trim().toLowerCase()));
  if(addresses.some(email=>blocked.has(String(email).trim().toLowerCase()))) throw new Error('This list contains an address with a reported delivery failure. Refresh the recipient list before sending.');
}
