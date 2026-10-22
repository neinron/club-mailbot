import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// Private local data, outside the public directory and ignored by Git.
export function workspaceStore(directory) {
  const file = join(directory, 'workspace.json');
  let queue = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { drafts: {}, lists: {} }; throw error; }
  }
  function save(kind, collection) {
    if (!['drafts', 'lists'].includes(kind) || !collection || Array.isArray(collection) || typeof collection !== 'object') throw new Error('Invalid workspace collection.');
    const clean = JSON.parse(JSON.stringify(collection, (key, value) => /password|secret|token|apiKey/i.test(key) ? undefined : value));
    const operation = queue.then(async () => {
      const state = await read();
      state[kind] = clean;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read: async () => { await queue; return read(); }, save };
}
