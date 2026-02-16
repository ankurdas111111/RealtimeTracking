<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { socket } from '../lib/socket.js';
  import { banner, myLiveLinks } from '../lib/stores/sos.js';
  import { myRooms, myShareCode, myContactInfo } from '../lib/stores/rooms.js';
  import { myContacts } from '../lib/stores/contacts.js';
  import { myGuardianData } from '../lib/stores/guardians.js';
  import { authUser } from '../lib/stores/auth.js';
  import { otherUsers, focusUser } from '../lib/stores/map.js';

  function locateContact(userId) {
    // Find by userId in otherUsers map
    for (const [sid, u] of $otherUsers) {
      if (u.userId === userId) {
        focusUser.set(sid);
        return;
      }
    }
    // Fallback: set userId and let map resolve
    focusUser.set(userId);
  }

  export let embedded = false;

  const dispatch = createEventDispatcher();

  let roomName = '';
  let joinCode = '';
  let contactCode = '';
  let loading = { createRoom: false, joinRoom: false, addContact: false };
  let showLinkDropdown = false;
  let loadingTimers = {};
  let linkMenuEl;
  let linkMenuButton;

  function withLoading(key, fn) {
    if (loading[key]) return;
    loading = { ...loading, [key]: true };
    fn();
    if (loadingTimers[key]) clearTimeout(loadingTimers[key]);
    loadingTimers[key] = setTimeout(() => clearLoading(key), 8000);
  }

  function clearLoading(key) {
    if (loadingTimers[key]) {
      clearTimeout(loadingTimers[key]);
      delete loadingTimers[key];
    }
    if (!loading[key]) return;
    loading = { ...loading, [key]: false };
  }

  function clearRoomLoading() {
    clearLoading('createRoom');
    clearLoading('joinRoom');
  }

  function clearContactLoading() {
    clearLoading('addContact');
  }

  function createRoom() {
    withLoading('createRoom', () => { socket.emit('createRoom', { name: roomName.trim() }); roomName = ''; });
  }
  function joinRoom() {
    if (!joinCode.trim()) return;
    withLoading('joinRoom', () => { socket.emit('joinRoom', { code: joinCode.trim().toUpperCase() }); joinCode = ''; });
  }
  function addContact() {
    if (!contactCode.trim()) return;
    withLoading('addContact', () => { socket.emit('addContact', { shareCode: contactCode.trim().toUpperCase() }); contactCode = ''; });
  }
  function leaveRoom(code) { socket.emit('leaveRoom', { code }); }
  function removeContact(userId) { socket.emit('removeContact', { userId }); }
  let guardianDurations = {};
  let roomAdminDurations = {};

  function requestAdmin(code) {
    var dur = roomAdminDurations[code] || null;
    socket.emit('requestRoomAdmin', { roomCode: code, expiresIn: dur });
  }
  function revokeAdmin(code, uid) { socket.emit('revokeRoomAdmin', { roomCode: code, userId: uid }); }
  function voteRoomAdmin(code, userId, vote) { socket.emit('voteRoomAdmin', { roomCode: code, userId, vote }); }
  function hasPendingAdminRequest(room) { return (room.pendingAdminRequests || []).some(r => r.isMe); }
  function requestGuardian(userId) {
    var dur = guardianDurations[userId] || null;
    socket.emit('requestGuardian', { contactUserId: userId, expiresIn: dur });
  }
  function inviteGuardian(userId) {
    var dur = guardianDurations[userId] || null;
    socket.emit('inviteGuardian', { contactUserId: userId, expiresIn: dur });
  }

  function isPendingGuardianOf(userId) {
    return $myGuardianData.asGuardian?.some(g => g.wardId === userId && g.status === 'pending');
  }
  function isPendingWardOf(userId) {
    return $myGuardianData.asWard?.some(g => g.guardianId === userId && g.status === 'pending');
  }
  function createLiveLink(dur) {
    socket.emit('createLiveLink', { duration: dur === 'forever' ? null : dur });
    showLinkDropdown = false;
  }
  function copyLink(url) { navigator.clipboard.writeText(url).catch(() => {}); banner.set({ type: 'info', text: 'Link copied!', actions: [] }); setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 1500); }
  function revokeLink(token) { socket.emit('revokeLiveLink', { token }); }

  function isGuardianOf(userId) { return $myGuardianData.asGuardian?.some(g => g.wardId === userId && g.status === 'active'); }
  function isWardOf(userId) { return $myGuardianData.asWard?.some(g => g.guardianId === userId && g.status === 'active'); }
  function toggleLinkDropdown() { showLinkDropdown = !showLinkDropdown; }
  function closeLinkDropdown() { showLinkDropdown = false; }

  function onDocumentClick(e) {
    if (!showLinkDropdown) return;
    if (linkMenuEl && linkMenuEl.contains(e.target)) return;
    if (linkMenuButton && linkMenuButton.contains(e.target)) return;
    closeLinkDropdown();
  }

  function onDocumentKeydown(e) {
    if (e.key === 'Escape' && showLinkDropdown) closeLinkDropdown();
  }

  $: hasAny = ($myRooms.length > 0 || $myContacts.length > 0);

  onMount(() => {
    var onRoomCreated = () => clearRoomLoading();
    var onRoomJoined = () => clearRoomLoading();
    var onRoomError = () => clearRoomLoading();
    var onContactAdded = () => clearContactLoading();
    var onContactError = () => clearContactLoading();
    socket.on('roomCreated', onRoomCreated);
    socket.on('roomJoined', onRoomJoined);
    socket.on('roomError', onRoomError);
    socket.on('contactAdded', onContactAdded);
    socket.on('contactError', onContactError);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeydown);

    return () => {
      socket.off('roomCreated', onRoomCreated);
      socket.off('roomJoined', onRoomJoined);
      socket.off('roomError', onRoomError);
      socket.off('contactAdded', onContactAdded);
      socket.off('contactError', onContactError);
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeydown);
      Object.keys(loadingTimers).forEach((k) => clearTimeout(loadingTimers[k]));
    };
  });
