<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { socket } from '../lib/socket.js';
  import { adminOverview } from '../lib/stores/admin.js';

  const dispatch = createEventDispatcher();
  let activeTab = 'rooms';
  let loading = true;
  let loadingTimer = null;

  function beginLoading() {
    loading = true;
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => { loading = false; }, 5000);
  }

  onMount(() => {
    beginLoading();
    socket.emit('requestAdminOverview');
  });

  onDestroy(() => {
    if (loadingTimer) clearTimeout(loadingTimer);
  });

  function refresh() {
    beginLoading();
    socket.emit('requestAdminOverview');
  }

  $: stats = $adminOverview?.stats || {};
  $: rooms = $adminOverview?.rooms || [];
  $: users = $adminOverview?.users || [];
  $: guardianships = $adminOverview?.guardianships || [];
  $: if (loading && $adminOverview && (
    Array.isArray($adminOverview.rooms) ||
    Array.isArray($adminOverview.users) ||
    Array.isArray($adminOverview.guardianships)
  )) loading = false;
</script>

<div class="panel-shell panel-right panel-base" transition:fly={{ x: 400, duration: 250, easing: cubicOut }}>
  <div class="panel-header">
    <h3>Super Admin</h3>
    <div class="header-actions">
      <button class="btn btn-secondary btn-sm" on:click={refresh}>Refresh</button>
      <button class="btn btn-icon btn-ghost" aria-label="Close super admin panel" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <div class="panel-body">
    {#if loading}
      <div class="metric-grid">
        <div class="metric-card skeleton-card"></div>
        <div class="metric-card skeleton-card"></div>
        <div class="metric-card skeleton-card"></div>
        <div class="metric-card skeleton-card"></div>
      </div>
      <div class="skeleton-list">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    {:else}
      <!-- Stats -->
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-label">Users</span><span class="metric-value">{stats.totalUsers || 0}</span></div>
        <div class="metric-card"><span class="metric-label">Rooms</span><span class="metric-value">{stats.totalRooms || 0}</span></div>
        <div class="metric-card"><span class="metric-label">Active</span><span class="metric-value">{stats.activeConnections || 0}</span></div>
        <div class="metric-card"><span class="metric-label">Offline</span><span class="metric-value">{stats.offlineUsers || 0}</span></div>
      </div>

      <!-- Tabs -->
      <div class="tabs mt-3" role="tablist" aria-label="Super Admin views">
        <button class="tab" class:active={activeTab === 'rooms'} on:click={() => activeTab = 'rooms'} role="tab" aria-selected={activeTab === 'rooms'}>Rooms</button>
        <button class="tab" class:active={activeTab === 'users'} on:click={() => activeTab = 'users'} role="tab" aria-selected={activeTab === 'users'}>Users</button>
        <button class="tab" class:active={activeTab === 'guardians'} on:click={() => activeTab = 'guardians'} role="tab" aria-selected={activeTab === 'guardians'}>Guardians</button>
      </div>

      <!-- Rooms Tab -->
      {#if activeTab === 'rooms'}
        {#if rooms.length === 0}
          <p class="empty-state">No rooms exist yet</p>
        {:else}
          {#each rooms as room}
            <div class="card-item">
              <div class="card-item-header">
                <strong>{room.name}</strong> <span class="mini">({room.code})</span>
                <span class="badge badge-neutral badge-xs">{(room.members || []).length} members</span>
              </div>
              {#each (room.members || []) as m}
                <div class="member-row">
                  <span class="status-dot" class:online={m.online} class:offline={!m.online}></span>
                  {m.displayName}
                  {#if m.roomRole === 'admin'}<span class="badge badge-success badge-xs">Admin</span>{/if}
                  {#if m.roleExpiresAt}<span class="mini">(exp: {new Date(m.roleExpiresAt).toLocaleString()})</span>{/if}
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      {/if}

      <!-- Users Tab -->
      {#if activeTab === 'users'}
        {#if users.length === 0}
          <p class="empty-state">No users registered</p>
        {:else}
          {#each users as u}
            <details class="card-item">
              <summary class="card-item-header">
                <span class="status-dot" class:online={u.online} class:offline={!u.online}></span>
                <strong>{u.displayName}</strong>
                {#if u.role === 'admin'}<span class="badge badge-success badge-xs">Super Admin</span>{/if}
                <span class="mini">{u.email || u.mobile || u.shareCode || ''}</span>
              </summary>
              <div class="card-detail">
                <div class="mini">ID: {u.userId?.substring(0, 8)}... | Code: {u.shareCode || ''}</div>
                {#if u.contacts?.length > 0}
                  <div class="mini mt-1"><strong>Contacts ({u.contacts.length}):</strong></div>
                  <div class="tags">{#each u.contacts as c}<span class="tag">{c.displayName}</span>{/each}</div>
                {/if}
                {#if u.asGuardian?.length > 0}
                  <div class="mini mt-1"><strong>Guardian of:</strong></div>
                  <div class="tags">{#each u.asGuardian as g}<span class="tag">{g.wardName} <span class="badge" class:badge-success={g.status==='active'} class:badge-warning={g.status!=='active'} class:badge-xs>{g.status}</span></span>{/each}</div>
                {/if}
                {#if u.asWard?.length > 0}
                  <div class="mini mt-1"><strong>Guarded by:</strong></div>
                  <div class="tags">{#each u.asWard as g}<span class="tag">{g.guardianName} <span class="badge" class:badge-success={g.status==='active'} class:badge-warning={g.status!=='active'} class:badge-xs>{g.status}</span></span>{/each}</div>
                {/if}
              </div>
            </details>
          {/each}
        {/if}
      {/if}

      <!-- Guardians Tab -->
      {#if activeTab === 'guardians'}
        {#if guardianships.length === 0}
          <p class="empty-state">No guardian relationships</p>
        {:else}
          {#each guardianships as g}
            <div class="guardian-row">
              <div><strong>{g.guardianName}</strong> <span class="mini">guards</span> <strong>{g.wardName}</strong></div>
              <div>
                <span class="badge" class:badge-success={g.status==='active'} class:badge-warning={g.status!=='active'}>{g.status}</span>
                <span class="mini">{g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleString()}` : 'permanent'}</span>
              </div>
            </div>
          {/each}
        {/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  .header-actions { display: flex; gap: var(--space-2); }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-bottom: var(--space-3); }
  .card-item { background: var(--surface-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-2); }
  .card-item-header { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); }
  .card-detail { padding-top: var(--space-2); }
  .member-row { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); padding: 2px 0; }
  .guardian-row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2); border-bottom: 1px solid var(--border-subtle); font-size: var(--text-sm); }
  .skeleton-card {
    height: 64px;
    border-radius: var(--radius-md);
    background: linear-gradient(90deg, var(--surface-inset) 20%, var(--surface-hover) 40%, var(--surface-inset) 60%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.2s linear infinite;
  }
  .skeleton-list { display: grid; gap: var(--space-2); }
  .skeleton-line {
    height: 56px;
    border-radius: var(--radius-md);
    background: linear-gradient(90deg, var(--surface-inset) 20%, var(--surface-hover) 40%, var(--surface-inset) 60%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.2s linear infinite;
  }
  @keyframes skeleton-shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
</style>
