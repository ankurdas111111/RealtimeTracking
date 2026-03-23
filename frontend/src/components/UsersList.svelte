<script>
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { otherUsers, myLocation, focusUser } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';
  import { socket } from '../lib/socket.js';
  import { banner } from '../lib/stores/sos.js';
  import { formatTimestamp, escHtml, calculateDistance, formatDistance } from '../lib/tracking.js';
  import { haptics } from '../lib/haptics.js';
  import VirtualList from './primitives/VirtualList.svelte';

  function locateUser(socketId) {
    haptics.tap();
    focusUser.set(socketId);
  }

  export let embedded = false;

  const dispatch = createEventDispatcher();

  $: isAdmin = $authUser && $authUser.role === 'admin';

  // Sort: SOS first, then online, then by proximity, then offline
  $: userList = Array.from($otherUsers.values())
    .filter(u => u.latitude != null && u.longitude != null)
    .sort((a, b) => {
      if (a.sos?.active && !b.sos?.active) return -1;
      if (!a.sos?.active && b.sos?.active) return 1;
      if (a.online !== false && b.online === false) return -1;
      if (a.online === false && b.online !== false) return 1;
      // Sort online users by distance if we know our location
      if ($myLocation && a.online !== false && b.online !== false) {
        const da = calculateDistance($myLocation.latitude, $myLocation.longitude, a.latitude, a.longitude);
        const db = calculateDistance($myLocation.latitude, $myLocation.longitude, b.latitude, b.longitude);
        return da - db;
      }
      return 0;
    });

  function onlineStatus(user) {
    if (user.online === false) {
      if (!user.offlineExpiresAt) return 'Offline · kept forever';
      const ms = user.offlineExpiresAt - Date.now();
      if (ms <= 0) return 'Offline · expiring soon';
      const mins = Math.floor(ms / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h <= 0 ? `Offline · ${m}m left` : `Offline · ${h}h ${m}m left`;
    }
    return 'Online';
  }

  function deleteUser(user) {
    if (!isAdmin) return;
    if (!confirm(`Delete user "${user.displayName}"? This will disconnect them.`)) return;
    socket.emit('adminDeleteUser', { socketId: user.socketId });
    banner.set({ type: 'info', text: `Deleted ${user.displayName}`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 1500);
  }

  // Swipe-right to locate on map
  let swipeStartX = 0;
  let swipeStartY = 0;

  function onTouchStart(e) {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }

  function onTouchEnd(e, socketId) {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
    if (dx > 60 && dy < 30) {
      // Swipe right → locate on map
      locateUser(socketId);
    }
  }

  function onUserRowKeydown(event, socketId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      locateUser(socketId);
    }
  }

  function getAccuracyLabel(acc) {
    if (acc == null) return null;
    if (acc <= 15) return 'High';
    if (acc <= 50) return 'Good';
    return 'Low';
  }

  function getAccuracyClass(acc) {
    if (acc == null) return '';
    if (acc <= 15) return 'acc-high';
    if (acc <= 50) return 'acc-good';
    return 'acc-low';
  }
</script>

<div class="panel-shell panel-right panel-base" class:embedded-view={embedded} transition:fly={{ x: 400, duration: 250, easing: cubicOut }}>
  {#if !embedded}
    <div class="panel-header">
      <h3>People</h3>
      <button class="btn btn-icon btn-ghost panel-close-btn" aria-label="Close people panel" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  {/if}

  <div class="panel-body panel-list-body users-list-body">
    <!-- Self entry -->
    {#if $myLocation}
      <button
        class="user-item user-item-btn me"
        on:click={() => locateUser('__self__')}
        aria-label="Locate yourself on map"
      >
        <div class="user-avatar self-avatar">
          {($authUser?.displayName || 'Y')[0].toUpperCase()}
        </div>
        <div class="user-meta">
          <div class="user-name-row">
            <strong>{$authUser?.displayName || 'You'}</strong>
            <span class="you-badge">You</span>
          </div>
          <div class="user-sub">
            <span class="status-dot online"></span>
            <span>Live</span>
            {#if $myLocation.speed != null && $myLocation.speed > 0}
              <span class="sep">·</span>
              <span>{parseFloat($myLocation.speed).toFixed(0)} km/h</span>
            {/if}
          </div>
        </div>
        <span class="locate-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
        </span>
      </button>
    {/if}

    <!-- Other users -->
    {#if userList.length === 0}
      <div class="empty-state-container">
        <div class="empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <p class="empty-title">No one nearby yet</p>
        <p class="empty-desc">Share your room code with family to see them here</p>
      </div>
    {:else}
      <div class="vlist-region">
        <VirtualList items={userList} itemHeight={72} let:item={user}>
          <div
            class="user-item user-item-btn"
            class:user-sos={user.sos?.active}
            class:user-offline={user.online === false}
            role="button"
            tabindex="0"
            on:click={() => locateUser(user.socketId)}
            on:keydown={(e) => onUserRowKeydown(e, user.socketId)}
            on:touchstart={onTouchStart}
            on:touchend={(e) => onTouchEnd(e, user.socketId)}
          >
            <div class="user-avatar" style="background: var(--avatar-bg, var(--primary-100)); color: var(--avatar-color, var(--primary-700))">
              {(user.displayName || 'U')[0].toUpperCase()}
              {#if user.online !== false}
                <span class="avatar-online-dot" class:sos-dot={user.sos?.active}></span>
              {/if}
            </div>
            <div class="user-meta">
              <div class="user-name-row">
                <strong class="user-name">{user.displayName || 'User'}</strong>
                {#if user.sos?.active}
                  <span class="badge badge-danger sos-badge">SOS</span>
                {/if}
              </div>
              <div class="user-sub">
                {#if user.online !== false}
                  {#if $myLocation && user.latitude != null && user.longitude != null}
                    <span>{formatDistance(calculateDistance($myLocation.latitude, $myLocation.longitude, user.latitude, user.longitude)) || 'Near'}</span>
                  {/if}
                  {#if user.speed != null && parseFloat(user.speed) > 0.5}
                    <span class="sep">·</span>
                    <span>{parseFloat(user.speed).toFixed(0)} km/h</span>
                  {/if}
                  {#if user.accuracy != null}
                    <span class="sep">·</span>
                    <span class="acc-label {getAccuracyClass(user.accuracy)}">{getAccuracyLabel(user.accuracy)} GPS</span>
                  {/if}
                {:else}
                  <span class="offline-label">{onlineStatus(user)}</span>
                {/if}
              </div>
              {#if user.formattedTime || user.lastUpdate}
                <div class="user-updated">
                  Updated {user.formattedTime || formatTimestamp(user.lastUpdate)}
                </div>
              {/if}
            </div>
            <div class="user-actions">
              {#if user.batteryPct != null}
                <span class="bat-chip" class:bat-low={user.batteryPct <= 20} class:bat-ok={user.batteryPct > 20 && user.batteryPct <= 50} class:bat-good={user.batteryPct > 50}>
                  {user.batteryPct}%
                </span>
              {/if}
              <span class="locate-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
              </span>
              {#if isAdmin}
                <button class="btn btn-danger btn-sm" on:click|stopPropagation={() => deleteUser(user)}>Delete</button>
              {/if}
            </div>
          </div>
        </VirtualList>
      </div>
    {/if}
  </div>
</div>

<style>
  /* ── VirtualList layout ────────────────────────────────────────────────── */
  /* Override panel-body scrolling: let VirtualList own the scroll container */
  .users-list-body {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }

  .vlist-region {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* ── User item ─────────────────────────────────────────────────────────── */
  .user-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .user-item-btn {
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    transition: background var(--duration-fast) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .user-item-btn:hover { background: var(--surface-hover); }
  .user-item-btn:active {
    background: var(--surface-active);
    transform: scale(0.99);
  }

  /* SOS highlight */
  .user-sos {
    background: rgba(239, 68, 68, 0.05);
    border-left: 3px solid var(--danger-500);
  }
  .user-sos:hover { background: rgba(239, 68, 68, 0.08); }

  /* Offline dimming */
  .user-offline { opacity: 0.55; }

  /* Self highlight */
  .me { background: rgba(59, 130, 246, 0.04); }

  /* ── Avatar ────────────────────────────────────────────────────────────── */
  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--primary-100);
    color: var(--primary-700);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: var(--text-base);
    flex-shrink: 0;
    text-transform: uppercase;
    line-height: 1;
    position: relative;
  }

  .self-avatar {
    background: linear-gradient(135deg, var(--primary-500), var(--primary-700));
    color: white;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
  }

  .avatar-online-dot {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--success-500);
    border: 2px solid var(--surface-2);
  }
  .avatar-online-dot.sos-dot {
    background: var(--danger-500);
    animation: sos-urgent-pulse 1s ease infinite;
  }

  /* ── Meta ──────────────────────────────────────────────────────────────── */
  .user-meta {
    flex: 1;
    min-width: 0;
  }

  .user-name-row {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    margin-bottom: 2px;
  }

  .user-name {
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
  }

  .you-badge {
    font-size: var(--text-2xs);
    font-weight: 700;
    color: var(--primary-600);
    background: var(--primary-50);
    border: 1px solid var(--primary-200);
    border-radius: var(--radius-full);
    padding: 1px 6px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  :global([data-theme="dark"]) .you-badge {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.25);
    color: var(--primary-300);
  }

  .sos-badge { font-size: var(--text-2xs); flex-shrink: 0; }

  .user-sub {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    flex-wrap: wrap;
  }

  .sep { color: var(--text-tertiary); }

  .user-updated {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    margin-top: 1px;
  }

  .offline-label { color: var(--text-tertiary); }

  /* Accuracy labels */
  .acc-label { font-weight: 500; }
  .acc-high  { color: var(--success-500); }
  .acc-good  { color: var(--warning-500); }
  .acc-low   { color: var(--danger-400); }

  /* ── Actions ───────────────────────────────────────────────────────────── */
  .user-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    flex-shrink: 0;
  }

  .locate-icon {
    color: var(--text-tertiary);
    transition: color var(--duration-fast) var(--ease-out);
    display: flex;
    align-items: center;
  }
  .user-item-btn:hover .locate-icon { color: var(--primary-500); }

  .bat-chip {
    font-size: var(--text-2xs);
    font-weight: 600;
    padding: 2px 5px;
    border-radius: var(--radius-full);
    background: var(--surface-inset);
    color: var(--text-tertiary);
  }
  .bat-low  { color: var(--danger-500); background: rgba(239, 68, 68, 0.10); }
  .bat-ok   { color: var(--warning-600); background: rgba(245, 158, 11, 0.10); }
  .bat-good { color: var(--success-600); background: rgba(16, 185, 129, 0.10); }

  /* ── Empty state ───────────────────────────────────────────────────────── */
  .empty-state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-6);
    text-align: center;
    gap: var(--space-2);
  }

  .empty-icon {
    margin-bottom: var(--space-2);
    color: var(--text-tertiary);
  }

  .empty-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }

  .empty-desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    max-width: 220px;
    line-height: var(--leading-relaxed);
    margin: 0;
  }

  /* ── Embedded panel ────────────────────────────────────────────────────── */
  .embedded-view {
    position: static;
    top: auto;
    right: auto;
    bottom: auto;
    left: auto;
    width: 100%;
    max-width: none;
    border: none;
    box-shadow: none;
    animation: none;
  }
  .embedded-view .panel-body {
    padding-top: 0;
  }
</style>
