<script>
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { authUser } from '../lib/stores/auth.js';
  import { socket, setupSocketHandlers } from '../lib/socket.js';
  import { banner, mySosActive } from '../lib/stores/sos.js';
  import { pendingIncomingRequests } from '../lib/stores/guardians.js';
  import { otherUsers, mySocketId, myLocation, tracking, focusUser } from '../lib/stores/map.js';

  import AppLayout from '../components/layout/AppLayout.svelte';
  import Sidebar from '../components/layout/Sidebar.svelte';
  import Navbar from '../components/Navbar.svelte';
  import Banner from '../components/Banner.svelte';
  import MapView from '../components/Map.svelte';
  import UsersList from '../components/UsersList.svelte';
  import InfoPanel from '../components/InfoPanel.svelte';
  import AdminPanel from '../components/AdminPanel.svelte';
  import SharingPanel from '../components/SharingPanel.svelte';
  import SuperAdminPanel from '../components/SuperAdminPanel.svelte';
  import AlertOverlay from '../components/AlertOverlay.svelte';
  import BottomSheet from '../components/primitives/BottomSheet.svelte';
  import BottomTabBar from '../components/primitives/BottomTabBar.svelte';
  import { calculateDistance } from '../lib/tracking.js';
  import { GPSKalmanFilter } from '../lib/kalman.js';
  import { recordFix, resetMetrics } from '../lib/stores/metrics.js';
  import { bufferPosition, clearBuffer } from '../lib/offlineBuffer.js';

  let activePanel = null;
  let sidebarTab = 'info';
  let sidebarCollapsed = false;
  let sosConfirmOpen = false;
  let watchId = null;
  let fallbackWatchId = null;
  let isMobile = false;
  let mobileTab = 'map';
  let sheetOpen = false;
  let lastAcceptedFix = null;
  let lastEmittedFix = null;
  let lastEmitAt = 0;
  let lastCoarseNoticeAt = 0;
  let lastRawLat = null;
  let lastRawLng = null;
  let geoPermission = 'unknown';
  const gpsFilter = new GPSKalmanFilter({ Q: 3, R: 10 });

  $: if (!$authUser) push('/login');
  $: isAdmin = $authUser && $authUser.role === 'admin';
  $: rightPanelOpen = activePanel === 'users' || activePanel === 'superAdmin';
  $: sidebarOpen = !sidebarCollapsed;
  $: hasNotification = $pendingIncomingRequests.length > 0;

  // When flying to a user on the map, auto-close panels/sheets so the map is visible
  $: if ($focusUser) {
    if (isMobile) {
      sheetOpen = false;
      mobileTab = 'map';
    }
    if (activePanel === 'users') {
      activePanel = null;
    }
  }

  function setPanel(panel) {
    activePanel = activePanel === panel ? null : panel;
  }

  function onNavbarToggle(e) {
    const panel = e.detail;
    if (['info', 'sharing', 'admin'].includes(panel)) {
      if (sidebarTab === panel && !sidebarCollapsed) {
        sidebarCollapsed = true;
      } else {
        sidebarTab = panel;
        sidebarCollapsed = false;
      }
      activePanel = null;
    } else {
      if (activePanel === panel) activePanel = null;
      else activePanel = panel;
    }
  }

  function onSidebarTabChange(e) {
    sidebarTab = e.detail;
  }

  function onSidebarToggle(e) {
    sidebarCollapsed = e.detail;
  }

  function onMobileTabChange(e) {
    const tab = e.detail;
    mobileTab = tab;
    if (tab === 'map') {
      sheetOpen = false;
      activePanel = null;
    } else if (tab === 'more') {
      sheetOpen = true;
      sidebarTab = 'admin';
    } else {
      sheetOpen = true;
      sidebarTab = tab;
      if (tab === 'users') activePanel = 'users';
      else activePanel = null;
    }
  }

  function pushProfile() {
    let batteryPct = null;
    const dt = /Mobi|Android/i.test(navigator.userAgent || '') ? 'Mobile' : 'Desktop';
    let connectionQuality = 'Unknown';
    try {
      const ping = socket && socket.io && socket.io.engine ? socket.io.engine.ping : null;
      if (typeof ping === 'number') {
        connectionQuality = ping <= 80 ? 'Good' : ping <= 200 ? 'OK' : 'Poor';
      }
    } catch (_) {}
    try {
      if (navigator.getBattery) {
        navigator.getBattery().then(b => {
          batteryPct = Math.round((b.level || 0) * 100);
          socket.emit('profileUpdate', { batteryPct, deviceType: dt, connectionQuality });
        }).catch(() => socket.emit('profileUpdate', { batteryPct: null, deviceType: dt, connectionQuality }));
        return;
      }
    } catch (_) {}
    socket.emit('profileUpdate', { batteryPct: null, deviceType: dt, connectionQuality });
  }

  function startTracking() {
    if (!navigator.geolocation) {
      banner.set({ type: 'info', text: 'Geolocation is not supported on this device/browser.', actions: [] });
      return;
    }
    if (geoPermission === 'denied') {
      banner.set({ type: 'info', text: 'Location permission is denied. Enable it in your browser settings, then try again.', actions: [] });
      return;
    }
    if (watchId != null) return;
    tracking.set(true);
    banner.set({ type: 'info', text: 'Starting high-accuracy tracking...', actions: [] });
    lastAcceptedFix = null;
    lastEmittedFix = null;
    lastEmitAt = 0;
    lastCoarseNoticeAt = 0;

    function applyFix(pos, forceEmit) {
      const { latitude: rawLat, longitude: rawLng, accuracy, speed: rawSpeed } = pos.coords;
      const now = Date.now();
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;
      if (!Number.isFinite(accuracy)) return;
      // After we have a fix, reject very coarse updates (>20 km).
      // But ALWAYS accept the first fix regardless of accuracy — a rough
      // position is far better than no position at all.
      if (lastAcceptedFix && accuracy > 20000) return;

      // Deduplication: skip if raw coords are identical to last accepted
      if (rawLat === lastRawLat && rawLng === lastRawLng && !forceEmit) return;
      lastRawLat = rawLat;
      lastRawLng = rawLng;

      // After first lock, ignore very coarse fixes for a short window
      if (lastAcceptedFix && accuracy > 1200 && now - lastAcceptedFix.ts < 1500) return;

      if (lastAcceptedFix) {
        const jumpDistance = calculateDistance(lastAcceptedFix.latitude, lastAcceptedFix.longitude, rawLat, rawLng);
        const dtSec = Math.max((now - lastAcceptedFix.ts) / 1000, 1);
        const impliedKmh = (jumpDistance / dtSec) * 3.6;
        if (impliedKmh > 500 && accuracy > 80) return;
      }

      const speed = rawSpeed != null && Number.isFinite(rawSpeed) ? Number((Math.max(0, rawSpeed) * 3.6).toFixed(1)) : 0;

      // Kalman filter: auto-tune process noise based on speed, then smooth.
      gpsFilter.setSpeed(speed);
      const filtered = gpsFilter.filter(rawLat, rawLng, accuracy);
      const latitude = filtered.lat;
      const longitude = filtered.lng;

      const formattedTime = new Date().toLocaleTimeString();
      lastAcceptedFix = { latitude, longitude, ts: now };
      myLocation.set({ latitude, longitude, speed, formattedTime, accuracy });
      recordFix({ accuracy, kalmanCorrectionM: filtered.correctionM, filterWarm: gpsFilter.isWarm });
      if (accuracy > 150 && now - lastCoarseNoticeAt > 7000) {
        lastCoarseNoticeAt = now;
        banner.set({ type: 'info', text: `Location updated (low precision: ~${Math.round(accuracy)}m). Move near open sky for GPS-level accuracy.`, actions: [] });
      } else if (accuracy <= 150) {
        banner.set({ type: null, text: null, actions: [] });
      }

      const timeSinceLastEmit = now - lastEmitAt;
      const distanceSinceLastEmit = lastEmittedFix
        ? calculateDistance(lastEmittedFix.latitude, lastEmittedFix.longitude, latitude, longitude)
        : Infinity;
      const moving = speed > 4;
      const shouldEmit = forceEmit ||
        !lastEmittedFix ||
        distanceSinceLastEmit >= 2 ||
        (moving && timeSinceLastEmit >= 450) ||
        timeSinceLastEmit >= 900;

      if (shouldEmit) {
        lastEmittedFix = { latitude, longitude };
        lastEmitAt = now;
        const payload = { latitude, longitude, speed, formattedTime, accuracy, timestamp: now };
        if (socket.connected) {
          socket.emit('position', payload);
        } else {
          bufferPosition(payload);
        }
      }
    }

    function startFallbackWatch() {
      if (fallbackWatchId != null) return;
      fallbackWatchId = navigator.geolocation.watchPosition(
        (pos) => applyFix(pos, !lastAcceptedFix),
        () => {},
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
      );
    }

    // Immediate best-effort acquisition so the UI updates quickly on click.
    // High-accuracy attempt
    navigator.geolocation.getCurrentPosition(
      (pos) => applyFix(pos, true),
      () => {
        // High-accuracy failed — try network/cached immediately
        navigator.geolocation.getCurrentPosition(
          (pos) => applyFix(pos, true),
          () => {},
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
    );
    // Parallel low-accuracy attempt (also force-emit if we have no fix yet)
    navigator.geolocation.getCurrentPosition(
      (pos) => applyFix(pos, !lastAcceptedFix),
      () => {},
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
    startFallbackWatch();

    watchId = navigator.geolocation.watchPosition(
      (pos) => applyFix(pos, false),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          banner.set({ type: 'info', text: 'Location access denied. Enable permissions in browser settings.', actions: [] });
          stopTracking();
          return;
        }
        if (err.code === err.TIMEOUT) {
          if (!lastAcceptedFix) {
            banner.set({ type: 'info', text: 'Waiting for GPS... fallback tracking is active.', actions: [] });
          }
          startFallbackWatch();
          return;
        }
        banner.set({ type: 'info', text: 'Unable to get location right now. Move to open sky and retry.', actions: [] });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );
  }

  function stopTracking() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    if (fallbackWatchId != null) navigator.geolocation.clearWatch(fallbackWatchId);
    watchId = null;
    fallbackWatchId = null;
    tracking.set(false);
    lastAcceptedFix = null;
    lastEmittedFix = null;
    lastEmitAt = 0;
    lastCoarseNoticeAt = 0;
    lastRawLat = null;
    lastRawLng = null;
    gpsFilter.reset();
    resetMetrics();
    clearBuffer();
  }

  function checkMobile() {
    isMobile = window.innerWidth < 768;
  }

  onMount(() => {
    if (!$authUser) { push('/login'); return; }
    setupSocketHandlers();
    pushProfile();
    const profileInterval = setInterval(pushProfile, 30000);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Proactive permission check
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        geoPermission = result.state;
        result.addEventListener('change', () => { geoPermission = result.state; });
      }).catch(() => {});
    }

    // Warm up GPS
    navigator.geolocation?.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );

    return () => {
      clearInterval(profileInterval);
      stopTracking();
      window.removeEventListener('resize', checkMobile);
    };
  });
