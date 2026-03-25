<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { socket } from '../lib/socket.js';
  import { authUser } from '../lib/stores/auth.js';
  import { banner } from '../lib/stores/sos.js';
  import { privacyPause } from '../lib/stores/places.js';
  import { apiPost, apiGet } from '../lib/api.js';

  export let embedded = false;

  const dispatch = createEventDispatcher();

  let firstName = '';
  let lastName = '';
  let email = '';
  let mobile = '';
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let deletePassword = '';
  let saving = false;
  let changingPw = false;
  let showDelete = false;
  let deleting = false;

  // Plain local state — driven only by clicks and acks, never by stores.
  // This prevents any external store write from overriding what the user just clicked.
  let retentionMode = 'default';  // 'default' (24h) | '48h'
  let privacyUntil = null;        // ms timestamp or null
  let privacyActive = false;
  let privacyTimeLeft = '';
  let _privacyTimer = null;

  // Push notifications
  let pushSupported = false;
  let pushEnabled = false;
  let togglingPush = false;
  let _pendingVapidResolve = null;

  function formatTimeLeft(ms) {
    if (ms <= 0) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function _updatePrivacy() {
    const now = Date.now();
    privacyActive = !!privacyUntil && privacyUntil > now;
    privacyTimeLeft = privacyActive ? formatTimeLeft(privacyUntil - now) : '';
  }

  // --- Socket event handlers (registered synchronously in onMount before any await) ---

  function onVapidKey(payload) {
    if (_pendingVapidResolve) {
      _pendingVapidResolve(payload);
      _pendingVapidResolve = null;
    }
  }

  function onPushSubscribeAck(payload) {
    togglingPush = false;
    if (payload && !payload.ok) {
      pushEnabled = false; // server rejected — roll back optimistic update
      banner.set({ type: 'sos', text: payload.error || 'Server rejected push subscription', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  function onPushUnsubscribeAck(payload) {
    togglingPush = false;
    if (payload && !payload.ok) {
      pushEnabled = true; // server rejected — roll back
      banner.set({ type: 'sos', text: 'Server could not remove subscription', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  function onPrivacyAck(payload) {
    if (payload && payload.ok) {
      // Server confirmed — update local state and sync shared store.
      privacyUntil = payload.pausedUntil ?? null;
      privacyPause.set(privacyUntil);
      _updatePrivacy();
    }
  }

  onMount(async () => {
    // Register ALL socket listeners FIRST — before any awaits — so no ack is ever missed.
    socket.on('vapidKey', onVapidKey);
    socket.on('pushSubscribeAck', onPushSubscribeAck);
    socket.on('pushUnsubscribeAck', onPushUnsubscribeAck);
    socket.on('privacyPauseAck', onPrivacyAck);

    // Seed privacy from the shared store (populated if another component set it earlier).
    const stored = get(privacyPause);
    if (stored && stored > Date.now()) {
      privacyUntil = stored;
    }
    _updatePrivacy();
    _privacyTimer = setInterval(_updatePrivacy, 10000);

    // Load profile fields — /api/me is the available endpoint.
    const res = await apiGet('/api/me');
    if (res.ok) {
      email = res.email || '';
      mobile = res.mobile || '';
      // firstName/lastName not in /api/me — leave blank (can be typed in)
    }

    // Push support detection — use getRegistration() to avoid hanging on .ready
    // if no SW is registered yet.
    pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (pushSupported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          pushEnabled = !!sub;
        }
      } catch (_) {
        pushEnabled = false;
      }
    }
  });

  onDestroy(() => {
    clearInterval(_privacyTimer);
    socket.off('vapidKey', onVapidKey);
    socket.off('pushSubscribeAck', onPushSubscribeAck);
    socket.off('pushUnsubscribeAck', onPushUnsubscribeAck);
    socket.off('privacyPauseAck', onPrivacyAck);
    _pendingVapidResolve = null;
  });

  // Fetch VAPID key via WS event — resolves via socket.on('vapidKey'), with 5 s timeout.
  function fetchVapidKey() {
    return new Promise((resolve) => {
      _pendingVapidResolve = resolve;
      socket.emit('getVapidKey', {});
      setTimeout(() => {
        if (_pendingVapidResolve === resolve) {
          _pendingVapidResolve = null;
          resolve({ ok: false });
        }
      }, 5000);
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function enablePush() {
    if (togglingPush) return;
    togglingPush = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        togglingPush = false;
        banner.set({ type: 'sos', text: 'Notification permission denied', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
        return;
      }
      const keyPayload = await fetchVapidKey();
      if (!keyPayload.ok || !keyPayload.key) {
        togglingPush = false;
        banner.set({ type: 'sos', text: 'Push notifications not configured on server', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
        return;
      }
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 6000)),
      ]);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyPayload.key),
      });
      const json = sub.toJSON();
      // Optimistic — flip UI immediately, notify server in background.
      pushEnabled = true;
      togglingPush = false;
      socket.emit('pushSubscribe', { endpoint: json.endpoint, keys: json.keys });
      banner.set({ type: 'info', text: 'Push notifications enabled', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
    } catch (err) {
      togglingPush = false;
      const msg = err.message === 'sw-timeout' ? 'Service worker not ready'
        : (err.message?.includes('denied') || err.message?.includes('permission'))
          ? 'Notification permission denied — enable in browser settings'
          : (err.message || String(err));
      banner.set({ type: 'sos', text: 'Could not enable notifications: ' + msg, actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3500);
    }
  }

  async function disablePush() {
    if (togglingPush) return;
    togglingPush = true;
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 6000)),
      ]);
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        pushEnabled = false;
        togglingPush = false;
        socket.emit('pushUnsubscribe', { endpoint });
        banner.set({ type: 'info', text: 'Push notifications disabled', actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
      } else {
        pushEnabled = false;
        togglingPush = false;
      }
    } catch (err) {
      togglingPush = false;
      banner.set({ type: 'sos', text: 'Could not disable notifications: ' + (err.message || err), actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  async function saveProfile() {
    saving = true;
    const res = await apiPost('/api/profile/update', { firstName, lastName, email, mobile });
    saving = false;
    if (res.ok) {
      banner.set({ type: 'info', text: 'Profile updated', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
    } else {
      banner.set({ type: 'sos', text: res.error || 'Failed to update', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      banner.set({ type: 'sos', text: 'Passwords do not match', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      return;
    }
    changingPw = true;
    const res = await apiPost('/api/profile/password', { currentPassword, newPassword });
    changingPw = false;
    if (res.ok) {
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      banner.set({ type: 'info', text: 'Password changed', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
    } else {
      banner.set({ type: 'sos', text: res.error || 'Failed', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  async function deleteAccount() {
    deleting = true;
    const res = await apiPost('/api/profile/delete', { password: deletePassword });
    deleting = false;
    if (res.ok) {
      authUser.set(null);
      window.location.hash = '#/login';
    } else {
      banner.set({ type: 'sos', text: res.error || 'Failed', actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
    }
  }

  const _retentionLabels = { default: '24 hours', '48h': '2 days', '5d': '5 days', '10d': '10 days', '30d': '30 days' };
  function setRetentionMode(mode) {
    retentionMode = mode; // immediate optimistic update — no callback, no deadlock
    socket.emit('setRetention', { mode });
    const label = _retentionLabels[mode] || mode;
    banner.set({ type: 'info', text: `Location kept for ${label} after going offline`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  }

  function setPrivacyMode(duration) {
    // Optimistic — update local state immediately, backend confirms via privacyPauseAck.
    if (duration === 'resume') {
      privacyUntil = null;
    } else {
      const hours = parseInt(duration, 10) || 1;
      privacyUntil = Date.now() + hours * 3600000;
    }
    privacyPause.set(privacyUntil); // keep shared store in sync for other components
    _updatePrivacy();
    socket.emit('setPrivacyPause', { duration });
  }
</script>

{#if embedded}
  <div class="panel-body settings-panel">
    <h4>Profile</h4>
    <div class="form-section">
      <label class="field-label">
        First Name
        <input type="text" bind:value={firstName} class="field-input" maxlength="50" />
      </label>
      <label class="field-label">
        Last Name
        <input type="text" bind:value={lastName} class="field-input" maxlength="50" />
      </label>
      <label class="field-label">
        Email
        <input type="email" bind:value={email} class="field-input" />
      </label>
      <label class="field-label">
        Mobile
        <input type="tel" bind:value={mobile} class="field-input" />
      </label>
      <button class="btn btn-primary btn-sm" on:click={saveProfile} disabled={saving}>
        {saving ? 'Saving...' : 'Save Profile'}
      </button>
    </div>

    <hr class="divider" />
    <h4>Privacy Mode</h4>
    <div class="form-section">
      <p class="hint">Temporarily hide your location from everyone.</p>
      {#if privacyActive}
        <div class="privacy-active">
          <span class="privacy-badge">Paused — {privacyTimeLeft} left</span>
          <button class="btn btn-secondary btn-sm" on:click={() => setPrivacyMode('resume')}>Resume Sharing</button>
        </div>
      {:else}
        <div class="privacy-btns">
          <button class="btn btn-secondary btn-sm" on:click={() => setPrivacyMode('1h')}>Pause 1h</button>
          <button class="btn btn-secondary btn-sm" on:click={() => setPrivacyMode('4h')}>Pause 4h</button>
          <button class="btn btn-secondary btn-sm" on:click={() => setPrivacyMode('8h')}>Pause 8h</button>
        </div>
      {/if}
    </div>

    <hr class="divider" />
    <h4>Location Retention</h4>
    <div class="form-section">
      <p class="hint">How long your last known location stays visible to others after you go offline.</p>
      <div class="retention-btns">
        {#each [['default','24h'],['48h','2d'],['5d','5d'],['10d','10d'],['30d','30d']] as [mode, label]}
          <button
            class="btn btn-sm"
            class:btn-primary={retentionMode === mode}
            class:btn-secondary={retentionMode !== mode}
            on:click={() => setRetentionMode(mode)}
          >{label}</button>
        {/each}
      </div>
    </div>

    <hr class="divider" />
    <h4>Push Notifications</h4>
    <div class="form-section">
      {#if pushSupported}
        <label class="toggle-row">
          <span>Enable push notifications</span>
          <button
            class="toggle-btn"
            class:on={pushEnabled}
            disabled={togglingPush}
            on:click={() => pushEnabled ? disablePush() : enablePush()}
            aria-label={pushEnabled ? 'Disable push notifications' : 'Enable push notifications'}
          >
            <span class="toggle-knob"></span>
          </button>
        </label>
        {#if togglingPush}<p class="hint">Updating&hellip;</p>{/if}
      {:else}
        <p class="hint">Push notifications are not supported in this browser.</p>
      {/if}
    </div>

    <hr class="divider" />
    <h4>Change Password</h4>
    <div class="form-section">
      <label class="field-label">
        Current Password
        <input type="password" bind:value={currentPassword} class="field-input" />
      </label>
      <label class="field-label">
        New Password
        <input type="password" bind:value={newPassword} class="field-input" />
      </label>
      <label class="field-label">
        Confirm New Password
        <input type="password" bind:value={confirmPassword} class="field-input" />
      </label>
      <button class="btn btn-primary btn-sm" on:click={changePassword} disabled={changingPw || !currentPassword || !newPassword}>
        {changingPw ? 'Changing...' : 'Change Password'}
      </button>
    </div>

    <hr class="divider" />
    <h4>Danger Zone</h4>
    <div class="form-section">
      {#if showDelete}
        <p class="hint danger-text">This action is permanent and cannot be undone.</p>
        <label class="field-label">
          Enter your password to confirm
          <input type="password" bind:value={deletePassword} class="field-input" />
        </label>
        <div class="delete-actions">
          <button class="btn btn-danger btn-sm" on:click={deleteAccount} disabled={deleting || !deletePassword}>
            {deleting ? 'Deleting...' : 'Delete My Account'}
          </button>
          <button class="btn btn-secondary btn-sm" on:click={() => { showDelete = false; deletePassword = ''; }}>Cancel</button>
        </div>
      {:else}
        <button class="btn btn-danger-outline btn-sm" on:click={() => showDelete = true}>Delete Account</button>
      {/if}
    </div>
  </div>
{:else}
  <div class="panel-shell panel-left panel-base">
    <div class="panel-header">
      <h3>Settings</h3>
      <button class="panel-close" on:click={() => dispatch('close')} aria-label="Close">&times;</button>
    </div>
    <div class="panel-body">
      <p>Use the sidebar Settings tab.</p>
    </div>
  </div>
{/if}

<style>
  .settings-panel { padding: 0; }

  h4 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary, #666);
    margin: 12px 0 8px;
    padding: 0 16px;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 16px 12px;
  }

  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #666);
  }

  .field-input {
    padding: 8px 10px;
    border: 1px solid var(--border-primary, #e0e0e0);
    border-radius: 8px;
    font-size: 13px;
    background: var(--surface-primary, white);
    color: var(--text-primary, #111);
  }

  .field-input:focus {
    outline: none;
    border-color: var(--primary-500, #3b82f6);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .hint {
    font-size: 12px;
    color: var(--text-tertiary, #999);
    margin: 0;
    line-height: 1.4;
  }

  .danger-text { color: #dc2626; }

  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
    min-height: 32px;
  }

  .btn-danger-outline {
    background: transparent;
    color: #dc2626;
    border: 1px solid #dc2626;
    cursor: pointer;
    border-radius: 8px;
  }
  .btn-danger-outline:hover { background: rgba(220, 38, 38, 0.06); }

  .delete-actions {
    display: flex;
    gap: 8px;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border-primary, #eee);
    margin: 8px 0;
  }

  .retention-btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .privacy-btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .privacy-active {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .privacy-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 12px;
    background: rgba(245, 158, 11, 0.12);
    color: #b45309;
    font-size: 12px;
    font-weight: 600;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--text-primary, #111);
    cursor: pointer;
  }

  .toggle-btn {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--border-primary, #ccc);
    border: none;
    cursor: pointer;
    transition: background 0.2s;
    padding: 0;
  }
  .toggle-btn.on { background: var(--primary-500, #3b82f6); }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: transform 0.2s;
  }
  .toggle-btn.on .toggle-knob { transform: translateX(18px); }
</style>