</script>

{#if embedded}
  <div class="panel-body">
    <div class="section">
      <h4>Rooms</h4>
      <div class="input-group">
        <input class="input" bind:value={roomName} placeholder="Room name" />
        <button class="btn btn-primary btn-sm" on:click={createRoom} disabled={loading.createRoom}>{loading.createRoom ? '...' : 'Create'}</button>
      </div>
      <div class="input-group mt-2">
        <input class="input" bind:value={joinCode} placeholder="Room code" on:keydown={e => e.key === 'Enter' && joinRoom()} />
        <button class="btn btn-secondary btn-sm" on:click={joinRoom} disabled={loading.joinRoom}>{loading.joinRoom ? '...' : 'Join'}</button>
      </div>
      <div class="list">
        {#if $myRooms.length === 0}
          <p class="mini list-empty">No rooms yet</p>
        {:else}
          {#each $myRooms as room}
            <div class="list-item">
              <div class="list-item-main">
                <strong>{room.name}</strong> <span class="mini">({room.code})</span>
                {#if room.myRoomRole === 'admin'}<span class="badge badge-success badge-xs">Admin</span>{/if}
                <div class="room-members">
                  {#each (room.members || []) as m}
                    <span class="room-member">
                      <button class="member-locate-btn" on:click={() => locateContact(m.userId)} title="Locate {m.displayName || 'user'} on map">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
                        {m.displayName || m}
                      </button>
                      {#if m.roomRole === 'admin'}<span class="badge badge-success badge-xs">Admin</span>{#if room.myRoomRole === 'admin' && m.userId !== $authUser?.userId} <button class="btn-inline-danger" on:click|stopPropagation={() => revokeAdmin(room.code, m.userId)}>Revoke</button>{/if}{/if}
                    </span>
                  {/each}
                </div>
              </div>
              <div class="list-item-actions">
                {#if room.myRoomRole !== 'admin' && !hasPendingAdminRequest(room)}
                  <select class="duration-select" bind:value={roomAdminDurations[room.code]}>
                    <option value={null}>Permanent</option>
                    <option value="1h">1 Hour</option>
                    <option value="6h">6 Hours</option>
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                    <option value="30d">30 Days</option>
                  </select>
                  <button class="btn btn-secondary btn-sm" on:click={() => requestAdmin(room.code)}>Request Admin</button>
                {:else if hasPendingAdminRequest(room)}
                  <span class="badge badge-warning badge-xs">Admin Requested</span>
                {/if}
                <button class="btn btn-danger btn-sm" on:click={() => leaveRoom(room.code)}>Leave</button>
              </div>
              {#if (room.pendingAdminRequests || []).length > 0}
                <div class="pending-admin-section">
                  {#each room.pendingAdminRequests as par}
                    <div class="pending-admin-item">
                      <div class="pending-admin-info">
                        <span class="text-sm">{par.isMe ? 'Your admin request' : `${par.fromName} wants Admin`}</span>
                        {#if par.expiresIn}<span class="mini"> ({par.expiresIn})</span>{/if}
                        <span class="mini vote-count">{par.approvals}/{par.totalEligible} approve, {par.denials}/{par.totalEligible} deny (need {Math.floor(par.totalEligible / 2) + 1})</span>
                      </div>
                      {#if !par.isMe}
                        <div class="pending-admin-actions">
                          {#if par.myVote === 'approve'}
                            <span class="badge badge-success badge-xs">Approved</span>
                          {:else if par.myVote === 'deny'}
                            <span class="badge badge-danger badge-xs">Denied</span>
                          {:else}
                            <button class="btn btn-primary btn-xs" on:click={() => voteRoomAdmin(room.code, par.from, 'approve')}>Approve</button>
                            <button class="btn btn-danger btn-xs" on:click={() => voteRoomAdmin(room.code, par.from, 'deny')}>Deny</button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h4>Contacts</h4>
      <div class="input-group">
        <input class="input" bind:value={contactCode} placeholder="Share code" on:keydown={e => e.key === 'Enter' && addContact()} />
        <button class="btn btn-primary btn-sm" on:click={addContact} disabled={loading.addContact}>{loading.addContact ? '...' : 'Add'}</button>
      </div>
      <div class="list">
        {#if $myContacts.length === 0}
          <p class="mini list-empty">No contacts yet</p>
        {:else}
          {#each $myContacts as c}
            <div class="list-item">
              <div class="list-item-main">
                <button class="locate-btn" on:click={() => locateContact(c.userId)} title="Locate on map">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
                </button>
                <strong>{c.displayName}</strong>
                {#if isGuardianOf(c.userId)}<span class="badge badge-primary badge-xs">Your Ward</span>{/if}
                {#if isWardOf(c.userId)}<span class="badge badge-primary badge-xs">Your Guardian</span>{/if}
                {#if isPendingGuardianOf(c.userId)}<span class="badge badge-warning badge-xs">Guardian Pending</span>{/if}
                {#if isPendingWardOf(c.userId)}<span class="badge badge-warning badge-xs">Pending Approval</span>{/if}
                <span class="mini">{c.maskedEmail || c.maskedMobile || c.shareCode || ''}</span>
              </div>
              <div class="list-item-actions">
                {#if !isGuardianOf(c.userId) && !isWardOf(c.userId) && !isPendingGuardianOf(c.userId) && !isPendingWardOf(c.userId)}
                  <select class="duration-select" bind:value={guardianDurations[c.userId]}>
                    <option value={null}>Permanent</option>
                    <option value="1h">1 Hour</option>
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                    <option value="30d">30 Days</option>
                  </select>
                  <button class="btn btn-secondary btn-sm" on:click={() => requestGuardian(c.userId)} title="You want to be their guardian">Be Guardian</button>
                  <button class="btn btn-secondary btn-sm" on:click={() => inviteGuardian(c.userId)} title="You want them to be your guardian">Make Guardian</button>
                {/if}
                <button class="btn btn-danger btn-sm" on:click={() => removeContact(c.userId)}>Remove</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h4>Live Links</h4>
      <div class="link-generate">
        <button class="btn btn-primary btn-sm" bind:this={linkMenuButton} on:click={toggleLinkDropdown} aria-haspopup="menu" aria-expanded={showLinkDropdown}>Generate Link</button>
        {#if showLinkDropdown}
          <div class="link-dropdown" bind:this={linkMenuEl} role="menu" aria-label="Live link duration">
            <button class="link-option" role="menuitem" on:click={() => createLiveLink('1h')}>1 Hour</button>
            <button class="link-option" role="menuitem" on:click={() => createLiveLink('6h')}>6 Hours</button>
            <button class="link-option" role="menuitem" on:click={() => createLiveLink('24h')}>24 Hours</button>
            <button class="link-option" role="menuitem" on:click={() => createLiveLink('48h')}>48 Hours</button>
            <button class="link-option" role="menuitem" on:click={() => createLiveLink('forever')}>Until Revoked</button>
          </div>
        {/if}
      </div>
      <div class="list">
        {#if $myLiveLinks.length === 0}
          <p class="mini list-empty">No active links</p>
        {:else}
          {#each $myLiveLinks as link}
            {@const url = window.location.origin + '/#/live/' + link.token}
            <div class="list-item">
              <div class="list-item-main">
                <div class="mini ellipsis">{url}</div>
                <div class="mini">Expires: {link.expiresAt ? new Date(link.expiresAt).toLocaleTimeString() : 'Until revoked'}</div>
              </div>
              <div class="list-item-actions">
                <button class="btn btn-secondary btn-sm" on:click={() => copyLink(url)}>Copy</button>
                <button class="btn btn-danger btn-sm" on:click={() => revokeLink(link.token)}>Revoke</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    {#if !hasAny}
      <div class="onboarding">
        <p>Create a room or add contacts to start sharing your location in real time.</p>
      </div>
    {/if}
  </div>
{:else}
  <div class="panel-shell panel-left panel-base">
    <div class="panel-header">
      <h3>Sharing</h3>
      <button class="btn btn-icon btn-ghost" aria-label="Close sharing panel" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="panel-body">
      <p class="mini">Use the sidebar for sharing controls.</p>
    </div>
  </div>
{/if}

<style>
  .list { margin-top: var(--space-2); }
  .list-empty { padding: var(--space-2) 0; }
  .link-generate { position: relative; }
  .link-dropdown { position: absolute; top: 100%; left: 0; background: var(--surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 100; margin-top: var(--space-1); overflow: hidden; min-width: 160px; }
  .link-option { display: block; width: 100%; padding: var(--space-2) var(--space-4); border: none; background: none; text-align: left; cursor: pointer; font-size: var(--text-sm); color: var(--text-primary); }
  .link-option:hover { background: var(--surface-hover); }
  .link-option:focus-visible { outline: 2px solid var(--primary-500); outline-offset: -2px; }
  .onboarding { padding: var(--space-4); text-align: center; color: var(--text-tertiary); font-size: var(--text-sm); }
  .pending-admin-section {
    width: 100%;
    margin-top: var(--space-2, 8px);
    padding: var(--space-2, 8px) 0 0;
    border-top: 1px dashed var(--border-default, #e0e0e0);
  }
  .pending-admin-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    padding: var(--space-1, 4px) 0;
  }
  .pending-admin-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .pending-admin-actions {
    display: flex;
    gap: var(--space-1, 4px);
    flex-shrink: 0;
  }
  .vote-count {
    color: var(--text-secondary, #888);
  }
  .badge-danger {
    background: var(--danger-500, #ef4444);
    color: #fff;
  }
  .btn-xs {
    font-size: var(--text-2xs, 10px);
    padding: 2px 8px;
    border-radius: var(--radius-sm, 4px);
  }
  .duration-select {
    font-size: var(--text-xs, 12px);
    padding: 2px 6px;
    border: 1px solid var(--border-default, #ddd);
    border-radius: var(--radius-sm, 4px);
    background: var(--surface-1, #fff);
    color: var(--text-primary, #333);
    cursor: pointer;
    max-width: 90px;
  }

  /* ── Locate buttons ──────────────────────────────────────────────── */
  .locate-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary, #999);
    padding: 2px;
    border-radius: var(--radius-sm, 4px);
    transition: color 0.15s ease, background 0.15s ease;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .locate-btn:hover {
    color: var(--primary-500);
    background: var(--surface-inset, rgba(0,0,0,0.04));
  }

  /* ── Room members ────────────────────────────────────────────────── */
  .room-members {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin-top: 4px;
    font-size: var(--text-xs, 12px);
    color: var(--text-secondary, #666);
  }
  .room-member {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .member-locate-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-secondary, #666);
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    font: inherit;
    font-size: var(--text-xs, 12px);
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    line-height: 1.3;
  }
  .member-locate-btn:hover {
    color: var(--primary-600, #2563eb);
    background: var(--surface-inset, rgba(0,0,0,0.04));
    border-color: var(--primary-200, #bfdbfe);
  }
  .member-locate-btn svg {
    flex-shrink: 0;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }
  .member-locate-btn:hover svg {
    opacity: 1;
  }
</style>
