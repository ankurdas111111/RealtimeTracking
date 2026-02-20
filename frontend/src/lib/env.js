/**
 * Shared environment configuration.
 * In Capacitor native builds, VITE_API_URL must point to the server
 * (e.g. "https://your-server.com"). In web builds, it defaults to ''
 * so that all requests use the current origin.
 */
const API_BASE = import.meta.env.VITE_API_URL || '';
export default API_BASE;
