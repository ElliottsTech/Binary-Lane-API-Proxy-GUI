// Thin fetch wrapper for /api/* — JSON in/out, throws on error.
const base = '/api';

export async function api(path, opts = {}) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json ok */ }
  if (!res.ok) {
    const err = new Error(json?.error || res.statusText);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json ?? { ok: true };
}

export const del = (path) => api(path, { method: 'DELETE' });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const post = (path, body) => api(path, { method: 'POST', body });
