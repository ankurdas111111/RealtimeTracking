import { writable } from 'svelte/store';

export const banner = writable({ type: null, text: null, actions: [] });
export const alertState = writable({ visible: false, title: '', body: '', actions: [], alarmMs: 0 });
export const myLiveLinks = writable([]);
export const mySosActive = writable(false);
