import API_BASE from './env.js';

const REALTIME_PROTOCOL = String(import.meta.env.VITE_REALTIME_PROTOCOL || 'ws').toLowerCase();

function buildWsUrl(base) {
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const wsOrigin = origin.replace(/^http/i, 'ws');
  return wsOrigin.endsWith('/ws') ? wsOrigin : wsOrigin + '/ws';
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

class WsCompatSocket {
  constructor(base, options = {}) {
    this.base = base;
    this.url = buildWsUrl(base);
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.listeners = {};
    this.ioListeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.reconnectionAttempts ?? 50;
    this.reconnectDelay = options.reconnectionDelay ?? 200;
    this.reconnectDelayMax = options.reconnectionDelayMax ?? 3000;
    this.randomizationFactor = options.randomizationFactor ?? 0.3;
    this.reconnection = options.reconnection !== false;
    this.manualDisconnect = false;
    this.io = {
      on: (event, cb) => {
        if (!this.ioListeners[event]) this.ioListeners[event] = [];
        this.ioListeners[event].push(cb);
      }
    };
    if (options.autoConnect !== false) this.connect();
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  off(event, cb) {
    if (!this.listeners[event]) return;
    if (!cb) { delete this.listeners[event]; return; }
    this.listeners[event] = this.listeners[event].filter((fn) => fn !== cb);
  }

  emit(event, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ e: event, d: data }));
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.manualDisconnect = false;
    this.open();
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.ws) this.ws.close();
    this.connected = false;
  }

  open() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.connected = true;
      this.id = randomId();
      if (this.reconnectAttempts > 0) this.fireIo('reconnect', this.reconnectAttempts);
      this.reconnectAttempts = 0;
      this.fire('connect');
    };
    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.e) this.fire(msg.e, msg.d);
      } catch (_) {}
    };
    this.ws.onerror = () => {
      this.fire('connect_error', new Error('websocket error'));
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.fire('disconnect', 'transport close');
      if (!this.manualDisconnect && this.reconnection && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.fireIo('reconnect_failed');
      }
    };
  }

  scheduleReconnect() {
    this.reconnectAttempts += 1;
    this.fireIo('reconnect_attempt', this.reconnectAttempts);
    const baseDelay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.reconnectDelayMax);
    const jitter = baseDelay * this.randomizationFactor * (Math.random() * 2 - 1);
    const wait = Math.max(0, baseDelay + jitter);
    setTimeout(() => {
      if (this.manualDisconnect) return;
      this.open();
    }, wait);
  }

  fire(event, ...args) {
    const cbs = this.listeners[event];
    if (!cbs) return;
    cbs.forEach((cb) => cb(...args));
  }

  fireIo(event, ...args) {
    const cbs = this.ioListeners[event];
    if (cbs) cbs.forEach((cb) => cb(...args));
    if (event === 'reconnect') this.fire('connect');
  }
}

/**
 * Create a realtime socket. Uses WsCompatSocket (raw WS) when
 * VITE_REALTIME_PROTOCOL=ws (Go V3 backend), otherwise falls back
 * to Socket.IO client (V1/V2 backends).
 *
 * Socket.IO dependencies are loaded via dynamic import() so they are
 * completely tree-shaken from the bundle in ws mode.
 */
export function createRealtimeSocket(options = {}) {
  if (REALTIME_PROTOCOL === 'ws') {
    return new WsCompatSocket(API_BASE || undefined, options);
  }

  // Lazy-load socket.io-client so the entire library is eliminated from
  // the production bundle when building for the Go V3 backend (ws mode).
  let socket = null;
  const pending = Promise.all([
    import('socket.io-client'),
    import('socket.io-msgpack-parser')
  ]).then(([{ io }, msgpackParser]) => {
    const socketBase = API_BASE || undefined;
    const s = io(socketBase, {
      transports: ['websocket'],
      parser: msgpackParser,
      ...options
    });
    if (socket) {
      Object.assign(socket, { _real: s });
      for (const [ev, cbs] of Object.entries(socket._pending || {})) {
        cbs.forEach(cb => s.on(ev, cb));
      }
      if (socket._autoConnect) s.connect();
    }
    return s;
  });

  // Return a thin proxy that queues calls until dynamic import resolves
  socket = {
    _real: null,
    _pending: {},
    _autoConnect: options.autoConnect !== false,
    connected: false,
    id: null,
    io: { on: () => {} },
    on(ev, cb) {
      if (this._real) { this._real.on(ev, cb); return; }
      if (!this._pending[ev]) this._pending[ev] = [];
      this._pending[ev].push(cb);
    },
    off(ev, cb) { if (this._real) this._real.off(ev, cb); },
    emit(...args) { if (this._real) this._real.emit(...args); },
    connect() { if (this._real) this._real.connect(); else this._autoConnect = true; },
    disconnect() { if (this._real) this._real.disconnect(); else this._autoConnect = false; },
    get _ready() { return pending; }
  };
  return socket;
}

export function isRawWsMode() {
  return REALTIME_PROTOCOL === 'ws';
}
