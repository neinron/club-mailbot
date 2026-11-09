// Legacy application groups were imported as rows without their source schema.
// These are the choices from Club Applications — Winter 2026.
const applicationFields = {
  "Dept. Prio. 1": {
    "type": "select",
    "options": [
      "Engineering",
      "Social Partnerships",
      "Strategic Partnerships",
      "Community",
      "Marketing",
      "Strategy Finance & Legal"
    ]
  },
  "Dept. Prio. 2": {
    "type": "select",
    "options": [
      "Engineering",
      "Social Partnerships",
      "Strategic Partnerships",
      "Community",
      "Marketing",
      "Strategy Finance & Legal"
    ]
  },
  "Status": {
    "type": "select",
    "options": [
      "New",
      "Assigned",
      "Under Review",
      "Reviewed - pending interview decision",
      "Waitlist to be invited for interview",
      "Invite to Interview",
      "Interview Invite sent",
      "Interview scheduled",
      "Declined Interview Offer",
      "Interview completed - pending acceptance decision",
      "Waitlisted after Interview",
      "Send Rejection to Candidate",
      "Rejection sent",
      "Send a Membership Offer",
      "Membership Offer sent",
      "Membership Offer Confirmed",
      "Candidate Declined Membership Offer"
    ]
  },
  "Suggested Department": {
    "type": "select",
    "options": [
      "Engineering",
      "Social Partnerships",
      "Strategic Partnerships",
      "Community",
      "Marketing",
      "Strategy Finance & Legal",
      "IT & Dev"
    ]
  }
};

export function attachNotionFields(columns, fields, applicationGroup = false) {
  const byName = new Map(fields.map(field => [field.name.toLowerCase(), field]));
  return columns.map(column => {
    if (column.notion) return column;
    const alias = applicationGroup && column.key === 'decisionStatus' ? 'Status' : column.label;
    const field = byName.get(alias.toLowerCase()) ||
      (applicationGroup && Object.hasOwn(applicationFields, alias) && applicationFields[alias]);
    return field ? {...column, notion: {...field, name:field.name || alias}} : column;
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
  if (['select','multi_select','status'].includes(field.type)) {
    const existing = choiceValues(currentValue, field);
    return choiceValues(value, field).every(option => field.options.includes(option) || existing.includes(option));
  }
  return true;
}
