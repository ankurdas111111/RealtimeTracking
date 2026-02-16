let csrfToken = null;

export async function fetchCsrf() {
  const res = await fetch('/api/csrf', { credentials: 'same-origin' });
  if (res.ok) {
    const data = await res.json();
    csrfToken = data.csrfToken;
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
  if (!csrfToken) await fetchCsrf();
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, _csrf: csrfToken })
  });
  return safeJson(res);
}

export async function apiGet(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) return { ok: false, error: 'Not authenticated' };
  return safeJson(res);
}
