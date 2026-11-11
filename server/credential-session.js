// Process memory only: no files, browser storage, or credential-returning API.
export function createCredentialSession({now = Date.now} = {}) {
  let entry;
  const key = (email, mode) => `${String(email || '').trim().toLowerCase()}|${mode === 'xoauth2' ? 'xoauth2' : 'appPassword'}`;
  return {
    remember(email, mode, secret) {
      if (!secret) return;
      entry = {key:key(email, mode), secret, expiresAt:now() + (mode === 'xoauth2' ? 50 * 60_000 : 8 * 60 * 60_000)};
    },
    get(email, mode) {
      if (entry && entry.expiresAt <= now()) entry = undefined;
      return entry?.key === key(email, mode) ? entry.secret : '';
    },
    forget() { entry = undefined; }
  };
}
