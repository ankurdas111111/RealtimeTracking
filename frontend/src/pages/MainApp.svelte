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
  import MapFab from '../components/primitives/MapFab.svelte';
  import OnboardingOverlay from '../components/OnboardingOverlay.svelte';
  import { calculateDistance } from '../lib/tracking.js';
  import { GPSKalmanFilter } from '../lib/kalman.js';
  import { recordFix, resetMetrics } from '../lib/stores/metrics.js';
  import { bufferPosition, clearBuffer } from '../lib/offlineBuffer.js';
  import { startGeo, stopGeo, warmUp, checkPermission, isNativePlatform } from '../lib/geoProvider.js';

  let activePanel = null;
  let sidebarTab = 'info';
  let sidebarCollapsed = false;
  let sosConfirmOpen = false;
  let isMobile = false;
  let mobileTab = 'map';
  let sheetOpen = false;
  let followMode = false;
  let showOnboarding = false;
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

  // Wire SOS state to global CSS app-state for full-app red tint
  $: {
    if (typeof document !== 'undefined') {
      if ($mySosActive) {
        document.documentElement.dataset.appState = 'sos';
      } else {
        delete document.documentElement.dataset.appState;
      }
    }
  }

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
    } else if (tab === 'people') {
      sheetOpen = true;
      sidebarTab = 'users';
      activePanel = null;
    } else if (tab === 'safety') {
      sheetOpen = true;
      sidebarTab = 'admin';
      activePanel = null;
    } else if (tab === 'sharing') {
      sheetOpen = true;
      sidebarTab = 'sharing';
      activePanel = null;
    } else if (tab === 'more') {
      sheetOpen = true;
      sidebarTab = 'info';
      activePanel = null;
    } else {
      sheetOpen = true;
      sidebarTab = tab;
      activePanel = null;
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

  function applyFix(pos, forceEmit) {
    const { latitude: rawLat, longitude: rawLng, accuracy, speed: rawSpeed } = pos;
    const now = Date.now();
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;
    // Fix D: reject zero/negative accuracy (some Android GPS drivers report 0 on cold start)
    if (!Number.isFinite(accuracy) || accuracy <= 0) return;
    if (lastAcceptedFix && accuracy > 20000) return;

    if (rawLat === lastRawLat && rawLng === lastRawLng && !forceEmit) return;
    lastRawLat = rawLat;
    lastRawLng = rawLng;

    // Fix B: reject coarse positions aggressively to prevent cell-tower fixes corrupting Kalman.
    // But emit a stale-position heartbeat every 30s so contacts know the last seen location.
    if (lastAcceptedFix && accuracy > 500) {
      if (lastEmittedFix && now - lastEmitAt >= 30000) {
        lastEmitAt = now;
        const stalePayload = { latitude: lastEmittedFix.latitude, longitude: lastEmittedFix.longitude, speed: 0, formattedTime: new Date().toLocaleTimeString(), accuracy, timestamp: now };
        if (socket.connected) socket.emit('position', stalePayload);
        else bufferPosition(stalePayload);
      }
      return;
    }
    if (lastAcceptedFix && accuracy > 200 && now - lastAcceptedFix.ts < 5000) return;

    if (lastAcceptedFix) {
      const jumpDistance = calculateDistance(lastAcceptedFix.latitude, lastAcceptedFix.longitude, rawLat, rawLng);
      const dtSec = Math.max((now - lastAcceptedFix.ts) / 1000, 1);
      const impliedKmh = (jumpDistance / dtSec) * 3.6;
      // Fix A: scale jump rejection with accuracy — poor-accuracy fixes are rejected at lower implied speeds
      if (impliedKmh > 150 && accuracy > 30) return;
      if (impliedKmh > 350) return; // absolute cap (faster than any ground vehicle)
    }

    const speed = rawSpeed != null && Number.isFinite(rawSpeed) ? Number((Math.max(0, rawSpeed) * 3.6).toFixed(1)) : 0;

    gpsFilter.setSpeed(speed);
    let latitude, longitude, kalmanCorrectionM;
    if (!gpsFilter.isWarm && accuracy > 100) {
      // First fix is too coarse to seed the Kalman state — use raw coords for local display
      // but defer filter initialization until a sub-100m fix arrives.
      latitude = rawLat;
      longitude = rawLng;
      kalmanCorrectionM = 0;
    } else {
      const filtered = gpsFilter.filter(rawLat, rawLng, accuracy);
      latitude = filtered.lat;
      longitude = filtered.lng;
      kalmanCorrectionM = filtered.correctionM;
    }

    const formattedTime = new Date().toLocaleTimeString();
    lastAcceptedFix = { latitude, longitude, ts: now };
    myLocation.set({ latitude, longitude, speed, formattedTime, accuracy });
    recordFix({ accuracy, kalmanCorrectionM, filterWarm: gpsFilter.isWarm });
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
    const moving = speed > 1;
    const shouldEmit = forceEmit ||
      !lastEmittedFix ||
      distanceSinceLastEmit >= 2 ||
      (moving && timeSinceLastEmit >= 250) ||
      timeSinceLastEmit >= 5000;

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

  function startTracking() {
    if (geoPermission === 'denied') {
      banner.set({ type: 'info', text: 'Location permission is denied. Enable it in your settings, then try again.', actions: [] });
      return;
    }
    if ($tracking) return;
    tracking.set(true);
    banner.set({ type: 'info', text: 'Starting high-accuracy tracking...', actions: [] });
    lastAcceptedFix = null;
    lastEmittedFix = null;
    lastEmitAt = 0;
    lastCoarseNoticeAt = 0;

    startGeo(
      (pos, forceEmit) => applyFix(pos, forceEmit || !lastAcceptedFix),
      (err) => {
        if (err.code === 1) {
          banner.set({ type: 'info', text: 'Location access denied. Enable permissions in your settings.', actions: [] });
          stopTracking();
          return;
        }
        if (!lastAcceptedFix) {
          banner.set({ type: 'info', text: 'Waiting for GPS... fallback tracking is active.', actions: [] });
        }
      }
    );
  }

  function stopTracking() {
    stopGeo();
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

  // Pre-warm AudioContext on first user gesture (required for Safari)
  function prewarmAudio() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().then(() => ctx.close()).catch(() => {});
    } catch (_) {}
    document.removeEventListener('pointerdown', prewarmAudio);
  }

  onMount(async () => {
    if (!$authUser) { push('/login'); return; }
    setupSocketHandlers();
    pushProfile();
    const profileInterval = setInterval(pushProfile, 30000);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Pre-warm AudioContext on first touch/click (Safari requires user gesture)
    document.addEventListener('pointerdown', prewarmAudio, { once: true, passive: true });

    // Show onboarding for first-time users (no share code seen before)
    const onboardingKey = 'kinnect_onboarded_' + ($authUser?.userId || '');
    if (!localStorage.getItem(onboardingKey)) {
      setTimeout(() => { showOnboarding = true; }, 800);
    }

    // Fix C: await permission before tracking can start, so the denied-permission guard is reliable
    geoPermission = await checkPermission();

    // Warm up GPS hardware
    warmUp();

    // Fix H: guard against component unmounting before the dynamic import resolves
    let mounted = true;
    let appListenerCleanup = null;
    if (isNativePlatform()) {
      import('@capacitor/app').then(({ App }) => {
        if (!mounted) return; // component already destroyed — skip adding listeners
        const listeners = [];
        listeners.push(App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            // Resumed from background — reconnect socket and warm up GPS
            if (!socket.connected) socket.connect();
            if ($tracking) warmUp();
          }
        }));
        listeners.push(App.addListener('backButton', ({ canGoBack }) => {
          if (sheetOpen) { sheetOpen = false; return; }
          if (activePanel) { activePanel = null; return; }
          if (canGoBack) { window.history.back(); }
        }));
        appListenerCleanup = () => {
          Promise.all(listeners).then(handles => handles.forEach(h => { if (h && h.remove) h.remove(); }));
        };
      }).catch(() => {});
    }

    return () => {
      mounted = false;
      clearInterval(profileInterval);
      stopTracking();
      window.removeEventListener('resize', checkMobile);
      document.removeEventListener('pointerdown', prewarmAudio);
      if (appListenerCleanup) appListenerCleanup();
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
    <MapView {followMode} />
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

    <!-- SOS FAB — always visible bottom-left -->
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

    <!-- FAB cluster — bottom-right: track + center + follow -->
    <div class="fab-wrapper" class:fab-wrapper--mobile={isMobile}>
      <MapFab
        isTracking={$tracking}
        {followMode}
        on:toggleTracking={() => $tracking ? stopTracking() : startTracking()}
        on:centerOnMe={() => focusUser.set('__self__')}
        on:toggleFollow={() => followMode = !followMode}
      />
    </div>

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

    <!-- First-run onboarding -->
    <OnboardingOverlay
      visible={showOnboarding}
      on:requestPermission={startTracking}
      on:dismiss={() => {
        showOnboarding = false;
        const key = 'kinnect_onboarded_' + ($authUser?.userId || '');
        localStorage.setItem(key, '1');
      }}
    />
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

  /* ── MapFab wrapper ───────────────────────────────────────────────────── */
  .fab-wrapper {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-4);
    z-index: calc(var(--z-panel, 100) + 1);
  }

  .fab-wrapper--mobile {
    bottom: calc(var(--bottom-tab-height, 56px) + var(--safe-bottom, 0px) + var(--space-4));
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

</style>
