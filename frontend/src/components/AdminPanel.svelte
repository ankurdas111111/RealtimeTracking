<script>
  import { createEventDispatcher } from 'svelte';
  import { socket } from '../lib/socket.js';
  import { authUser } from '../lib/stores/auth.js';
  import { otherUsers, myLocation } from '../lib/stores/map.js';
  import { canManage } from '../lib/stores/guardians.js';
  import { banner } from '../lib/stores/sos.js';

  export let embedded = false;

  const dispatch = createEventDispatcher();

  $: isAdmin = $authUser && $authUser.role === 'admin';
  $: hasManageables = isAdmin || $canManage.size > 0;

  let targetId = 'me';
  let autoSosEnabled = false;
  let noMoveMin = 5;
  let hardStopMin = 2;
  let geofenceEnabled = false;
  let geofenceRadius = 0;
  let checkInEnabled = false;
  let checkInIntervalMin = 5;
  let checkInOverdueMin = 7;
  let keepForever = false;

  $: targetOptions = buildTargetOptions($otherUsers, $canManage, isAdmin);

  function buildTargetOptions(users, cm, admin) {
    const opts = [{ value: 'me', label: ($authUser?.displayName || 'Me') + ' (me)' }];
    if (admin) {
      for (const [, u] of users) {
        opts.push({ value: u.socketId, label: u.displayName || u.socketId });
      }
    } else {
      for (const [uid, name] of cm) {
        if (uid === $authUser?.userId) continue;
        for (const [, u] of users) {
          if (u.userId === uid) opts.push({ value: u.socketId, label: u.displayName || u.socketId });
        }
      }
    }
    return opts;
  }

  function getTarget() {
    if (targetId === 'me') {
      return { socketId: null, latitude: $myLocation?.latitude, longitude: $myLocation?.longitude };
    }
    const u = $otherUsers.get(targetId);
    return u || { socketId: targetId };
  }

  function applySettings() {
    const target = getTarget();
    const sid = target.socketId || undefined;

    socket.emit('setAutoSos', {
      socketId: sid, enabled: autoSosEnabled,
      noMoveMinutes: noMoveMin > 0 ? noMoveMin : 5,
      hardStopMinutes: hardStopMin > 0 ? hardStopMin : 2,
      geofence: geofenceEnabled
    });

    if (geofenceEnabled) {
      if (!geofenceRadius) { banner.set({ type: 'info', text: 'Set a geofence radius first.', actions: [] }); return; }
      const lat = target.latitude ?? $myLocation?.latitude;
      const lng = target.longitude ?? $myLocation?.longitude;
      if (lat == null || lng == null) { banner.set({ type: 'info', text: 'Start Tracking to set geofence center.', actions: [] }); return; }
      socket.emit('setGeofence', { socketId: sid, enabled: true, centerLat: lat, centerLng: lng, radiusM: geofenceRadius });
    } else {
      socket.emit('setGeofence', { socketId: sid, enabled: false });
    }

    socket.emit('setCheckInRules', {
      socketId: sid, enabled: checkInEnabled,
      intervalMinutes: checkInIntervalMin > 0 ? checkInIntervalMin : 5,
      overdueMinutes: checkInOverdueMin > 0 ? checkInOverdueMin : 7
    });

    if (keepForever && sid) socket.emit('setRetentionForever', { socketId: sid, forever: keepForever });

    banner.set({ type: 'info', text: 'Admin settings applied.', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 1500);
  }
</script>

{#if hasManageables}
  {#if embedded}
    <div class="panel-body">
      <div class="section">
        <label class="label" for="admin-target-user-embedded">Target User</label>
        <select id="admin-target-user-embedded" class="select" bind:value={targetId}>
          {#each targetOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <hr class="divider" />

      <div class="section">
        <label class="toggle"><input type="checkbox" bind:checked={autoSosEnabled}><span class="toggle-track"></span>Auto SOS</label>
        <div class="field-row">
          <span class="label mini">No-move minutes</span>
          <input class="input w-input-sm" type="number" bind:value={noMoveMin} min="1" />
        </div>
        <div class="field-row">
          <span class="label mini">Hard-stop minutes</span>
          <input class="input w-input-sm" type="number" bind:value={hardStopMin} min="1" />
        </div>
      </div>

      <hr class="divider" />

      <div class="section">
        <label class="toggle"><input type="checkbox" bind:checked={geofenceEnabled}><span class="toggle-track"></span>Geofence</label>
        <div class="field-row">
          <span class="label mini">Radius (meters)</span>
          <input class="input w-input-md" type="number" bind:value={geofenceRadius} min="0" />
        </div>
      </div>

      <hr class="divider" />

      <div class="section">
        <label class="toggle"><input type="checkbox" bind:checked={checkInEnabled}><span class="toggle-track"></span>Check-In</label>
        <div class="field-row">
          <span class="label mini">Interval (min)</span>
          <input class="input w-input-sm" type="number" bind:value={checkInIntervalMin} min="1" />
        </div>
        <div class="field-row">
          <span class="label mini">Overdue (min)</span>
          <input class="input w-input-sm" type="number" bind:value={checkInOverdueMin} min="1" />
        </div>
      </div>

      {#if isAdmin}
        <hr class="divider" />
        <div class="section">
          <label class="toggle"><input type="checkbox" bind:checked={keepForever}><span class="toggle-track"></span>Keep Location Forever</label>
        </div>
      {/if}

      <button class="btn btn-primary full-width mt-4" on:click={applySettings}>Apply Settings</button>
    </div>
  {:else}
    <div class="panel-shell panel-left panel-base">
      <div class="panel-header">
        <h3>Admin Controls</h3>
        <button class="btn btn-icon btn-ghost" aria-label="Close admin panel" on:click={() => dispatch('close')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="panel-body">
        <div class="section">
          <label class="label" for="admin-target-user-panel">Target User</label>
          <select id="admin-target-user-panel" class="select" bind:value={targetId}>
            {#each targetOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <hr class="divider" />
        <div class="section">
          <label class="toggle"><input type="checkbox" bind:checked={autoSosEnabled}><span class="toggle-track"></span>Auto SOS</label>
        </div>
        <hr class="divider" />
        <div class="section">
          <label class="toggle"><input type="checkbox" bind:checked={geofenceEnabled}><span class="toggle-track"></span>Geofence</label>
        </div>
        <hr class="divider" />
        <div class="section">
          <label class="toggle"><input type="checkbox" bind:checked={checkInEnabled}><span class="toggle-track"></span>Check-In</label>
        </div>
        <button class="btn btn-primary full-width mt-4" on:click={applySettings}>Apply Settings</button>
      </div>
    </div>
  {/if}
{:else}
  {#if embedded}
    <div class="panel-body">
      <div class="empty-state">
        <p>No admin privileges. Request Room Admin or Contact Guardian access to manage safety features.</p>
      </div>
    </div>
  {/if}
{/if}
