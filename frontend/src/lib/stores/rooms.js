import { writable } from 'svelte/store';

export const myRooms = writable([]);
export const myShareCode = writable('');
export const myContactInfo = writable({ email: '', mobile: '' });
