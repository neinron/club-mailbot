// Legacy application groups were imported as rows without their source schema.
// These are the choices from Club Applications — Winter 2026.
const departments = [
  ["Engineering","blue"],
  ["Social Partnerships","pink"],
  ["Strategic Partnerships","purple"],
  ["Community","red"],
  ["Marketing","yellow"],
  ["Strategy Finance & Legal","gray"]
];
const selectField = entries => ({
  type:'select',
  options:entries.map(([name])=>name),
  choices:entries.map(([name,color])=>({name,color}))
});
const applicationFields = {
  'Dept. Prio. 1':selectField(departments),
  'Dept. Prio. 2':selectField(departments),
  'Suggested Department':selectField([
    ["Engineering","blue"],
    ["Social Partnerships","pink"],
    ["Strategic Partnerships","purple"],
    ["Community","orange"],
    ["Marketing","yellow"],
    ["Strategy Finance & Legal","gray"],
    ["IT & Dev","brown"]
  ]),
  Status:selectField([
    ["New","yellow"],
    ["Assigned","orange"],
    ["Under Review","blue"],
    ["Reviewed - pending interview decision","blue"],
    ["Waitlist to be invited for interview","yellow"],
    ["Invite to Interview","pink"],
    ["Interview Invite sent","pink"],
    ["Interview scheduled","pink"],
    ["Declined Interview Offer","gray"],
    ["Interview completed - pending acceptance decision","blue"],
    ["Waitlisted after Interview","orange"],
    ["Send Rejection to Candidate","red"],
    ["Rejection sent","red"],
    ["Send a Membership Offer","green"],
    ["Membership Offer sent","green"],
    ["Membership Offer Confirmed","green"],
    ["Candidate Declined Membership Offer","default"]
  ])
};

const notionColors = ['gray','brown','orange','yellow','green','blue','purple','pink','red'];

export function isChoiceField(field) {
  return ['select','multi_select','status'].includes(field?.type);
}

export function notionOptionColor(field, value) {
  const color = Array.isArray(field?.choices) ? field.choices.find(choice=>choice?.name===value)?.color : null;
  return notionColors.includes(color) ? color : 'default';
}

export function attachNotionFields(columns, fields, applicationGroup = false) {
  const byName = new Map(fields.map(field => [field.name.toLowerCase(), field]));
  return columns.map(column => {
    if (column.notion?.choices || (column.notion && !isChoiceField(column.notion))) return column;
    const alias = applicationGroup && column.key === 'decisionStatus' ? 'Status' : column.label;
    const field = byName.get((column.notion?.name || alias).toLowerCase()) ||
      (applicationGroup && Object.hasOwn(applicationFields, alias) && applicationFields[alias]);
    return field ? {...column, notion: {...field, ...column.notion, name:column.notion?.name || field.name || alias}} : column;
  });
}

export function choiceValues(value, field) {
  if (!value) return [];
  if (field.type !== 'multi_select' || field.options.includes(value)) return [value];
  return value.split('; ').filter(Boolean);
}

export function acceptsNotionValue(field, value, currentValue) {
  if (!field || !value || value === currentValue) return true;
  if (field.type === 'checkbox') return ['true','false'].includes(value);
  if (field.type === 'number') return Number.isFinite(Number(value));
  if (isChoiceField(field)) {
    const existing = choiceValues(currentValue, field);
    return choiceValues(value, field).every(option => field.options.includes(option) || existing.includes(option));
  }
  return true;
}
