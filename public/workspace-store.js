let pending = Promise.resolve();
let storageKeys = {};
const versions = {};
export function persistCollection(kind, collection) {
  const body = JSON.stringify(collection);
  const version = versions[kind] = (versions[kind] || 0) + 1;
  const key = storageKeys[kind];
  if (key) localStorage.setItem(key + '.disk-dirty', '1');
  const next = pending.then(async () => {
    const response = await fetch(`/api/workspace/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (!response.ok) throw new Error('Disk save failed.');
    if (key && versions[kind] === version) localStorage.removeItem(key + '.disk-dirty');
  });
  pending = next.catch(() => {});
  return next;
}

export async function restoreWorkspace(keys) {
  storageKeys = keys;
  const response = await fetch('/api/workspace', { cache: 'no-store' });
  if (!response.ok) throw new Error('Disk storage unavailable.');
  const saved = await response.json();
  for (const [kind, key] of Object.entries(keys)) {
    const local = JSON.parse(localStorage.getItem(key) || '{}');
    const merged = { ...(saved[kind] || {}) };
    // Import browser copies once per origin; subsequent reloads use disk as authority,
    // including deletions. Import never replaces a more recently saved named item.
    if (!localStorage.getItem(key + '.disk-migrated') || localStorage.getItem(key + '.disk-dirty')) {
      // A failed save is a full local snapshot, including deliberate deletions.
      if (localStorage.getItem(key + '.disk-dirty')) {
        for (const name of Object.keys(merged)) delete merged[name];
      }
      for (const [name, item] of Object.entries(local)) {
        if (!merged[name] || String(item.savedAt || '') > String(merged[name].savedAt || '')) merged[name] = item;
      }
      await persistCollection(kind, merged);
      localStorage.setItem(key + '.disk-migrated', '1');
    }
    localStorage.setItem(key, JSON.stringify(merged));
  }
}
