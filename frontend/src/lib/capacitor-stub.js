const listenerHandle = {
  remove: () => {}
};

export const App = {
  addListener: async () => listenerHandle,
  removeAllListeners: async () => {}
};

export const Geolocation = {
  checkPermissions: async () => ({ location: "prompt" }),
  requestPermissions: async () => ({ location: "prompt" }),
  getCurrentPosition: async () => {
    throw new Error("Capacitor geolocation is unavailable in web builds.");
  },
  watchPosition: async () => "web-stub-watch",
  clearWatch: async () => {}
};
