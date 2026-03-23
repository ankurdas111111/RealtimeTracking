<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { socket } from '../lib/socket.js';
  import { banner } from '../lib/stores/sos.js';
  import { savedPlaces, placeAlerts, speedAlerts } from '../lib/stores/places.js';
  import { otherUsers, myLocation } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';

  export let embedded = false;

  const dispatch = createEventDispatcher();

  let newPlaceName = '';
  let newPlaceRadius = 100;
  let newPlaceIcon = 'pin';
  let addingPlace = false;
  let showAddPlace = false;

  let alertTargetId = '';
  let alertPlaceId = '';
  let alertOnArrive = true;
  let alertOnDepart = true;
  let addingAlert = false;

  let speedTargetId = '';
  let speedThreshold = 80;
  let addingSpeed = false;

  const iconOptions = [
    { value: 'home', label: 'Home' },
    { value: 'work', label: 'Work' },
    { value: 'school', label: 'School' },
    { value: 'gym', label: 'Gym' },
    { value: 'pin', label: 'Other' }
  ];

  $: visibleUsers = buildUserList($otherUsers, $authUser);

  function buildUserList(others, auth) {
    const list = [];
    if (auth) list.push({ id: auth.userId, name: 'Me' });
    for (const u of others.values()) {
      if (u.userId) list.push({ id: u.userId, name: u.displayName || u.userId.slice(0, 6) });
    }
    return list;
  }

  onMount(() => {
    loadAll();
  });

  function loadAll() {
    socket.emit('getSavedPlaces', {}, (res) => {
      if (res?.ok) savedPlaces.set(res.places || []);
    });
    socket.emit('getPlaceAlerts', {}, (res) => {
      if (res?.ok) placeAlerts.set(res.alerts || []);
    });
    socket.emit('getSpeedAlerts', {}, (res) => {
      if (res?.ok) speedAlerts.set(res.alerts || []);
    });
  }

  function addPlace() {
    if (!newPlaceName.trim()) return;
    const loc = $myLocation;
    if (!loc) {
      banner.set({ type: 'info', text: 'Start tracking to use your current location', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      return;
    }
    addingPlace = true;
    socket.emit('createSavedPlace', {
      name: newPlaceName.trim(),
      lat: loc.latitude,
      lng: loc.longitude,
      radiusM: newPlaceRadius,
      icon: newPlaceIcon
    }, (res) => {
      addingPlace = false;
      if (res?.ok) {
        savedPlaces.update(arr => [...arr, { id: res.id, name: newPlaceName.trim(), lat: loc.latitude, lng: loc.longitude, radiusM: newPlaceRadius, icon: newPlaceIcon }]);
        newPlaceName = '';
        showAddPlace = false;
        banner.set({ type: 'info', text: 'Place saved', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      }
    });
  }

  function removePlace(placeId) {
    socket.emit('deleteSavedPlace', { id: placeId }, (res) => {
      if (res?.ok) {
        savedPlaces.update(arr => arr.filter(p => p.id !== placeId));
        placeAlerts.update(arr => arr.filter(a => a.placeId !== placeId));
      }
    });
  }

  function addPlaceAlert() {
    if (!alertTargetId || !alertPlaceId) return;
    addingAlert = true;
    socket.emit('createPlaceAlert', {
      targetId: alertTargetId,
      placeId: alertPlaceId,
      onArrive: alertOnArrive,
      onDepart: alertOnDepart
    }, (res) => {
      addingAlert = false;
      if (res?.ok) {
        loadAll();
        banner.set({ type: 'info', text: 'Place alert created', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      }
    });
  }

  function removePlaceAlert(alertId) {
    socket.emit('deletePlaceAlert', { id: alertId }, (res) => {
      if (res?.ok) placeAlerts.update(arr => arr.filter(a => a.id !== alertId));
    });
  }

  function addSpeedAlert() {
    if (!speedTargetId) return;
    addingSpeed = true;
    socket.emit('createSpeedAlert', {
      targetId: speedTargetId,
      thresholdKmh: speedThreshold
    }, (res) => {
      addingSpeed = false;
      if (res?.ok) {
        loadAll();
        banner.set({ type: 'info', text: 'Speed alert created', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      }
    });
  }

  function removeSpeedAlert(alertId) {
    socket.emit('deleteSpeedAlert', { id: alertId }, (res) => {
      if (res?.ok) speedAlerts.update(arr => arr.filter(a => a.id !== alertId));
    });
  }

  function getUserName(userId) {
    if ($authUser && userId === $authUser.userId) return 'Me';
    for (const u of $otherUsers.values()) {
      if (u.userId === userId) return u.displayName || userId.slice(0, 6);
    }
    return userId?.slice(0, 6) || '?';
  }
</script>

{#if embedded}
  <div class="panel-body places-panel">
    <!-- Saved Places -->
    <h4>Saved Places</h4>
    <div class="section-content">
      {#if $savedPlaces.length === 0}
        <p class="empty">No saved places yet.</p>
      {/if}
      {#each $savedPlaces as place}
        <div class="list-item">
          <div class="item-icon">{place.icon === 'home' ? '🏠' : place.icon === 'work' ? '💼' : place.icon === 'school' ? '🏫' : place.icon === 'gym' ? '🏋️' : '📍'}</div>
          <div class="item-info">
            <span class="item-name">{place.name}</span>
            <span class="item-detail">{place.radiusM}m radius</span>
          </div>
          <button class="btn-icon-sm" on:click={() => removePlace(place.id)} title="Remove">✕</button>
        </div>
      {/each}

      {#if showAddPlace}
        <div class="add-form">
          <input type="text" bind:value={newPlaceName} class="field-input" placeholder="Place name" maxlength="100" />
          <div class="form-row">
            <select bind:value={newPlaceIcon} class="field-input field-sm">
              {#each iconOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <label class="field-label-inline">
              Radius
              <input type="number" bind:value={newPlaceRadius} class="field-input field-sm" min="50" max="5000" step="50" />
              m
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" on:click={addPlace} disabled={addingPlace || !newPlaceName.trim()}>
              {addingPlace ? 'Saving...' : 'Save at My Location'}
            </button>
            <button class="btn btn-secondary btn-sm" on:click={() => showAddPlace = false}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="btn btn-secondary btn-sm add-btn" on:click={() => showAddPlace = true}>+ Add Place</button>
      {/if}
    </div>

    <hr class="divider" />

    <!-- Arrival / Departure Alerts -->
    <h4>Arrival / Departure Alerts</h4>
    <div class="section-content">
      {#if $placeAlerts.length === 0}
        <p class="empty">No alerts configured.</p>
      {/if}
      {#each $placeAlerts as alert}
        <div class="list-item">
          <div class="item-info">
            <span class="item-name">{getUserName(alert.targetId)} → {alert.placeName || '?'}</span>
            <span class="item-detail">
              {alert.onArrive ? 'Arrive' : ''}{alert.onArrive && alert.onDepart ? ' + ' : ''}{alert.onDepart ? 'Depart' : ''}
            </span>
          </div>
          <button class="btn-icon-sm" on:click={() => removePlaceAlert(alert.id)} title="Remove">✕</button>
        </div>
      {/each}

      {#if $savedPlaces.length > 0}
        <div class="add-form">
          <div class="form-row">
            <select bind:value={alertTargetId} class="field-input field-sm">
              <option value="">Who?</option>
              {#each visibleUsers as u}
                <option value={u.id}>{u.name}</option>
              {/each}
            </select>
            <select bind:value={alertPlaceId} class="field-input field-sm">
              <option value="">Where?</option>
              {#each $savedPlaces as p}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-row">
            <label class="check-label"><input type="checkbox" bind:checked={alertOnArrive} /> Arrive</label>
            <label class="check-label"><input type="checkbox" bind:checked={alertOnDepart} /> Depart</label>
            <button class="btn btn-primary btn-sm" on:click={addPlaceAlert} disabled={addingAlert || !alertTargetId || !alertPlaceId}>Add</button>
          </div>
        </div>
      {/if}
    </div>

    <hr class="divider" />

    <!-- Speed Alerts -->
    <h4>Speed Alerts</h4>
    <div class="section-content">
      {#if $speedAlerts.length === 0}
        <p class="empty">No speed alerts configured.</p>
      {/if}
      {#each $speedAlerts as sa}
        <div class="list-item">
          <div class="item-info">
            <span class="item-name">{getUserName(sa.targetId)}</span>
            <span class="item-detail">Alert above {sa.thresholdKmh} km/h</span>
          </div>
          <button class="btn-icon-sm" on:click={() => removeSpeedAlert(sa.id)} title="Remove">✕</button>
        </div>
      {/each}

      <div class="add-form">
        <div class="form-row">
          <select bind:value={speedTargetId} class="field-input field-sm">
            <option value="">Who?</option>
            {#each visibleUsers as u}
              <option value={u.id}>{u.name}</option>
            {/each}
          </select>
          <label class="field-label-inline">
            Limit
            <input type="number" bind:value={speedThreshold} class="field-input field-sm" min="10" max="300" step="5" />
            km/h
          </label>
          <button class="btn btn-primary btn-sm" on:click={addSpeedAlert} disabled={addingSpeed || !speedTargetId}>Add</button>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="panel-shell panel-left panel-base">
    <div class="panel-header">
      <h3>Places & Alerts</h3>
      <button class="panel-close" on:click={() => dispatch('close')} aria-label="Close">&times;</button>
    </div>
    <div class="panel-body">
      <p>Use the sidebar Places tab.</p>
    </div>
  </div>
{/if}

<style>
  .places-panel { padding: 0; }

  h4 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary, #666);
    margin: 12px 0 8px;
    padding: 0 16px;
  }

  .section-content { padding: 0 16px 8px; }

  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-primary, #f0f0f0);
  }
  .list-item:last-child { border-bottom: none; }

  .item-icon { font-size: 18px; flex-shrink: 0; }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #111);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-detail {
    font-size: 11px;
    color: var(--text-tertiary, #999);
  }

  .btn-icon-sm {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    background: var(--surface-secondary, #f3f4f6);
    color: var(--text-tertiary, #999);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-icon-sm:hover { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    padding: 10px;
    background: var(--surface-secondary, #f9fafb);
    border-radius: 8px;
  }

  .form-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .field-input {
    padding: 8px 10px;
    border: 1px solid var(--border-primary, #e0e0e0);
    border-radius: 8px;
    font-size: 13px;
    background: var(--surface-primary, white);
    color: var(--text-primary, #111);
  }

  .field-sm { flex: 1; min-width: 80px; padding: 6px 8px; font-size: 12px; }

  .field-input:focus {
    outline: none;
    border-color: var(--primary-500, #3b82f6);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .field-label-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary, #666);
    white-space: nowrap;
  }

  .check-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-primary, #111);
    cursor: pointer;
  }

  .form-actions { display: flex; gap: 8px; }

  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
    min-height: 32px;
  }

  .add-btn { align-self: flex-start; margin-top: 6px; }

  .empty {
    font-size: 12px;
    color: var(--text-tertiary, #999);
    margin: 4px 0;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border-primary, #eee);
    margin: 8px 0;
  }
</style>
