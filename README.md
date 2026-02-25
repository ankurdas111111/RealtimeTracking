# Kinnect

**Kinnect** = *Kin + Connect* — Your family, always close.

Real-time location tracking web app built with Node.js, Express, Socket.io, and Leaflet. Share your location with family and loved ones, create rooms, manage contacts, and get SOS alerts — all in real time.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Mobile build (with backend URL)

Use these helpers so the APK/IPA is built with the correct API base URL:

```bash
npm run build:android:prod -- https://your-backend.onrender.com
npm run build:ios:prod -- https://your-backend.onrender.com
```

The URL must be public HTTPS.


