<script>
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { io } from 'socket.io-client';
  import * as msgpackParser from 'socket.io-msgpack-parser';
  import { createMapIcon, escapeAttr, escHtml } from '../lib/tracking.js';

  export let params = {};

  let mapContainer;
  let map;
  let marker = null;
  let hasZoomed = false;
  let socket = null;
  let viewerName = '';
  let showNameOverlay = true;
  let statusText = 'Connecting...';
  let online = false;
  let sharedBy = 'User';
  let sosActive = false;
  let sosInfo = '';
  let sosAcks = '';
  let sosAcked = false;
  let expired = false;
  let checkinText = '';
  let checkinOverdue = false;
  let sosAudioInterval = null;
  let audioCtx = null;
  let isMobile = false;
  let hasInit = false;
  let initTimeout = null;
  let connectionIssue = '';
  let tileLayer = null;
  let tileProviderIdx = 0;
  let tileErrorCount = 0;
  const tileProviders = [
    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } },
    { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } }
  ];

  $: token = params.token || '';

  function formatTimeAgo(ts) {
    if (!ts) return 'N/A';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  }

  function playTone(freq, duration) {
    ensureAudio();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = freq; gain.gain.value = 0.4;
      osc.start(); osc.stop(audioCtx.currentTime + duration / 1000);
    } catch (_) {}
  }

  function playSosSound() { playTone(880, 300); setTimeout(() => playTone(660, 300), 350); setTimeout(() => playTone(880, 300), 700); }

  function startViewing() {
    if (!viewerName.trim()) return;
    if (!token) {
      connectionIssue = 'Invalid live link.';
      statusText = connectionIssue;
      return;
    }
    showNameOverlay = false;
    statusText = 'Connecting...';
    connect();
  }

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
        online = false;
        connectionIssue = 'Unable to load live session. The link may be invalid, expired, or the user is unavailable.';
        statusText = connectionIssue;
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

  function connect() {
    socket = io({ transports: ["websocket"], parser: msgpackParser, auth: { viewer: true } });

    socket.on('liveInit', (data) => {
      hasInit = true;
      clearInitTimeout();
      connectionIssue = '';
      if (data.user) { updateMarker(data.user); online = true; statusText = 'Tracking ' + (sharedBy || 'User'); }
      else { online = false; statusText = (sharedBy || 'User') + ' (offline)'; }
      if (data.sos?.active) showSos(data.sos);
    });

    socket.on('liveUpdate', (data) => {
      if (data.user) { updateMarker(data.user); online = true; statusText = 'Tracking ' + sharedBy; }
    });

    socket.on('liveSosUpdate', (data) => { if (data.active) showSos(data); else hideSos(); });

    socket.on('liveCheckInUpdate', (data) => {
      if (!data?.enabled) { checkinText = ''; return; }
      const sinceMs = data.lastCheckInAt ? Date.now() - data.lastCheckInAt : Infinity;
      const overdueMs = (data.overdueMinutes || 7) * 60000;
      if (sinceMs > overdueMs) { checkinText = 'Check-in OVERDUE (' + formatTimeAgo(data.lastCheckInAt) + ')'; checkinOverdue = true; }
      else { checkinText = 'Last check-in: ' + formatTimeAgo(data.lastCheckInAt); checkinOverdue = false; }
    });

    socket.on('liveExpired', () => { expired = true; clearInitTimeout(); });
    socket.on('disconnect', () => {
      online = false;
      statusText = sharedBy + ' (reconnecting...)';
      if (!hasInit) scheduleInitTimeout();
    });
    socket.on('connect_error', () => {
      online = false;
      statusText = 'Connection error. Retrying...';
      if (!hasInit) scheduleInitTimeout();
    });
    socket.on('connect', () => {
      if (!hasInit) scheduleInitTimeout();
      if (viewerName) socket.emit('liveJoin', { token, viewerName });
    });
  }

  function updateMarker(user) {
    if (typeof user.latitude !== 'number') return;
    const ll = [user.latitude, user.longitude];
    const popupHtml = `<strong>${escHtml(user.displayName || 'User')}</strong><br>Speed: ${(user.speed || 0)} km/h<br>Updated: ${escHtml(user.formattedTime || 'N/A')}${user.batteryPct != null ? '<br>Battery: ' + user.batteryPct + '%' : ''}`;
    sharedBy = user.displayName || 'User';
    if (!marker) {
      const icon = createMapIcon('var(--primary-500)', sharedBy[0]?.toUpperCase() || 'U', { markerType: 'contact' });
      marker = L.marker(ll, { icon }).addTo(map).bindPopup(popupHtml);
    } else { marker.setLatLng(ll).setPopupContent(popupHtml); }
    if (!hasZoomed) { map.setView(ll, 15); hasZoomed = true; }
  }

  function showSos(sosData) {
    sosActive = true;
    sosInfo = (sosData.reason || 'SOS') + (sosData.at ? ' - ' + formatTimeAgo(sosData.at) : '');
    const count = sosData.ackCount || (sosData.acks?.length || 0);
    sosAcks = count > 0 ? `${count} acknowledged` : 'No acknowledgements yet';
    playSosSound();
    if (sosAudioInterval) clearInterval(sosAudioInterval);
    sosAudioInterval = setInterval(() => { if (!sosActive || sosAcked) { clearInterval(sosAudioInterval); return; } playSosSound(); }, 3000);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (_) {}
  }

  function hideSos() { sosActive = false; sosAcked = false; if (sosAudioInterval) clearInterval(sosAudioInterval); }

  function ackSos() {
    if (!socket || sosAcked) return;
    sosAcked = true;
    socket.emit('liveAckSOS', {});
    if (sosAudioInterval) clearInterval(sosAudioInterval);
  }

  function checkMobile() {
    isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  }

  onMount(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
    map = L.map(mapContainer, { center: [20, 78], zoom: 5, zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mountTileProvider(0);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', checkMobile);
    clearInitTimeout();
    if (socket) socket.disconnect();
    if (sosAudioInterval) clearInterval(sosAudioInterval);
    if (map) map.remove();
  });
</script>

<div class="live-page" class:sos-active={sosActive}>
  <div class="live-map" bind:this={mapContainer}></div>

  {#if expired}
    <div class="overlay">
      <div class="card expired-card">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--danger-500)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <h2>Link Expired</h2>
        <p class="text-sm text-muted">This live share link is no longer active.</p>
        <a href="/#/login" class="btn btn-primary" style="margin-top:var(--space-4);">Open Kinnect</a>
      </div>
    </div>
  {:else if showNameOverlay}
    <div class="overlay">
      <div class="card name-card">
        <div class="name-card-logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
        </div>
        <h2>Live Tracking</h2>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4);">Enter your name to start viewing</p>
        <input class="input input-lg" placeholder="Your name" bind:value={viewerName} on:keydown={e => e.key === 'Enter' && startViewing()} />
        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:var(--space-3);" on:click={startViewing}>Start Viewing</button>
      </div>
    </div>
  {/if}

  {#if !showNameOverlay && !expired && connectionIssue}
    <div class="live-error">
      <span>{connectionIssue}</span>
      <button class="btn btn-sm btn-secondary" on:click={() => window.location.reload()}>Retry</button>
    </div>
  {/if}

  {#if !showNameOverlay && !expired}
    <div class="status-bar">
      <span class="status-dot" class:online class:offline={!online}></span>
      <span class="status-label">{statusText}</span>
      {#if checkinText}<span class="checkin" class:overdue={checkinOverdue}>{checkinText}</span>{/if}
    </div>
  {/if}

  {#if sosActive}
    <div class="sos-banner" role="alert" aria-live="assertive">
      <div class="sos-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="sos-content">
        <div class="sos-text">{sosInfo}</div>
        <div class="sos-acks">{sosAcks}</div>
      </div>
      <button class="btn btn-sm" class:btn-secondary={sosAcked} class:btn-primary={!sosAcked} on:click={ackSos} disabled={sosAcked}>
        {sosAcked ? 'Acknowledged' : 'Acknowledge'}
      </button>
    </div>
  {/if}
</div>

<style>
  .live-page {
    position: relative;
    width: 100%;
    height: 100vh;
    height: 100dvh;
  }

  .live-page.sos-active {
    outline: 3px solid var(--danger-500);
    outline-offset: -3px;
    animation: sos-border-pulse 2s ease-in-out infinite;
  }

  @keyframes sos-border-pulse {
    0%, 100% { outline-color: var(--danger-500); }
    50% { outline-color: transparent; }
  }

  .live-map { position: absolute; inset: 0; z-index: 1; }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    padding: var(--space-4);
  }

  .name-card {
    max-width: 360px;
    width: 100%;
    text-align: center;
  }

  .name-card-logo {
    width: 48px;
    height: 48px;
    background: var(--primary-600);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin: 0 auto var(--space-4);
    box-shadow: var(--shadow-primary);
  }

  .expired-card {
    max-width: 360px;
    width: 100%;
    text-align: center;
    padding: var(--space-8);
  }

  .expired-card h2 {
    color: var(--danger-500);
    margin-top: var(--space-3);
  }

  .status-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-default);
    backdrop-filter: blur(16px);
    font-size: var(--text-sm);
    height: 40px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.online { background: var(--success-500); }
  .status-dot.offline { background: var(--gray-400); }

  .checkin {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .checkin.overdue {
    color: var(--danger-500);
    font-weight: 600;
  }

  .sos-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--danger-500);
    color: white;
    padding: var(--space-3) var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .live-error {
    position: absolute;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: min(90vw, 640px);
  }

  .sos-icon { flex-shrink: 0; }
  .sos-content { flex: 1; min-width: 0; }
  .sos-text { font-weight: 700; }
  .sos-acks { font-size: var(--text-xs); opacity: 0.8; }

  @media (max-width: 767px) {
    .status-bar {
      padding: var(--space-2) var(--space-3);
    }
    .sos-banner {
      padding: var(--space-3);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-page.sos-active {
      animation: none;
      outline-color: var(--danger-500);
    }
  }
</style>
