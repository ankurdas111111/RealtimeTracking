<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { socket } from '../lib/socket.js';
  import { banner } from '../lib/stores/sos.js';
  import { savedPlaces, placeAlerts, speedAlerts } from '../lib/stores/places.js';
  import { otherUsers, myLocation } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';

  export let embedded = false;

  const dispatch = createEventDispatcher();

  // ── Saved Places ─────────────────────────────────────────────────────────────
  let newPlaceName = '';
  let newPlaceRadius = 100;
  let newPlaceIcon = 'pin';
  let showAddPlace = false;

  // ── Arrival / Departure Alerts ───────────────────────────────────────────────
  let alertTargetId = '';
  let alertPlaceId = '';
  let alertOnArrive = true;
  let alertOnDepart = true;

  // ── Speed Alerts ─────────────────────────────────────────────────────────────
  let speedTargetId = '';
  let speedThreshold = 80;

  const iconOptions = [
    { value: 'home', label: 'Home' },
    { value: 'work', label: 'Work' },
    { value: 'school', label: 'School' },
    { value: 'gym', label: 'Gym' },
    { value: 'pin', label: 'Other' },
  ];

  const STORAGE_KEY = 'kinnect_saved_places';
  const PALERT_KEY  = 'kinnect_place_alerts';
  const SALERT_KEY  = 'kinnect_speed_alerts';

  $: visibleUsers = buildUserList($otherUsers, $authUser);

  function buildUserList(others, auth) {
    const list = [];
    if (auth) list.push({ id: auth.userId, name: 'Me' });
    for (const u of others.values()) {
      if (u.userId) list.push({ id: u.userId, name: u.displayName || u.userId.slice(0, 6) });
    }
    return list;
  }

  // ── Persistence helpers (localStorage) ───────────────────────────────────────
  function loadFromStorage() {
    try {
      const sp = localStorage.getItem(STORAGE_KEY);
      if (sp) savedPlaces.set(JSON.parse(sp));
      const pa = localStorage.getItem(PALERT_KEY);
      if (pa) placeAlerts.set(JSON.parse(pa));
      const sa = localStorage.getItem(SALERT_KEY);
      if (sa) speedAlerts.set(JSON.parse(sa));
    } catch (_) {}
  }

  function persist(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  onMount(() => {
    loadFromStorage();
  });

  // ── Saved Places ─────────────────────────────────────────────────────────────
  function addPlace() {
    if (!newPlaceName.trim()) return;
    const loc = $myLocation;
    if (!loc) {
      banner.set({ type: 'info', text: 'Start location tracking first so we can pin your current position', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
      return;
    }
    const place = {
      id: Date.now().toString(),
      name: newPlaceName.trim(),
      lat: loc.latitude,
      lng: loc.longitude,
      radiusM: newPlaceRadius,
      icon: newPlaceIcon,
    };
    savedPlaces.update(arr => {
      const next = [...arr, place];
      persist(STORAGE_KEY, next);
      return next;
    });
    // Notify server in background (fire-and-forget — no callback needed)
    socket.emit('createSavedPlace', { name: place.name, lat: place.lat, lng: place.lng, radiusM: place.radiusM, icon: place.icon });
    newPlaceName = '';
    newPlaceRadius = 100;
    newPlaceIcon = 'pin';
    showAddPlace = false;
    banner.set({ type: 'info', text: `"${place.name}" saved at your current location`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  }

  function removePlace(placeId) {
    savedPlaces.update(arr => {
      const next = arr.filter(p => p.id !== placeId);
      persist(STORAGE_KEY, next);
      return next;
    });
    placeAlerts.update(arr => {
      const next = arr.filter(a => a.placeId !== placeId);
      persist(PALERT_KEY, next);
      return next;
    });
    socket.emit('deleteSavedPlace', { id: placeId });
  }

  // ── Arrival / Departure Alerts ───────────────────────────────────────────────
  function addPlaceAlert() {
    if (!alertTargetId || !alertPlaceId) return;
    const place = $savedPlaces.find(p => p.id === alertPlaceId);
    const user  = visibleUsers.find(u => u.id === alertTargetId);
    const alert = {
      id: Date.now().toString(),
      targetId: alertTargetId,
      targetName: user?.name || alertTargetId,
      placeId: alertPlaceId,
      placeName: place?.name || '?',
      onArrive: alertOnArrive,
      onDepart: alertOnDepart,
    };
    placeAlerts.update(arr => {
      const next = [...arr, alert];
      persist(PALERT_KEY, next);
      return next;
    });
    socket.emit('createPlaceAlert', { targetId: alertTargetId, placeId: alertPlaceId, onArrive: alertOnArrive, onDepart: alertOnDepart });
    alertTargetId = '';
    alertPlaceId = '';
    banner.set({ type: 'info', text: 'Arrival/departure alert added', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  }

  function removePlaceAlert(alertId) {
    placeAlerts.update(arr => {
      const next = arr.filter(a => a.id !== alertId);
      persist(PALERT_KEY, next);
      return next;
    });
    socket.emit('deletePlaceAlert', { id: alertId });
  }

  // ── Speed Alerts ─────────────────────────────────────────────────────────────
  function addSpeedAlert() {
    if (!speedTargetId) return;
    const user = visibleUsers.find(u => u.id === speedTargetId);
    const alert = {
      id: Date.now().toString(),
      targetId: speedTargetId,
      targetName: user?.name || speedTargetId,
      thresholdKmh: speedThreshold,
    };
    speedAlerts.update(arr => {
      const next = [...arr, alert];
      persist(SALERT_KEY, next);
      return next;
    });
    socket.emit('createSpeedAlert', { targetId: speedTargetId, thresholdKmh: speedThreshold });
    speedTargetId = '';
    banner.set({ type: 'info', text: `Speed alert set — you'll be notified above ${speedThreshold} km/h`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  }

  function removeSpeedAlert(alertId) {
    speedAlerts.update(arr => {
      const next = arr.filter(a => a.id !== alertId);
      persist(SALERT_KEY, next);
      return next;
    });
    socket.emit('deleteSpeedAlert', { id: alertId });
  }

  function getUserName(userId) {
    if ($authUser && userId === $authUser.userId) return 'Me';
    for (const u of $otherUsers.values()) {
      if (u.userId === userId) return u.displayName || userId.slice(0, 6);
    }
    return userId?.slice(0, 6) || '?';
  }

  const iconEmoji = { home: '🏠', work: '💼', school: '🏫', gym: '🏋️', pin: '📍' };
</script>

{#if embedded}
  <div class="panel-body places-panel">

    <!-- ── Saved Places ─────────────────────────────────────────────────── -->
    <h4>Saved Places</h4>
    <div class="section-content">
      <p class="hint">Pin locations (home, work, etc.) at your current GPS position. These are used to trigger arrival and departure alerts below.</p>

      {#each $savedPlaces as place}
        <div class="list-item">
          <div class="item-icon">{iconEmoji[place.icon] ?? '📍'}</div>
          <div class="item-info">
            <span class="item-name">{place.name}</span>
            <span class="item-detail">{place.radiusM}m radius · {place.lat?.toFixed(4)}, {place.lng?.toFixed(4)}</span>
          </div>
          <button class="btn-icon-sm" on:click={() => removePlace(place.id)} title="Remove">✕</button>
        </div>
      {/each}

      {#if showAddPlace}
        <div class="add-form">
          <input
            type="text"
            bind:value={newPlaceName}
            class="field-input field-full"
            placeholder="Place name (e.g. Home, Work…)"
            maxlength="100"
            autocomplete="off"
          />
          <div class="form-row">
            <select bind:value={newPlaceIcon} class="field-input field-sm">
              {#each iconOptions as opt}
                <option value={opt.value}>{iconEmoji[opt.value]} {opt.label}</option>
              {/each}
            </select>
            <label class="field-label-inline">
              Radius
              <input type="number" bind:value={newPlaceRadius} class="field-input field-num" min="50" max="5000" step="50" />
              m
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary btn-sm" on:click={addPlace} disabled={!newPlaceName.trim()}>
              Save at My Location
            </button>
            <button class="btn btn-secondary btn-sm" on:click={() => { showAddPlace = false; newPlaceName = ''; }}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="btn btn-secondary btn-sm add-btn" on:click={() => showAddPlace = true}>+ Add Place</button>
      {/if}
    </div>

    <hr class="divider" />

    <!-- ── Arrival / Departure Alerts ──────────────────────────────────── -->
    <h4>Arrival / Departure Alerts</h4>
    <div class="section-content">
      <p class="hint">Get notified when a tracked person enters or leaves one of your saved places. Requires location sharing to be active.</p>

      {#if $placeAlerts.length === 0}
        <p class="empty">No alerts configured.</p>
      {/if}
      {#each $placeAlerts as alert}
        <div class="list-item">
          <div class="item-icon">🔔</div>
          <div class="item-info">
            <span class="item-name">{getUserName(alert.targetId)} at {alert.placeName || '?'}</span>
            <span class="item-detail">
              {[alert.onArrive && 'Arrive', alert.onDepart && 'Depart'].filter(Boolean).join(' + ')}
            </span>
          </div>
          <button class="btn-icon-sm" on:click={() => removePlaceAlert(alert.id)} title="Remove">✕</button>
        </div>
      {/each}

      {#if $savedPlaces.length > 0}
        <div class="add-form">
          <div class="form-row">
            <select bind:value={alertTargetId} class="field-input field-sm">
              <option value="">Who to watch?</option>
              {#each visibleUsers as u}
                <option value={u.id}>{u.name}</option>
              {/each}
            </select>
            <select bind:value={alertPlaceId} class="field-input field-sm">
              <option value="">Which place?</option>
              {#each $savedPlaces as p}
                <option value={p.id}>{iconEmoji[p.icon] ?? '📍'} {p.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-row">
            <label class="check-label"><input type="checkbox" bind:checked={alertOnArrive} /> On arrival</label>
            <label class="check-label"><input type="checkbox" bind:checked={alertOnDepart} /> On departure</label>
            <button class="btn btn-primary btn-sm" on:click={addPlaceAlert} disabled={!alertTargetId || !alertPlaceId || (!alertOnArrive && !alertOnDepart)}>Add</button>
          </div>
        </div>
      {:else}
        <p class="empty">Add a saved place above first.</p>
      {/if}
    </div>

    <hr class="divider" />

    <!-- ── Speed Alerts ─────────────────────────────────────────────────── -->
    <h4>Speed Alerts</h4>
    <div class="section-content">
      <p class="hint">Get notified when a tracked person exceeds a speed limit. Useful for monitoring young drivers or detecting unsafe driving.</p>

      {#if $speedAlerts.length === 0}
        <p class="empty">No speed alerts configured.</p>
      {/if}
      {#each $speedAlerts as sa}
        <div class="list-item">
          <div class="item-icon">🚗</div>
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
            <option value="">Who to watch?</option>
            {#each visibleUsers as u}
              <option value={u.id}>{u.name}</option>
            {/each}
          </select>
          <label class="field-label-inline">
            Limit
            <input type="number" bind:value={speedThreshold} class="field-input field-num" min="10" max="300" step="5" />
            km/h
          </label>
          <button class="btn btn-primary btn-sm" on:click={addSpeedAlert} disabled={!speedTargetId}>Add</button>
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
    margin: 12px 0 4px;
    padding: 0 16px;
  }

  .section-content { padding: 0 16px 8px; }

  .hint {
    font-size: 12px;
    color: var(--text-tertiary, #999);
    line-height: 1.5;
    margin: 0 0 8px;
  }

  /* ── List items ──────────────────────────────────────────────────────────── */
  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-primary, rgba(255,255,255,0.08));
  }
  .list-item:last-of-type { border-bottom: none; }

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
    color: var(--text-primary, #e8e8e8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-detail { font-size: 11px; color: var(--text-tertiary, #888); }

  .btn-icon-sm {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.07);
    color: var(--text-tertiary, #888);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .btn-icon-sm:hover { background: rgba(220, 38, 38, 0.18); color: #f87171; }

  /* ── Add form ────────────────────────────────────────────────────────────── */
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    padding: 12px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
  }

  .form-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  /* Force legible text inside inputs regardless of theme */
  .field-input {
    padding: 8px 10px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    font-size: 13px;
    background: rgba(255,255,255,0.10);
    color: #e8e8e8;
    -webkit-text-fill-color: #e8e8e8;
  }
  .field-input::placeholder { color: rgba(232,232,232,0.45); }
  .field-input option { background: #1e2433; color: #e8e8e8; }
  .field-full { width: 100%; box-sizing: border-box; }
  .field-sm  { flex: 1; min-width: 90px; padding: 6px 8px; font-size: 12px; }
  .field-num { width: 64px; flex: none; padding: 6px 8px; font-size: 12px; }

  .field-input:focus {
    outline: none;
    border-color: var(--primary-500, #3b82f6);
    box-shadow: 0 0 0 2px rgba(59,130,246,0.25);
  }

  .field-label-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    white-space: nowrap;
  }

  .check-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-primary, #e8e8e8);
    cursor: pointer;
    user-select: none;
  }

  .form-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .btn-sm { padding: 6px 14px; font-size: 12px; min-height: 32px; }

  .add-btn { align-self: flex-start; margin-top: 4px; }

  .empty { font-size: 12px; color: var(--text-tertiary, #888); margin: 4px 0 6px; }

  .divider {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.07);
    margin: 8px 0;
  }
</style>