</script>

<AppLayout {sidebarOpen} {rightPanelOpen}>
  <svelte:fragment slot="navbar">
    <Navbar
      {isAdmin}
      activePanel={activePanel || sidebarTab}
      on:togglePanel={onNavbarToggle}
      on:toggleTracking={() => $tracking ? stopTracking() : startTracking()}
      isTracking={$tracking}
    />
  </svelte:fragment>

  <svelte:fragment slot="sidebar">
    <Sidebar
      activeTab={sidebarTab}
      {isAdmin}
      collapsed={sidebarCollapsed}
      on:tabChange={onSidebarTabChange}
      on:toggle={onSidebarToggle}
    >
      {#if sidebarTab === 'info'}
        <InfoPanel embedded={true} />
      {:else if sidebarTab === 'sharing'}
        <SharingPanel embedded={true} />
      {:else if sidebarTab === 'admin'}
        <AdminPanel embedded={true} />
      {/if}
    </Sidebar>
  </svelte:fragment>

  <svelte:fragment slot="map">
    <MapView />
  </svelte:fragment>

  <svelte:fragment slot="banner">
    <Banner />
  </svelte:fragment>

  <svelte:fragment slot="rightPanel">
    {#if activePanel === 'users'}
      <UsersList on:close={() => activePanel = null} />
    {:else if activePanel === 'superAdmin' && isAdmin}
      <SuperAdminPanel on:close={() => activePanel = null} />
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="bottomSheet">
    <BottomSheet open={sheetOpen} title={sidebarTab === 'users' ? 'Users' : sidebarTab === 'info' ? 'Info' : sidebarTab === 'sharing' ? 'Sharing' : sidebarTab === 'admin' ? 'Admin' : ''} on:close={() => { sheetOpen = false; mobileTab = 'map'; }}>
      {#if sidebarTab === 'info'}
        <InfoPanel embedded={true} />
      {:else if sidebarTab === 'sharing'}
        <SharingPanel embedded={true} />
      {:else if sidebarTab === 'admin'}
        <AdminPanel embedded={true} />
      {:else if sidebarTab === 'users'}
        <UsersList embedded={true} />
      {/if}
    </BottomSheet>
  </svelte:fragment>

  <svelte:fragment slot="bottomTabs">
    <BottomTabBar
      activeTab={mobileTab}
      {isAdmin}
      isTracking={$tracking}
      {hasNotification}
      on:tabChange={onMobileTabChange}
    />
  </svelte:fragment>

  <svelte:fragment slot="overlay">
    <AlertOverlay />

    <!-- SOS FAB — always visible on map -->
    <button
      class="sos-fab"
      class:active={$mySosActive}
      on:click={() => {
        if ($mySosActive) { socket.emit('cancelSOS'); }
        else { sosConfirmOpen = true; }
      }}
      aria-label={$mySosActive ? 'Cancel SOS' : 'Send SOS'}
    >
      {#if $mySosActive}
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      {:else}
        <span class="sos-text">SOS</span>
      {/if}
    </button>

    <!-- SOS Confirmation Modal -->
    {#if sosConfirmOpen}
      <div class="sos-confirm-backdrop" on:click|self={() => sosConfirmOpen = false} on:keydown={(e) => { if (e.key === 'Escape') sosConfirmOpen = false; }} role="dialog" aria-modal="true" aria-label="Confirm SOS">
        <div class="sos-confirm-card">
          <div class="sos-confirm-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 class="sos-confirm-title">Send SOS Alert?</h3>
          <p class="sos-confirm-desc">This will immediately alert all your contacts that you need help. Your location will be shared with them.</p>
          <div class="sos-confirm-actions">
            <button class="btn btn-ghost sos-cancel-btn" on:click={() => sosConfirmOpen = false}>Cancel</button>
            <button class="btn btn-danger sos-send-btn" on:click={() => { socket.emit('triggerSOS', { reason: 'SOS' }); sosConfirmOpen = false; }}>Send SOS</button>
          </div>
        </div>
      </div>
    {/if}

    {#if isMobile}
      <button class="mobile-track-fab" class:tracking={$tracking} on:click={() => $tracking ? stopTracking() : startTracking()} aria-label={$tracking ? 'Stop tracking' : 'Start tracking'}>
        {#if $tracking}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
        {/if}
      </button>
    {/if}
  </svelte:fragment>
</AppLayout>

<style>
  /* ── SOS FAB ──────────────────────────────────────────────────────────── */
  .sos-fab {
    position: fixed;
    bottom: var(--space-4);
    left: var(--space-4);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #dc2626;
    color: white;
    border: 3px solid rgba(255,255,255,0.9);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 12px rgba(220, 38, 38, 0.45), 0 0 0 0 rgba(220, 38, 38, 0);
    z-index: calc(var(--z-panel, 100) + 2);
    transition: transform 0.15s ease, box-shadow 0.3s ease, background 0.2s ease;
  }
  .sos-fab:hover {
    transform: scale(1.06);
    box-shadow: 0 4px 20px rgba(220, 38, 38, 0.55), 0 0 0 4px rgba(220, 38, 38, 0.15);
  }
  .sos-fab:active {
    transform: scale(0.94);
  }
  .sos-fab .sos-text {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 1px;
    line-height: 1;
  }
  .sos-fab.active {
    background: #991b1b;
    animation: sos-ring 1.2s ease infinite;
  }
  @keyframes sos-ring {
    0% { box-shadow: 0 2px 12px rgba(220, 38, 38, 0.45), 0 0 0 0 rgba(239, 68, 68, 0.5); }
    70% { box-shadow: 0 2px 12px rgba(220, 38, 38, 0.45), 0 0 0 14px rgba(239, 68, 68, 0); }
    100% { box-shadow: 0 2px 12px rgba(220, 38, 38, 0.45), 0 0 0 0 rgba(239, 68, 68, 0); }
  }

  @media (max-width: 767px) {
    .sos-fab {
      bottom: calc(var(--bottom-tab-height, 56px) + var(--safe-bottom, 0px) + var(--space-4));
    }
  }

  /* ── SOS Confirmation Modal ───────────────────────────────────────────── */
  .sos-confirm-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: calc(var(--z-panel, 100) + 10);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    animation: fade-in 0.15s ease;
  }
  .sos-confirm-card {
    background: var(--surface-primary, white);
    border-radius: 16px;
    padding: 28px 24px 20px;
    max-width: 340px;
    width: 100%;
    text-align: center;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
    animation: scale-in 0.2s ease;
  }
  .sos-confirm-icon {
    margin-bottom: 12px;
  }
  .sos-confirm-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary, #111);
    margin: 0 0 8px;
  }
  .sos-confirm-desc {
    font-size: 13px;
    color: var(--text-secondary, #666);
    line-height: 1.5;
    margin: 0 0 20px;
  }
  .sos-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .sos-cancel-btn {
    flex: 1;
    padding: 10px 16px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    background: var(--surface-secondary, #f3f4f6);
    color: var(--text-primary, #333);
    border: none;
    cursor: pointer;
  }
  .sos-cancel-btn:hover { background: var(--surface-tertiary, #e5e7eb); }
  .sos-send-btn {
    flex: 1;
    padding: 10px 16px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 14px;
    background: #dc2626;
    color: white;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.35);
  }
  .sos-send-btn:hover { background: #b91c1c; }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes scale-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }

  /* ── Track FAB ────────────────────────────────────────────────────────── */
  .mobile-track-fab {
    display: none;
  }

  @media (max-width: 767px) {
    .mobile-track-fab {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      bottom: calc(var(--bottom-tab-height) + var(--safe-bottom) + var(--space-4));
      right: var(--space-4);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--primary-600);
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: var(--shadow-lg), var(--shadow-primary);
      z-index: calc(var(--z-panel) + 1);
      transition:
        transform var(--duration-fast) var(--ease-out),
        background-color var(--duration-normal) var(--ease-out);
    }

    .mobile-track-fab:active {
      transform: scale(0.92);
    }

    .mobile-track-fab.tracking {
      background: var(--danger-500);
      box-shadow: var(--shadow-lg), var(--shadow-danger);
    }
  }
</style>
