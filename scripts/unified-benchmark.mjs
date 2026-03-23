#!/usr/bin/env node
/**
 * Unified benchmark for Kinnect backends (v1/v2/v3).
 *
 * Supports:
 * - HTTP latency + burst throughput tests
 * - Authenticated realtime fanout test (position -> userUpdate)
 *
 * Usage examples:
 *   node scripts/unified-benchmark.mjs --name v1 --url http://localhost:3000 --protocol socketio
 *   node scripts/unified-benchmark.mjs --name v3 --url http://localhost:3001 --protocol ws
 */
import { io as ioClient } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';
import WebSocket from 'ws';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const NAME = arg('name', 'backend');
const BASE_URL = arg('url', 'http://localhost:3000');
const PROTOCOL = arg('protocol', 'socketio'); // socketio | ws
const USERS = Math.max(2, parseInt(arg('users', '10'), 10));
const DURATION_S = Math.max(5, parseInt(arg('duration', '20'), 10));
const INTERVAL_MS = Math.max(100, parseInt(arg('interval', '250'), 10));
const HTTP_ITERATIONS = Math.max(20, parseInt(arg('http-iterations', '30'), 10));
const HTTP_CONCURRENCY = Math.max(5, parseInt(arg('http-concurrency', '25'), 10));
const HTTP_DURATION_S = Math.max(5, parseInt(arg('http-duration', '10'), 10));
const PASSWORD = 'benchpass123';
const EMAIL_PREFIX = `unified-bench-${NAME.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * p)];
}

function summarizeSamples(samples) {
  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    max: percentile(samples, 0.999),
    samples: samples.length,
  };
}

function extractCookieFromResponse(res) {
  const getSetCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (getSetCookie.length > 0) return getSetCookie.map((v) => v.split(';')[0]).join('; ');
  const raw = res.headers.get('set-cookie');
  if (!raw) return '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
    .map((v) => v.split(';')[0].trim())
    .join('; ');
}

function mergeCookies(baseCookie, newCookie) {
  const jar = new Map();
  const add = (s) => {
    if (!s) return;
    for (const part of s.split(';')) {
      const p = part.trim();
      const eq = p.indexOf('=');
      if (eq <= 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (k) jar.set(k, v);
    }
  };
  add(baseCookie);
  add(newCookie);
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function timedFetch(url, opts) {
  const t0 = Date.now();
  const res = await fetch(url, opts);
  const ms = Date.now() - t0;
  return { res, ms };
}

async function probeEndpoint(path, iterations) {
  const lat = [];
  let ok = 0;
  let non2xx = 0;
  let errors = 0;
  for (let i = 0; i < iterations; i++) {
    try {
      const { res, ms } = await timedFetch(`${BASE_URL}${path}`);
      lat.push(ms);
      if (res.ok) ok++;
      else non2xx++;
      await res.arrayBuffer().catch(() => {});
    } catch {
      errors++;
    }
  }
  return { path, iterations, ok, non2xx, errors, latencyMs: summarizeSamples(lat) };
}

async function burstEndpoint(path, durationSec, concurrency) {
  const lat = [];
  let total = 0;
  let ok = 0;
  let non2xx = 0;
  let errors = 0;
  const deadline = Date.now() + durationSec * 1000;

  async function worker() {
    while (Date.now() < deadline) {
      try {
        const { res, ms } = await timedFetch(`${BASE_URL}${path}`);
        total++;
        lat.push(ms);
        if (res.ok) ok++;
        else non2xx++;
        await res.arrayBuffer().catch(() => {});
      } catch {
        total++;
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const reqPerSec = total / durationSec;
  return {
    path,
    durationSec,
    concurrency,
    totalRequests: total,
    ok,
    non2xx,
    errors,
    reqPerSec: +reqPerSec.toFixed(2),
    latencyMs: summarizeSamples(lat),
  };
}

async function fetchCsrf() {
  const res = await fetch(`${BASE_URL}/api/csrf`);
  if (!res.ok) throw new Error(`csrf failed: ${res.status}`);
  const body = await res.json();
  const cookie = extractCookieFromResponse(res);
  if (!body?.csrfToken) throw new Error('csrf token missing');
  if (!cookie) throw new Error('session cookie missing from /api/csrf');
  return { csrfToken: body.csrfToken, cookie };
}

async function postJson(path, payload, { csrfToken, cookie }) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      cookie,
    },
    body: JSON.stringify(payload),
  });
  const setCookie = extractCookieFromResponse(res);
  const mergedCookie = mergeCookies(cookie, setCookie);
  let body = null;
  try { body = await res.json(); } catch {}
  return { res, body, cookie: mergedCookie };
}

async function ensureUserSession(i) {
  const email = `${EMAIL_PREFIX}-${i}@example.com`;
  const sess = await fetchCsrf();
  const regPayload = {
    first_name: `Bench${i}`,
    last_name: 'User',
    password: PASSWORD,
    confirm: PASSWORD,
    contact_type: 'email',
    contact_value: email,
  };
  const reg = await postJson('/api/register', regPayload, sess);
  if (reg.res.ok && reg.body?.ok) {
    return { email, cookie: reg.cookie || sess.cookie, mode: 'registered' };
  }
  if (reg.res.status !== 409) {
    throw new Error(`register failed ${email}: status=${reg.res.status} body=${JSON.stringify(reg.body)}`);
  }
  const loginPayload = { login_id: email, login_method: 'email', password: PASSWORD };
  const login = await postJson('/api/login', loginPayload, sess);
  if (!login.res.ok || !login.body?.ok) {
    throw new Error(`login failed ${email}: status=${login.res.status} body=${JSON.stringify(login.body)}`);
  }
  return { email, cookie: login.cookie || sess.cookie, mode: 'logged-in' };
}

function createSocketIoClient(cookie, stats) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = ioClient(BASE_URL, {
      transports: ['websocket'],
      parser: msgpackParser,
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    const timer = setTimeout(() => {
      try { socket.disconnect(); } catch {}
      reject(new Error('socket.io connect timeout'));
    }, 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      stats.connectMs.push(Date.now() - started);
      resolve({
        protocol: 'socketio',
        connected: () => socket.connected,
        on: (e, cb) => socket.on(e, cb),
        off: (e, cb) => socket.off(e, cb),
        emit: (e, d) => socket.emit(e, d),
        disconnect: () => socket.disconnect(),
      });
    });
    socket.on('connect_error', (e) => {
      stats.errors += 1;
      clearTimeout(timer);
      reject(new Error(`socket.io connect_error: ${e?.message || 'unknown'}`));
    });
  });
}

function createWsClient(cookie, stats) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const wsUrl = BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
    const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    const listeners = new Map();
    let connected = false;
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('ws connect timeout'));
    }, 10000);

    ws.on('open', () => {
      connected = true;
      clearTimeout(timer);
      stats.connectMs.push(Date.now() - started);
      resolve({
        protocol: 'ws',
        connected: () => connected && ws.readyState === WebSocket.OPEN,
        on: (event, cb) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(cb);
        },
        off: (event, cb) => {
          const set = listeners.get(event);
          if (!set) return;
          set.delete(cb);
        },
        emit: (event, data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ e: event, d: data }));
          }
        },
        disconnect: () => {
          connected = false;
          try { ws.close(); } catch {}
        },
      });
    });

    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(String(buf));
        const event = msg?.e;
        const data = msg?.d;
        const set = listeners.get(event);
        if (!set) return;
        for (const cb of set) cb(data);
      } catch {}
    });

    ws.on('close', () => { connected = false; });
    ws.on('error', (e) => {
      stats.errors += 1;
      clearTimeout(timer);
      if (!connected) reject(new Error(`ws connect error: ${e?.message || 'unknown'}`));
    });
  });
}

async function connectRealtimeClient(cookie, stats) {
  if (PROTOCOL === 'ws') return createWsClient(cookie, stats);
  return createSocketIoClient(cookie, stats);
}

function waitForEvent(client, okEvent, errEvent, emitFn, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      client.off(okEvent, onOk);
      if (errEvent) client.off(errEvent, onErr);
      clearTimeout(timer);
    };
    const onOk = (data) => {
      if (settled) return;
      settled = true;
      done();
      resolve(data);
    };
    const onErr = (data) => {
      if (settled) return;
      settled = true;
      done();
      reject(new Error(`${errEvent}: ${JSON.stringify(data)}`));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      done();
      reject(new Error(`timeout waiting for ${okEvent}`));
    }, timeoutMs);
    client.on(okEvent, onOk);
    if (errEvent) client.on(errEvent, onErr);
    emitFn();
  });
}

async function runRealtimeFanout() {
  const stats = {
    users: USERS,
    connectMs: [],
    sent: 0,
    received: 0,
    recvLagMs: [],
    errors: 0,
    roomJoinFailures: 0,
  };
  const sockets = [];
  const users = [];
  let start = Date.now();
  let tick = null;
  try {
    for (let i = 0; i < USERS; i++) users.push(await ensureUserSession(i));
    for (const u of users) sockets.push(await connectRealtimeClient(u.cookie, stats));
    await sleep(300);

    for (const c of sockets) {
      c.on('userUpdate', (data) => {
        stats.received += 1;
        if (data && typeof data.serverTs === 'number') {
          const lag = Date.now() - data.serverTs;
          if (lag >= 0 && lag < 60000) stats.recvLagMs.push(lag);
        }
      });
    }

    const room = await waitForEvent(
      sockets[0],
      'roomCreated',
      'roomError',
      () => sockets[0].emit('createRoom', { name: `Bench-${Date.now()}` }),
    );
    const code = room?.code;
    if (!code) throw new Error('missing room code');

    for (let i = 1; i < sockets.length; i++) {
      try {
        await waitForEvent(
          sockets[i],
          'roomJoined',
          'roomError',
          () => sockets[i].emit('joinRoom', { code }),
        );
      } catch {
        stats.roomJoinFailures++;
      }
    }

    start = Date.now();
    tick = setInterval(() => {
      const ts = Date.now();
      for (let i = 0; i < sockets.length; i++) {
        const c = sockets[i];
        if (!c.connected()) continue;
        c.emit('position', {
          latitude: 12.97 + i * 0.0002 + Math.random() * 0.00005,
          longitude: 77.59 + i * 0.0002 + Math.random() * 0.00005,
          speed: 8 + Math.random() * 12,
          accuracy: 5 + Math.random() * 8,
          timestamp: ts,
          formattedTime: nowIso(),
        });
        stats.sent++;
      }
    }, INTERVAL_MS);

    await sleep(DURATION_S * 1000);
    clearInterval(tick);
    tick = null;
    await sleep(1200);

    const elapsed = (Date.now() - start) / 1000;
    const connected = sockets.length - stats.roomJoinFailures;
    const expectedMax = stats.sent * Math.max(0, connected - 1);
    const delivery = expectedMax > 0 ? stats.received / expectedMax : 0;

    return {
      users: USERS,
      connected: sockets.length,
      roomJoinFailures: stats.roomJoinFailures,
      durationSec: +elapsed.toFixed(2),
      sent: stats.sent,
      sentPerSec: +(stats.sent / elapsed).toFixed(2),
      received: stats.received,
      receivedPerSec: +(stats.received / elapsed).toFixed(2),
      expectedMaxFanoutEvents: expectedMax,
      fanoutDeliveryRatio: +delivery.toFixed(4),
      connectLatencyMs: summarizeSamples(stats.connectMs),
      updateLatencyServerTsToClientMs: summarizeSamples(stats.recvLagMs),
      errors: stats.errors,
    };
  } finally {
    if (tick) clearInterval(tick);
    for (const c of sockets) {
      try { c.disconnect(); } catch {}
    }
  }
}

async function run() {
  const preHealth = await fetch(`${BASE_URL}/health`).then((r) => r.json()).catch(() => null);
  let realtime;
  try {
    realtime = await runRealtimeFanout();
  } catch (e) {
    realtime = {
      error: e?.message || String(e),
      users: USERS,
    };
  }
  const httpHealthProbe = await probeEndpoint('/health', HTTP_ITERATIONS);
  const httpCsrfProbe = await probeEndpoint('/api/csrf', HTTP_ITERATIONS);
  const httpHealthBurst = await burstEndpoint('/health', HTTP_DURATION_S, HTTP_CONCURRENCY);
  const postHealth = await fetch(`${BASE_URL}/health`).then((r) => r.json()).catch(() => null);

  const result = {
    name: NAME,
    url: BASE_URL,
    protocol: PROTOCOL,
    config: {
      users: USERS,
      durationSec: DURATION_S,
      intervalMs: INTERVAL_MS,
      httpIterations: HTTP_ITERATIONS,
      httpConcurrency: HTTP_CONCURRENCY,
      httpDurationSec: HTTP_DURATION_S,
    },
    http: {
      healthProbe: httpHealthProbe,
      csrfProbe: httpCsrfProbe,
      healthBurst: httpHealthBurst,
    },
    realtime,
    health: {
      before: preHealth,
      after: postHealth,
    },
  };

  console.log(`\n--- BENCHMARK ${NAME} (${PROTOCOL}) ---`);
  console.log(`URL=${BASE_URL}`);
  console.log('--- RESULT_JSON_START ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('--- RESULT_JSON_END ---');
}

run().catch((e) => {
  console.error('BENCHMARK_ERROR:', e?.stack || e?.message || e);
  process.exit(1);
});
