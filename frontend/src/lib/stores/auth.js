import { writable, get } from 'svelte/store';
import { apiGet } from '../api.js';

export const authUser = writable(null);
export const authLoading = writable(true);

export async function loadSession() {
  authLoading.set(true);
  try {
    const data = await apiGet('/api/me');
    if (data && data.ok) {
      authUser.set({
        userId: data.userId,
        displayName: data.displayName,
        role: data.role,
        shareCode: data.shareCode,
        email: data.email,
        mobile: data.mobile
      });
    } else {
      authUser.set(null);
    }
  } catch {
    authUser.set(null);
  }
  authLoading.set(false);
}

export function isAdmin() {
  const u = get(authUser);
  return u && u.role === 'admin';
}

export function isAuthenticated() {
  return get(authUser) !== null;
}
