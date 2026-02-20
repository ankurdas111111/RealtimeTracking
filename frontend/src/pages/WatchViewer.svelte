<script>
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { io } from 'socket.io-client';
  import * as msgpackParser from 'socket.io-msgpack-parser';
  import { createMapIcon, formatCoordinate, escapeAttr } from '../lib/tracking.js';
  import { animateMarkerTo } from '../lib/markerInterpolator.js';

  export let params = {};

  let mapContainer;
  let map;
  let marker = null;
  let socket = null;
  let bannerText = 'Connecting...';
  let bannerSos = false;
  let sosActive = false;
  let hasInit = false;
  let initTimeout = null;
  let tileLayer = null;
  let tileProviderIdx = 0;
  let tileErrorCount = 0;
  const tileProviders = [
    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } },
    { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } }
  ];

  function clearInitTimeout() {
    if (initTimeout) {
      clearTimeout(initTimeout);
      initTimeout = null;
    }
  }

  function scheduleInitTimeout() {
    clearInitTimeout();
    initTimeout = setTimeout(() => {
      if (!hasInit) {
        bannerText = 'Unable to load watch session. The link may be invalid, expired, or unavailable.';
        bannerSos = true;
      }
    }, 8000);
  }

  function mountTileProvider(index) {
    if (!map) return;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    tileProviderIdx = index;
    tileErrorCount = 0;
    const provider = tileProviders[index];
    tileLayer = L.tileLayer(provider.url, { ...provider.options, crossOrigin: true });
    tileLayer.on('tileerror', () => {
      tileErrorCount += 1;
      if (tileErrorCount >= 3 && tileProviderIdx < tileProviders.length - 1) {
        mountTileProvider(tileProviderIdx + 1);
      }
    });
    tileLayer.addTo(map);
  }

  $: token = params.token || '';

  function setBanner(sos) {
    if (!sos?.active) { bannerText = 'Watch link connected.'; bannerSos = false; sosActive = false; return; }
    const count = typeof sos.ackCount === 'number' ? sos.ackCount : (sos.acks?.length || 0);
    const who = count ? `Acknowledged (${count})` : 'Not yet acknowledged';
    bannerText = `SOS: ${sos.reason || 'SOS'} - ${who}`;
    bannerSos = true;
    sosActive = true;
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (_) {}
  }

  let followMode = true;

  function update(u) {
    if (!u || typeof u.latitude !== 'number') return;
    const ll = [u.latitude, u.longitude];
    const popup = `<strong>${escapeAttr(u.displayName || 'User')}</strong><br>Lat: ${formatCoordinate(u.latitude)}<br>Lng: ${formatCoordinate(u.longitude)}<br>Speed: ${u.speed || '0'} km/h`;
    if (!marker) {
      marker = L.marker(ll, { icon: createMapIcon('var(--danger-500)', '', { pulse: true, markerType: 'sos' }) }).addTo(map).bindPopup(popup);
      map.setView(ll, 16);
    } else {
      animateMarkerTo('watch-target', marker, ll, 300);
      marker.setPopupContent(popup);
      // Adaptive recentering: only pan if marker leaves visible bounds
      if (followMode && !map.getBounds().contains(ll)) {
        map.panTo(ll, { animate: true, duration: 0.5 });
      }
    }
  }

  onMount(() => {
    map = L.map(mapContainer, { center: [0, 0], zoom: 2, zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mountTileProvider(0);

    if (!token) {
      bannerText = 'Invalid watch link.';
      bannerSos = true;
      return;
    }

    socket = io({ transports: ["websocket"], parser: msgpackParser, auth: { viewer: true } });
    socket.on('connect', () => { scheduleInitTimeout(); socket.emit('watchJoin', { token }); });
    socket.on('connect_error', () => { if (!hasInit) scheduleInitTimeout(); bannerText = 'Connection error. Retrying...'; bannerSos = true; });
    socket.on('disconnect', () => { if (!hasInit) scheduleInitTimeout(); bannerText = 'Disconnected. Reconnecting...'; bannerSos = true; });
    socket.on('watchInit', (payload) => { hasInit = true; clearInitTimeout(); bannerText = 'Connected.'; update(payload?.user); setBanner(payload?.sos); });
    socket.on('watchUpdate', (payload) => { update(payload?.user); setBanner(payload?.sos); });
  });

  onDestroy(() => {
    clearInitTimeout();
    if (socket) socket.disconnect();
    if (map) map.remove();
  });
</script>

<div class="watch-page" class:sos-active={sosActive}>
  <div class="watch-map" bind:this={mapContainer}></div>
  <div class="watch-banner" class:sos={bannerSos} role="status" aria-live="polite">
    {#if bannerSos}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    {/if}
    <span>{bannerText}</span>
  </div>
  <div class="bottom-controls">
    <button class="btn btn-sm" class:btn-primary={followMode} class:btn-secondary={!followMode} on:click={() => followMode = !followMode} aria-label={followMode ? 'Disable auto-follow' : 'Enable auto-follow'}>
      {followMode ? 'Following' : 'Follow'}
    </button>
    <a href="/#/login" class="btn btn-sm btn-secondary" aria-label="Open in Kinnect">Open in Kinnect</a>
  </div>
</div>

<style>
  .watch-page {
    position: relative;
    width: 100%;
    height: 100vh;
    height: 100dvh;
  }

  .watch-page.sos-active {
    outline: 3px solid var(--danger-500);
    outline-offset: -3px;
    animation: sos-border-pulse 2s ease-in-out infinite;
  }

  @keyframes sos-border-pulse {
    0%, 100% { outline-color: var(--danger-500); }
    50% { outline-color: transparent; }
  }

  .watch-map { position: absolute; inset: 0; z-index: 1; }

  .watch-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    padding: var(--space-3) var(--space-4);
    background: var(--primary-600);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    backdrop-filter: blur(8px);
  }

  .watch-banner.sos {
    background: var(--danger-500);
  }

  .bottom-controls {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    gap: var(--space-2);
    box-shadow: var(--shadow-lg);
  }
  .bottom-controls a {
    text-decoration: none;
  }

  @media (min-width: 768px) {
    .bottom-controls {
      left: auto;
      right: var(--space-4);
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .watch-page.sos-active {
      animation: none;
      outline-color: var(--danger-500);
    }
  }
</style>
