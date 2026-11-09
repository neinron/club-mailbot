// Old saved audiences become database filters; their sending purpose is not a view filter.
export function viewSettings(source = {}) {
  const filter = source.filter?.rules ? structuredClone(source.filter) : {match:'all',rules:[]};
  const rules = [filter];
  if(source.list)rules.push({property:'Lists',operator:'contains',value:source.list});
  if(source.applicationPhase)rules.push({property:'Application phases',operator:'contains',value:source.applicationPhase});
  if(source.event)rules.push({property:'Luma events',operator:'contains',value:source.event});
  if(source.membership)rules.push({property:'Current member',operator:'equals',value:source.membership});
  if(source.applicationStatus)rules.push({property:source.applicationStatus==='completed'?'Completed applications':'Incomplete applications',operator:source.applicationPhase?'contains':'not_empty',value:source.applicationPhase});
  return {...(source.memberCopies?.length ? {memberCopies:structuredClone(source.memberCopies)} : {}),filter:rules.length===1?filter:{match:'all',rules},search:source.search||'',sortProperty:source.sortProperty||'Name',sortDirection:source.sortDirection||'asc',limit:Number(source.limit)||0};
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

export function audienceSummary(source, details, hasApplicationPages) {
  const settings = viewSettings(source || details || {});
  const filter = activeViewFilter(settings.filter);
  let customized = Boolean(details?.customized || source?.memberCopies?.length);
  let ruleCount = 0;

  function describe(node) {
    if (node.rules) {
      const rules = node.rules.map(rule => ({ label: describe(rule), join: rule.join || node.match })).filter(rule => rule.label);
      const combined = rules.map(({label,join}, index) => index ? `${join === 'any' ? 'OR' : 'AND'} ${label}` : label).join(' ');
      return rules.length > 1 ? `(${combined})` : combined;
    }
    if (['name','email','first name','last name'].includes(String(node.property || '').toLowerCase()) &&
        ['equals','not_equals','contains','not_contains'].includes(node.operator)) {
      customized = true;
      return '';
    }
    if (++ruleCount > 3) return '';
    const value = ['empty','not_empty'].includes(node.operator) ? '' : ` ${node.value}`;
    return `${node.property} ${filterOperatorLabels[node.operator] || ''}${value}`.trim();
  }

  const rules = filter?.rules || (filter ? [filter] : []);
  const criteria = rules.map(rule => ({ label: describe(rule), join: rule.join || filter.match })).filter(rule => rule.label);
  const chips = criteria.map(({label,join}, index) => index ? `${join === 'any' ? 'OR' : 'AND'} ${label}` : label);
  if (ruleCount > 3) chips.push(`+${ruleCount - 3} conditions`);
  if (settings.search) {
    if (settings.search.includes('@')) customized = true;
    else chips.push(`Search: ${settings.search}`);
  }
  if (settings.limit) chips.push(`First ${settings.limit} matches`);
  const purpose = { recruiting:'Application invitation', reminder:'Application reminder', deadline:'Application deadline', newsletter:'Newsletter subscribers', browse:'Review only' }[source?.purpose];
  if (purpose) chips.unshift(purpose);
  return {
    origin: source?.sourceId ? 'Notion' : hasApplicationPages ? 'Application database' : details?.kind === 'csv' ? 'CSV / paste' : 'Manual group',
    chips,
    customized
  };
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
