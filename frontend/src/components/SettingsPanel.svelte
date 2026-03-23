<script>
  import { createEventDispatcher, onMount } from 'svelte';
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
  let pushSupported = false;
  let pushEnabled = false;
  let togglingPush = false;
  let privacyPauseUntil = null;
  let retentionDays = 2;
  let savingRetention = false;

  $: privacyPauseUntil = $privacyPause;
  $: privacyActive = privacyPauseUntil && privacyPauseUntil > Date.now();
  $: privacyTimeLeft = privacyActive ? formatTimeLeft(privacyPauseUntil - Date.now()) : '';

  function formatTimeLeft(ms) {
    if (ms <= 0) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  onMount(async () => {
    const res = await apiGet('/api/profile');
    if (res.ok && res.profile) {
      firstName = res.profile.firstName || '';
      lastName = res.profile.lastName || '';
      email = res.profile.email || '';
      mobile = res.profile.mobile || '';
      retentionDays = res.profile.offlineRetentionDays || 2;
    }
    pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    if (pushSupported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          pushEnabled = !!sub;
        }
      } catch (_) {}
    }
  });

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

  function setRetentionDays(days) {
    savingRetention = true;
    socket.emit('setOfflineRetention', { days }, (res) => {
      savingRetention = false;
      if (res && res.ok) {
        retentionDays = res.days;
        banner.set({ type: 'info', text: `Location kept for ${days} days when offline`, actions: [] });
        setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
      }
    });
  }

  function setPrivacyMode(duration) {
    socket.emit('setPrivacyPause', { duration }, (res) => {
      if (res && res.ok) {
        privacyPause.set(res.pausedUntil || null);
      }
    });
  }

  async function togglePush() {
    if (!pushSupported) return;
    togglingPush = true;
    try {
      if (pushEnabled) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            socket.emit('pushUnsubscribe', { endpoint: sub.endpoint }, () => {});
            await sub.unsubscribe();
          }
        }
        pushEnabled = false;
        togglingPush = false;
      } else {
        const reg = await navigator.serviceWorker.ready;
        const vapidRes = await new Promise(resolve => {
          socket.emit('getVapidKey', {}, resolve);
        });
        if (!vapidRes?.key) {
          banner.set({ type: 'sos', text: 'Push notifications not configured on server', actions: [] });
          setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
          togglingPush = false;
          return;
        }
        try {
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidRes.key)
          });
          const json = sub.toJSON();
          const ack = await new Promise(resolve => {
            socket.emit('pushSubscribe', {
              endpoint: json.endpoint,
              keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }
            }, resolve);
          });
          pushEnabled = ack?.ok || false;
          if (pushEnabled) {
            banner.set({ type: 'info', text: 'Push notifications enabled', actions: [] });
            setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
          }
        } catch (err) {
          const msg = err?.message || '';
          if (msg.includes('denied') || msg.includes('permission')) {
            banner.set({ type: 'sos', text: 'Notification permission denied. Enable it in browser settings.', actions: [] });
          } else {
            banner.set({ type: 'sos', text: 'Failed to enable push notifications', actions: [] });
          }
          setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
        }
        togglingPush = false;
      }
    } catch (err) {
      banner.set({ type: 'sos', text: 'Push notification error: ' + (err?.message || 'Unknown'), actions: [] });
      setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
      togglingPush = false;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
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
        {#each [2, 5, 10, 30] as d}
          <button
            class="btn btn-sm"
            class:btn-primary={retentionDays === d}
            class:btn-secondary={retentionDays !== d}
            on:click={() => setRetentionDays(d)}
            disabled={savingRetention}
          >{d} days</button>
        {/each}
      </div>
    </div>

    <hr class="divider" />
    <h4>Push Notifications</h4>
    <div class="form-section">
      {#if pushSupported}
        <label class="toggle-row">
          <span>Enable push notifications</span>
          <button class="toggle-btn" class:on={pushEnabled} on:click={togglePush} disabled={togglingPush}>
            <span class="toggle-knob"></span>
          </button>
        </label>
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
