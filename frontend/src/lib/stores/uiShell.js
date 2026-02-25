import { writable } from 'svelte/store';

const initialState = {
  mobileTab: 'track',
  sheetOpen: false
};

export const uiShellStore = writable(initialState);

export function setMobileTab(tab) {
  uiShellStore.update((state) => ({ ...state, mobileTab: tab }));
}

export function setSheetOpen(open) {
  uiShellStore.update((state) => ({ ...state, sheetOpen: !!open }));
}

export function resetUiShell() {
  uiShellStore.set(initialState);
}
