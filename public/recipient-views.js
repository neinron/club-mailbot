import { purposes } from './audience.js';
import { touchpointField, touchpointLabel } from './contact-lists.js';

function migrateTouchpointFilter(node) {
  if (node.rules) return { ...node, rules: node.rules.map(migrateTouchpointFilter) };
  if (node.property !== 'Lists') return { ...node };
  const value = typeof node.value === 'string' && !node.partialMatch ? touchpointLabel(node.value) : node.value;
  return { ...node, property: touchpointField, value };
}

// Old saved audiences become database filters; their sending purpose is not a view filter.
export function viewSettings(source = {}) {
  const filter = source.filter?.rules ? (source.kind === 'csv' && !source.sourceId ? structuredClone(source.filter) : migrateTouchpointFilter(source.filter)) : {match:'all',rules:[]};
  const rules = [filter];
  if(source.list)rules.push({property:touchpointField,operator:'contains',value:touchpointLabel(source.list)});
  if(source.applicationPhase)rules.push({property:'Application phases',operator:'contains',value:source.applicationPhase});
  if(source.event)rules.push({property:'Luma events',operator:'contains',value:source.event});
  if(source.membership)rules.push({property:'Current member',operator:'equals',value:source.membership});
  if(source.applicationStatus)rules.push({property:source.applicationStatus==='completed'?'Completed applications':'Incomplete applications',operator:source.applicationPhase?'contains':'not_empty',value:source.applicationPhase});
  return {...(source.memberCopies?.length ? {memberCopies:structuredClone(source.memberCopies)} : {}),filter:rules.length===1?filter:{match:'all',rules},search:source.search||'',sortProperty:source.sortProperty==='Lists' && source.sourceId ? touchpointField : source.sortProperty||'Name',sortDirection:source.sortDirection||'asc',limit:Number(source.limit)||0};
}
export function activeViewFilter(node) {
  if(node.rules){const rules=node.rules.map(activeViewFilter).filter(Boolean);return rules.length?{...node,rules}:null;}
  return ['empty','not_empty'].includes(node.operator)||String(node.value??'').trim() ? node : null;
}

export const filterOperatorLabels = {
  equals:'is', not_equals:'is not', contains:'contains', not_contains:'does not contain',
  empty:'is empty', not_empty:'is not empty', gt:'greater than', gte:'at least', lt:'less than',
  lte:'at most', before:'before', after:'after', starts_with:'starts with', ends_with:'ends with',
  on:'on', on_or_before:'on or before', on_or_after:'on or after'
};

export function notionSelectionPurpose(purpose) {
  return purpose !== 'browse' && Object.hasOwn(purposes, purpose) ? purpose : 'newsletter';
}

export function renameNamedList(lists, oldName, requestedName) {
  const name = String(requestedName || '').trim();
  if (!name) throw new Error('Enter a list name.');
  if (!Object.hasOwn(lists, oldName)) throw new Error('This saved list no longer exists.');
  if (name !== oldName && Object.hasOwn(lists, name)) throw new Error('A list with this name already exists. Choose another name.');
  return Object.fromEntries(Object.entries(lists).map(([key,list])=>key===oldName?[name,{...list,tableName:name}]:[key,list]));
}
