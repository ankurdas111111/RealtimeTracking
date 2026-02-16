<script>
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { otherUsers, myLocation, focusUser } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';
  import { socket } from '../lib/socket.js';
  import { banner } from '../lib/stores/sos.js';
  import { formatTimestamp, escHtml } from '../lib/tracking.js';

  function locateUser(socketId) {
    focusUser.set(socketId);
  }

  export let embedded = false;

  const dispatch = createEventDispatcher();

  $: isAdmin = $authUser && $authUser.role === 'admin';
  $: userList = Array.from($otherUsers.values()).filter(u => u.latitude != null && u.longitude != null);

  function onlineStatus(user) {
    if (user.online === false) {
      if (!user.offlineExpiresAt) return 'Offline - kept forever';
      const ms = user.offlineExpiresAt - Date.now();
      if (ms <= 0) return 'Offline - expiring soon';
      const mins = Math.floor(ms / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h <= 0 ? `Offline - expires in ${m}m` : `Offline - expires in ${h}h ${m}m`;
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
</script>

<div class="panel-shell panel-right panel-base" class:embedded-view={embedded} transition:fly={{ x: 400, duration: 250, easing: cubicOut }}>
  {#if !embedded}
    <div class="panel-header">
      <h3>Users</h3>
      <button class="btn btn-icon btn-ghost panel-close-btn" aria-label="Close users panel" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  {/if}

  <div class="panel-body panel-list-body">
    {#if $myLocation}
      <button class="user-item me user-item-btn" on:click={() => locateUser('__self__')}>
        <div class="user-meta">
          <div class="status-dot online"></div>
          <div>
            <strong>{$authUser?.displayName || 'You'} (You)</strong>
            <div class="mini">Tracking active</div>
          </div>
        </div>
        <span class="locate-icon" title="Locate on map">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
        </span>
      </button>
    {/if}

    {#if userList.length === 0 && !$myLocation}
      <p class="empty-state">No other users online</p>
    {:else}
      {#each userList as user (user.socketId)}
        <button class="user-item user-item-btn" on:click={() => locateUser(user.socketId)}>
          <div class="user-meta">
            <div class="status-dot" class:online={user.online !== false} class:offline={user.online === false} class:sos={user.sos?.active}></div>
            <div>
              <strong>{user.displayName || 'User'}</strong>
              {#if user.sos?.active}<span class="badge badge-danger badge-xs">SOS</span>{/if}
              <div class="mini">{onlineStatus(user)}</div>
              <div class="mini">Updated: {user.formattedTime || formatTimestamp(user.lastUpdate) || '-'}</div>
            </div>
          </div>
          <div class="user-actions">
            {#if user.batteryPct != null}
              <span class="mini bat-badge">{user.batteryPct}%</span>
            {/if}
            <span class="locate-icon" title="Locate on map">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
            </span>
            {#if isAdmin}
              <button class="btn btn-danger btn-sm" on:click|stopPropagation={() => deleteUser(user)}>Delete</button>
            {/if}
          </div>
        </button>
      {/each}
    {/if}

    {#if userList.length === 0 && $myLocation}
      <p class="empty-state">Waiting for other users to connect...</p>
    {/if}
  </div>
</div>

<style>
  .user-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    gap: var(--space-2);
  }
  .user-item:hover { background: var(--surface-inset); }
  .user-item-btn {
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    padding: var(--space-2) var(--space-4);
    transition: background 0.12s ease;
  }
  .user-item-btn:hover { background: var(--surface-inset); }
  .user-item-btn:active { background: var(--surface-secondary); }
  .locate-icon {
    color: var(--text-tertiary, #999);
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .user-item-btn:hover .locate-icon { color: var(--primary-500); }
  .bat-badge {
    font-size: var(--text-xs, 11px);
    color: var(--text-secondary);
  }
  .user-meta { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; }
  .user-meta strong { font-size: var(--text-sm); display: block; }
  .user-actions { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
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
