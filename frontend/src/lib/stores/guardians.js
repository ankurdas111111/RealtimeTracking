import { writable } from 'svelte/store';

export const myGuardianData = writable({ asGuardian: [], asWard: [], manageable: [] });
export const canManage = writable(new Map());
export const pendingIncomingRequests = writable([]);
