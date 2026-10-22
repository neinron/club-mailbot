// Old saved audiences become database filters; their sending purpose is not a view filter.
export function viewSettings(source = {}) {
  const filter = source.filter?.rules ? structuredClone(source.filter) : {match:'all',rules:[]};
  const rules = [filter];
  if(source.list)rules.push({property:'Lists',operator:'contains',value:source.list});
  if(source.applicationPhase)rules.push({property:'Application phases',operator:'contains',value:source.applicationPhase});
  if(source.event)rules.push({property:'Luma events',operator:'contains',value:source.event});
  if(source.membership)rules.push({property:'Current member',operator:'equals',value:source.membership});
  if(source.applicationStatus)rules.push({property:source.applicationStatus==='completed'?'Completed applications':'Incomplete applications',operator:source.applicationPhase?'contains':'not_empty',value:source.applicationPhase});
  return {filter:rules.length===1?filter:{match:'all',rules},search:source.search||'',sortProperty:source.sortProperty||'Name',sortDirection:source.sortDirection||'asc',limit:Number(source.limit)||0};
}
export function activeViewFilter(node) {
  if(node.rules){const rules=node.rules.map(activeViewFilter).filter(Boolean);return rules.length?{...node,rules}:null;}
  return ['empty','not_empty'].includes(node.operator)||String(node.value??'').trim() ? node : null;
}
export function namedViews(lists) {
  return Object.keys(lists).sort((a,b)=>a.localeCompare(b,'en'));
}

export function renameNamedList(lists, oldName, requestedName) {
  const name = String(requestedName || '').trim();
  if (!name) throw new Error('Enter a list name.');
  if (!Object.hasOwn(lists, oldName)) throw new Error('This saved list no longer exists.');
  if (name !== oldName && Object.hasOwn(lists, name)) throw new Error('A list with this name already exists. Choose another name.');
  return Object.fromEntries(Object.entries(lists).map(([key,list])=>key===oldName?[name,{...list,tableName:name}]:[key,list]));
}
