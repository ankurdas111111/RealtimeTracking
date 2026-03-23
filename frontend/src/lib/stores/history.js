import { writable } from 'svelte/store';

export const historyPoints = writable([]);
export const historyLoading = writable(false);
export const historyTarget = writable(null);
export const historyDate = writable(todayStr());
export const historyVisible = writable(false);
export const historyPlayback = writable({ playing: false, index: 0, speed: 1 });

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
