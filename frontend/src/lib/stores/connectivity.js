import { writable } from 'svelte/store';

const initialState = {
  isOnline: true,
  socketConnected: false,
  bufferedCount: 0
};

export const connectivityStore = writable(initialState);

export function setOnlineStatus(isOnline) {
  connectivityStore.update((state) => ({ ...state, isOnline: !!isOnline }));
}

export function setSocketConnected(connected) {
  connectivityStore.update((state) => ({ ...state, socketConnected: !!connected }));
}

export function setBufferedCount(count) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  connectivityStore.update((state) => ({ ...state, bufferedCount: safeCount }));
}

export function resetConnectivity() {
  connectivityStore.set(initialState);
}
