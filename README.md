# Kinnect

**Kin + Connect** — Real-time GPS location sharing for families.

Built with Node.js, Express, Socket.io, Svelte, Leaflet, PostgreSQL, and Capacitor.

## Features

- **Real-time location sharing** via rooms, contacts, and guardian/ward relationships
- **Manual + auto SOS** — no-movement, hard-stop, and geofence breach triggers
- **Acknowledgment pipeline** with tokenized emergency watch links
- **Check-in monitoring** with overdue alerts to guardians/managers
- **Guardian/ward permissions** with time-limited roles and majority-vote room admin
- **Live sharing links** — 1h, 6h, 24h, 48h, or permanent; revocable
- **Offline position buffering** (200 entries) with batch replay on reconnect
- **Kalman-filtered GPS** with speed-adaptive smoothing
- **Smooth marker interpolation**, dark mode, responsive UI, mobile-ready (Capacitor)

## Prerequisites

- **Node.js** 20.x
- **PostgreSQL** (any recent version)
- **Redis** (optional — enables Socket.io adapter for horizontal scaling)

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and SESSION_SECRET

# 3. Start backend (port 3000) and frontend dev server (port 5173) separately
npm run dev:be
npm run dev:fe    # in a second terminal — opens Vite with HMR

# 4. Open the app
open http://localhost:5173
```

### Production-like local run (single port)

```bash
npm run build && npm start
# or equivalently:
npm run start:local

open http://localhost:3000
```

> **Note:** `npm start` does **not** build the frontend — it only starts the backend and serves whatever is in `frontend/dist/`. Always run `npm run build` first, or use `npm run start:local`.

## All Commands

| Command | Description |
|---|---|
| `npm install` | Install all dependencies |
| `npm run dev:be` | Start backend server (port 3000) |
| `npm run dev:fe` | Start Vite frontend dev server (port 5173, HMR) |
| `npm run build` | Build Svelte frontend to `frontend/dist/` |
| `npm start` | Start backend (serves pre-built frontend) |
| `npm run start:local` | Build frontend + start backend |
| `npm test` | Run Jest tests (requires `DATABASE_URL`) |
| `npm run lint` | ESLint on `backend/` and `test/` |
| `npm run build:android:prod -- <url>` | Build Android APK with backend URL |
| `npm run build:ios:prod -- <url>` | Build iOS with backend URL |
| `npm run run:android` | Run on Android device/emulator |
| `npm run run:ios` | Run on iOS simulator/device |

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Random 64-char string for session encryption |
| `REDIS_URL` | No | Enables Socket.io Redis adapter for multi-process scaling |
| `ADMIN_EMAIL` | No | First user with this email gets admin role |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Set to `production` for deployed environments |

## Deployment

Pre-configured for **Render** via `render.yaml`:

- **Build:** `npm install --include=dev && npm run build`
- **Start:** `npm start`

## Mobile Builds (Capacitor)

Android and iOS builds require the production backend URL as an argument:

```bash
npm run build:android:prod -- https://your-backend.onrender.com
npm run build:ios:prod -- https://your-backend.onrender.com
```

The URL must be a public HTTPS origin with no trailing slash or path.

## Project Structure

```
backend/
  index.js            # Entry point — DB init, cache load, server start
  app.js              # Express setup — middleware, session, routes, SPA serving
  config.js           # Constants — rate limits, cooldowns, logging
  cache.js            # Dual-layer in-memory cache (persistent + ephemeral)
  lib/                # Database, helpers, CORS, country codes
  middleware/          # CSRF, rate limiting
  routes/             # HTTP routes — auth, pages, admin, health
  services/           # Visibility graph, SOS, cleanup, emitters, position history
  socket/             # Socket.io handlers — auth, public, SOS
frontend/src/
  pages/              # Login, Register, MainApp, LiveViewer, WatchViewer
  components/         # Map, UsersList, InfoPanel, SharingPanel, AdminPanel, primitives/
  lib/                # Socket client, API client, stores, Kalman filter, offline buffer
test/
  integration.test.js # HTTP route tests (Jest + Supertest)
  helpers.test.js     # Unit tests for utility functions
```

## License

ISC
