import { writable } from 'svelte/store';

export const otherUsers = writable(new Map());
export const myLocation = writable(null);
export const mySocketId = writable(null);
export const tracking = writable(false);
export const selectedUsers = writable([]);
export const geofenceCircles = writable(new Map());
export const mySafetyStatus = writable({
  geofence: { enabled: false, centerLat: null, centerLng: null, radiusM: 0 },
  autoSos: { enabled: false, noMoveMinutes: 5, hardStopMinutes: 2, geofence: false },
  checkIn: { enabled: false, intervalMinutes: 5, overdueMinutes: 7, lastCheckInAt: null }
});

/**
 * Set to a socketId, userId, or '__self__' to fly the map to that user and open their popup.
 * Automatically resets to null after the map consumes it.
 */
export const focusUser = writable(null);
