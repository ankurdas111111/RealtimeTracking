/**
 * WebSocket adapter - drop-in replacement for Socket.IO client.
 * Provides the same API for use with the Go backend-v3 WebSocket server.
 *
 * Usage (same as Socket.IO):
 *   import { socket, setupSocketHandlers } from './ws-adapter.js';
 *   socket.emit('position', { latitude: 12.97, longitude: 77.59 });
 *   socket.on('userUpdate', (data) => { ... });
 *   socket.connect();
 *   socket.disconnect();
 */

function getWsBaseUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.trim() || null;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return null;
}

function buildWsUrl(base) {
  const b = base || 'http://localhost:3000';
  return b.replace(/^http/, 'ws') + '/ws';
}

class WsSocket {
  constructor(url, options = {}) {
    this.url = url || buildWsUrl(getWsBaseUrl());
    this.options = options;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this._listeners = {};
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = options.reconnectionAttempts ?? 50;
    this._reconnectDelay = options.reconnectionDelay ?? 200;
    this._reconnectDelayMax = options.reconnectionDelayMax ?? 3000;
    this._randomizationFactor = options.randomizationFactor ?? 0.3;
    this._timeout = options.timeout ?? 8000;
    this._autoConnect = options.autoConnect !== false;
    this._reconnection = options.reconnection !== false;
    this._manualDisconnect = false;

    this.io = {
      on: (event, cb) => this._ioOn(event, cb),
      _ioListeners: {},
    };

    if (this._autoConnect) {
      this.connect();
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._manualDisconnect = false;
    this._doConnect();
  }

  _doConnect() {
    let wsUrl = this.url.replace(/^http/, 'ws');
    if (!wsUrl.endsWith('/ws')) wsUrl += '/ws';
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.id = this._generateId();
      if (this._reconnectAttempts > 0) {
        this._fireIoEvent('reconnect', this._reconnectAttempts);
      }
      this._reconnectAttempts = 0;
      this._fireEvent('connect');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e && this._listeners[msg.e]) {
          for (const cb of this._listeners[msg.e]) {
            cb(msg.d);
          }
        }
      } catch (_e) {}
    };

    this.ws.onclose = (event) => {
      const wasConnected = this.connected;
      this.connected = false;
      this._fireEvent('disconnect', event.reason || 'transport close');

      if (!this._manualDisconnect && this._reconnection && this._reconnectAttempts < this._maxReconnectAttempts) {
        this._scheduleReconnect();
      } else if (this._reconnectAttempts >= this._maxReconnectAttempts) {
        this._fireIoEvent('reconnect_failed');
      }
    };

    this.ws.onerror = (err) => {
      this._fireEvent('connect_error', err);
    };
  }

  _scheduleReconnect() {
    this._reconnectAttempts++;
    const delay = Math.min(
      this._reconnectDelay * Math.pow(1.5, this._reconnectAttempts - 1),
      this._reconnectDelayMax
    );
    const jitter = delay * this._randomizationFactor * (Math.random() * 2 - 1);
    const finalDelay = Math.max(0, delay + jitter);

    this._fireIoEvent('reconnect_attempt', this._reconnectAttempts);

    setTimeout(() => {
      if (this._manualDisconnect) return;
      this._doConnect();
    }, finalDelay);
  }

  disconnect() {
    this._manualDisconnect = true;
    if (this.ws) {
      this.ws.close();
    }
    this.connected = false;
  }

  emit(event, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ e: event, d: data }));
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    if (!callback) {
      delete this._listeners[event];
      return;
    }
    this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
  }

  _fireEvent(event, ...args) {
    if (this._listeners[event]) {
      for (const cb of this._listeners[event]) {
        cb(...args);
      }
    }
  }

  _ioOn(event, cb) {
    if (!this.io._ioListeners[event]) this.io._ioListeners[event] = [];
    this.io._ioListeners[event].push(cb);
  }

  _fireIoEvent(event, ...args) {
    if (this.io._ioListeners[event]) {
      for (const cb of this.io._ioListeners[event]) {
        cb(...args);
      }
    }
    if (event === 'reconnect') {
      this._fireEvent('connect');
    }
  }

  _generateId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

const API_BASE = getWsBaseUrl() || '';
const socketUrl = API_BASE ? (API_BASE.startsWith('http') ? API_BASE : 'http://' + API_BASE) : undefined;

export const socket = new WsSocket(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 50,
  reconnectionDelay: 200,
  reconnectionDelayMax: 3000,
  randomizationFactor: 0.3,
  timeout: 8000,
});

/**
 * No-op for API compatibility. The frontend should call socket.on() etc.
 * to register its own handlers, or use a separate setupSocketHandlers
 * that imports this socket and configures it.
 */
export function setupSocketHandlers() {}
