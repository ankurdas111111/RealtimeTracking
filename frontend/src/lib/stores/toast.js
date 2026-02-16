import { writable } from 'svelte/store';

let nextId = 0;

function createToastStore() {
  const { subscribe, update } = writable([]);

  return {
    subscribe,
    add(message, options = {}) {
      const id = ++nextId;
      const toast = {
        id,
        message,
        type: options.type || 'info',
        duration: options.duration ?? 4000,
      };
      update(toasts => [...toasts, toast]);

      if (toast.duration > 0) {
        setTimeout(() => this.remove(id), toast.duration);
      }
      return id;
    },
    remove(id) {
      update(toasts => toasts.filter(t => t.id !== id));
    },
    info(message, duration) { return this.add(message, { type: 'info', duration }); },
    success(message, duration) { return this.add(message, { type: 'success', duration }); },
    error(message, duration) { return this.add(message, { type: 'error', duration }); },
    warning(message, duration) { return this.add(message, { type: 'warning', duration }); },
  };
}

export const toasts = createToastStore();
