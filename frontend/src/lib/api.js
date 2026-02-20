import API_BASE from './env.js';

let csrfToken = null;

export async function fetchCsrf() {
  try {
    const res = await fetch(API_BASE + '/api/csrf', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
    }
  } catch {
    // Network error — csrfToken stays null
  }
  return csrfToken;
}

export function getCsrf() {
  return csrfToken;
}

function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text().then(text => ({ ok: false, error: text || `Request failed (${res.status})` }));
}

export async function apiPost(url, body = {}) {
  try {
    if (!csrfToken) await fetchCsrf();
    const res = await fetch(API_BASE + url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '' },
      body: JSON.stringify({ ...body, _csrf: csrfToken })
    });
    return safeJson(res);
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function apiGet(url) {
  try {
    const res = await fetch(API_BASE + url, { credentials: 'same-origin' });
    if (res.status === 401) return { ok: false, error: 'Not authenticated' };
    return safeJson(res);
  } catch {
    return { ok: false, error: 'Network error' };
  }
}
