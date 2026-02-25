/**
 * Shared environment configuration.
 * In Capacitor native builds, VITE_API_URL must point to the server
 * (e.g. "https://your-server.com"). In web builds, it defaults to ''
 * so that all requests use the current origin.
 */
function normalizeApiBase(rawValue) {
  if (typeof rawValue !== 'string') return '';
  const trimmed = rawValue.trim();
  if (!trimmed) return '';

  try {
    // Keep only the origin to avoid accidental path/query fragments.
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

const rawApiBase = import.meta.env.VITE_API_URL;
const API_BASE = normalizeApiBase(rawApiBase);

if (import.meta.env.DEV && rawApiBase && !API_BASE) {
  console.warn('Invalid VITE_API_URL. Falling back to same-origin API calls.');
}

export default API_BASE;
