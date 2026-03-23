import { writable } from 'svelte/store';

export const savedPlaces = writable([]);
export const placeAlerts = writable([]);
export const speedAlerts = writable([]);
export const privacyPause = writable(null);
