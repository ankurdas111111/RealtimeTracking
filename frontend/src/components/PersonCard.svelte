<script>
  import { getUserColor, getUserColorLight } from '../lib/getUserColor.js';
  import FreshnessChip from './primitives/FreshnessChip.svelte';
  import { focusUser } from '../lib/stores/map.js';

  export let user = null;
  export let onClose = null;

  $: color = user ? getUserColor(user.userId) : '#6366f1';
  $: colorLight = user ? getUserColorLight(user.userId) : 'rgba(99,102,241,0.15)';

  $: initials = user
    ? (user.displayName || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
    : '?';

  function locateOnMap() {
    if (user?.userId) focusUser.set(user.userId);
    if (onClose) onClose();
  }

  function copyCoords() {
    if (!user?.lat || !user?.lng) return;
    const text = `${user.lat.toFixed(6)}, ${user.lng.toFixed(6)}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  }
</script>

{#if user}
  <div class="person-card" style="--user-color:{color};--user-color-light:{colorLight}">
    <!-- SOS banner -->
    {#if user.sos?.active}
      <div class="sos-banner" role="alert">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        SOS Active — {user.sos.reason || 'Emergency'}
      </div>
    {/if}

    <!-- Avatar + name row -->
    <div class="card-header">
      <div
        class="avatar"
        class:avatar-sos={user.sos?.active}
        class:avatar-offline={!user.online}
        style="background:{colorLight};border-color:{color}"
        aria-hidden="true"
      >
        <span class="avatar-initials" style="color:{color}">{initials}</span>
      </div>
      <div class="name-block">
        <span class="display-name">{user.displayName || 'Unknown'}</span>
        <FreshnessChip
          lastSeenMs={user.lastSeen}
          accuracy={user.accuracy}
          online={!!user.online}
          sos={!!user.sos?.active}
        />
      </div>
      {#if onClose}
        <button class="close-btn btn btn-icon btn-ghost" on:click={onClose} aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      {/if}
    </div>

    <!-- Stat grid -->
    {#if user.lat && user.lng}
      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">Latitude</span>
          <span class="stat-value">{user.lat.toFixed(5)}°</span>
        </div>
        <div class="stat">
          <span class="stat-label">Longitude</span>
          <span class="stat-value">{user.lng.toFixed(5)}°</span>
        </div>
        {#if user.accuracy != null}
          <div class="stat">
            <span class="stat-label">Accuracy</span>
            <span class="stat-value">±{Math.round(user.accuracy)}m</span>
          </div>
        {/if}
        {#if user.speed != null && user.speed > 0.5}
          <div class="stat">
            <span class="stat-label">Speed</span>
            <span class="stat-value">{(user.speed * 3.6).toFixed(1)} km/h</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="card-actions">
      <button class="btn btn-primary btn-sm action-btn" on:click={locateOnMap} disabled={!user.lat}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        Locate
      </button>
      <button class="btn btn-secondary btn-sm action-btn" on:click={copyCoords} disabled={!user.lat}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
    </div>
  </div>
{/if}

<style>
  .person-card {
    background: var(--glass-1, rgba(255,255,255,0.85));
    backdrop-filter: var(--blur-md, blur(24px));
    -webkit-backdrop-filter: var(--blur-md, blur(24px));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.6));
    box-shadow: var(--shadow-glass-md, 0 4px 24px rgba(0,0,0,0.12));
    border-radius: var(--radius-xl, 16px);
    overflow: hidden;
  }

  .sos-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(239, 68, 68, 0.12);
    border-bottom: 1px solid rgba(239, 68, 68, 0.20);
    color: var(--danger-600, #dc2626);
    font-size: var(--text-xs, 11px);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 14px 10px;
  }

  .avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2.5px solid var(--user-color);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
    transition: box-shadow 0.3s;
  }

  .avatar-sos {
    animation: sos-ring 1.2s ease-in-out infinite;
  }

  .avatar-offline {
    opacity: 0.5;
    filter: grayscale(0.6);
  }

  @keyframes sos-ring {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
    50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  }

  .avatar-initials {
    font-weight: 700;
    font-size: 15px;
    line-height: 1;
    user-select: none;
  }

  .name-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .display-name {
    font-weight: 700;
    font-size: var(--text-base, 15px);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--border-subtle, rgba(0,0,0,0.06));
    border-top: 1px solid var(--border-subtle, rgba(0,0,0,0.06));
    border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,0.06));
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px;
    background: var(--glass-1, rgba(255,255,255,0.85));
  }

  .stat-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }

  .stat-value {
    font-size: var(--text-sm, 13px);
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .card-actions {
    display: flex;
    gap: 8px;
    padding: 10px 14px 14px;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
</style>
