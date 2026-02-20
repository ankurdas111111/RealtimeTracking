<script>
  import { createEventDispatcher } from 'svelte';
  import { myLocation, tracking } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';
  import { myShareCode, myContactInfo } from '../lib/stores/rooms.js';
  import { socket } from '../lib/socket.js';
  import { banner, mySosActive } from '../lib/stores/sos.js';
  import { myGuardianData, pendingIncomingRequests } from '../lib/stores/guardians.js';
  import { formatCoordinate } from '../lib/tracking.js';
  import { trackingMetrics } from '../lib/stores/metrics.js';
  import { latencyMetrics } from '../lib/stores/latency.js';

  export let embedded = false;
  let statsOpen = false;

  const dispatch = createEventDispatcher();

  let keep48Toggle = false;

  function toggleSOS() {
    if (!$mySosActive) socket.emit('triggerSOS', { reason: 'SOS' });
    else socket.emit('cancelSOS');
  }

  function checkIn() {
    socket.emit('checkInAck');
    banner.set({ type: 'info', text: 'Check-in sent.', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  }

  function setRetention() {
    socket.emit('setRetention', { mode: keep48Toggle ? '48h' : 'default' });
    banner.set({ type: 'info', text: keep48Toggle ? 'Will keep location for 48h after disconnect.' : 'Location removed on disconnect.', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  }

  function copyShareCode() {
    navigator.clipboard.writeText($myShareCode).catch(() => {});
    banner.set({ type: 'info', text: 'Share code copied!', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 1500);
  }

  function approveRequest(req, idx) {
    if (req.type === 'roomAdmin') {
      socket.emit('voteRoomAdmin', { roomCode: req.roomCode, userId: req.from, vote: 'approve' });
    } else if (req.type === 'guardianInvite') {
      socket.emit('approveGuardian', { wardUserId: req.from });
    } else {
      socket.emit('approveGuardian', { guardianUserId: req.from });
    }
    pendingIncomingRequests.update(arr => {
      if (req.type === 'roomAdmin') {
        return arr.map((r, i) => i === idx ? { ...r, myVote: 'approve' } : r);
      }
      arr.splice(idx, 1); return [...arr];
    });
  }

  function denyRequest(req, idx) {
    if (req.type === 'roomAdmin') {
      socket.emit('voteRoomAdmin', { roomCode: req.roomCode, userId: req.from, vote: 'deny' });
    } else if (req.type === 'guardianInvite') {
      socket.emit('denyGuardian', { wardUserId: req.from });
    } else {
      socket.emit('denyGuardian', { guardianUserId: req.from });
    }
    pendingIncomingRequests.update(arr => {
      if (req.type === 'roomAdmin') {
        return arr.map((r, i) => i === idx ? { ...r, myVote: 'deny' } : r);
      }
      arr.splice(idx, 1); return [...arr];
    });
  }

  function revokeGuardian(wardId, guardianId) {
    if (wardId) socket.emit('revokeGuardian', { wardUserId: wardId });
    else if (guardianId) socket.emit('revokeGuardian', { guardianUserId: guardianId });
  }

  function getRequestLabel(req) {
    if (req.type === 'roomAdmin') return `${req.fromName || 'Someone'} wants Admin in ${req.roomCode}`;
    if (req.type === 'guardianInvite') return `${req.fromName || 'Someone'} wants you to be their Guardian`;
    return `${req.fromName || 'Someone'} wants to be your Guardian`;
  }
</script>

{#if embedded}
  <div class="panel-body">
    <div class="section">
      <h4>Your Location</h4>
      {#if $myLocation}
        <div class="metric-grid">
          <div class="metric-card"><span class="metric-label">Latitude</span><span class="metric-value">{formatCoordinate($myLocation.latitude)}</span></div>
          <div class="metric-card"><span class="metric-label">Longitude</span><span class="metric-value">{formatCoordinate($myLocation.longitude)}</span></div>
          <div class="metric-card"><span class="metric-label">Speed</span><span class="metric-value">{$myLocation.speed || '0'} km/h</span></div>
          <div class="metric-card"><span class="metric-label">Updated</span><span class="metric-value">{$myLocation.formattedTime || '-'}</span></div>
        </div>
      {:else}
        <p class="text-sm text-muted">Start tracking to see your location.</p>
      {/if}

      {#if $tracking && $trackingMetrics.fixCount > 0}
        <button class="tracking-stats-toggle" on:click={() => statsOpen = !statsOpen}>
          <span class="accuracy-dot" class:green={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy <= 15} class:yellow={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy > 15 && $trackingMetrics.lastAccuracy <= 50} class:red={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy > 50}></span>
          GPS {$trackingMetrics.lastAccuracy != null ? `~${$trackingMetrics.lastAccuracy}m` : '...'} &middot; {$trackingMetrics.filterState}
          {#if $latencyMetrics.avgE2eMs != null} &middot; {$latencyMetrics.avgE2eMs}ms{/if}
          <svg class="chevron" class:open={statsOpen} xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {#if statsOpen}
          <div class="tracking-stats">
            <div class="stat-row"><span>Accuracy</span><span>{$trackingMetrics.lastAccuracy ?? '-'}m (avg {$trackingMetrics.avgAccuracy ?? '-'}m)</span></div>
            <div class="stat-row"><span>Fixes</span><span>{$trackingMetrics.fixCount}</span></div>
            <div class="stat-row"><span>Rate</span><span>{$trackingMetrics.updatesPerSec}/s</span></div>
            <div class="stat-row"><span>Kalman</span><span>{$trackingMetrics.kalmanCorrectionM}m correction</span></div>
            <div class="stat-row"><span>Filter</span><span>{$trackingMetrics.filterState}</span></div>
            {#if $latencyMetrics.lastE2eMs != null}
              <div class="stat-row"><span>E2E Latency</span><span class="latency-value" class:latency-good={$latencyMetrics.lastE2eMs < 300} class:latency-ok={$latencyMetrics.lastE2eMs >= 300 && $latencyMetrics.lastE2eMs < 800} class:latency-bad={$latencyMetrics.lastE2eMs >= 800}>{$latencyMetrics.lastE2eMs}ms (avg {$latencyMetrics.avgE2eMs}ms)</span></div>
            {/if}
            {#if $latencyMetrics.lastServerHopMs != null}
              <div class="stat-row"><span>Server Hop</span><span>{$latencyMetrics.lastServerHopMs}ms</span></div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <hr class="divider" />

    <div class="section">
      <h4>Your Share Code</h4>
      <div class="code-row">
        <span class="code-value text-mono">{$myShareCode || '...'}</span>
        <button class="btn btn-sm btn-secondary" on:click={copyShareCode}>Copy</button>
      </div>
      {#if $myContactInfo.email || $myContactInfo.mobile}
        <div class="mini mt-1">
          {#if $myContactInfo.email}Email: <strong>{$myContactInfo.email}</strong>{/if}
          {#if $myContactInfo.mobile} | Mobile: <strong>{$myContactInfo.mobile}</strong>{/if}
        </div>
      {/if}
    </div>

    <hr class="divider" />

    <div class="section">
      <h4>Safety</h4>
      <div class="flex-row-wrap">
        <button class="btn" class:btn-danger={!$mySosActive} class:btn-secondary={$mySosActive} on:click={toggleSOS}>
          {$mySosActive ? 'Cancel SOS' : 'SOS'}
        </button>
        <button class="btn btn-secondary" on:click={checkIn}>I'm OK</button>
      </div>
      <label class="toggle mt-3">
        <input type="checkbox" bind:checked={keep48Toggle} on:change={setRetention}>
        <span class="toggle-track"></span>
        Keep location 48h
      </label>
    </div>

    {#if $pendingIncomingRequests.length > 0}
      <hr class="divider" />
      <div class="section">
        <h4>Pending Requests <span class="badge badge-warning">{$pendingIncomingRequests.length}</span></h4>
        {#each $pendingIncomingRequests as req, idx}
          <div class="request-item">
            <div class="text-sm">
              {getRequestLabel(req)}
              {#if req.expiresIn}<span class="mini"> ({req.expiresIn})</span>{/if}
            </div>
            {#if req.type === 'roomAdmin'}
              <div class="vote-info mini">
                Votes: {req.approvals || 0} approve / {req.denials || 0} deny (need {Math.floor((req.totalEligible || 1) / 2) + 1} of {req.totalEligible || '?'})
              </div>
              <div class="request-actions">
                {#if req.myVote === 'approve'}
                  <span class="badge badge-success badge-xs">You approved</span>
                {:else if req.myVote === 'deny'}
                  <span class="badge badge-danger badge-xs">You denied</span>
                {:else}
                  <button class="btn btn-primary btn-sm" on:click={() => approveRequest(req, idx)}>Approve</button>
                  <button class="btn btn-danger btn-sm" on:click={() => denyRequest(req, idx)}>Deny</button>
                {/if}
              </div>
            {:else}
              <div class="request-actions">
                <button class="btn btn-primary btn-sm" on:click={() => approveRequest(req, idx)}>Approve</button>
                <button class="btn btn-danger btn-sm" on:click={() => denyRequest(req, idx)}>Deny</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if $myGuardianData.asGuardian.length > 0 || $myGuardianData.asWard.length > 0}
      <hr class="divider" />
      <div class="section">
        <h4>Guardian Relationships</h4>
        {#each $myGuardianData.asGuardian as g}
          <div class="guardian-item">
            <div>
              <strong>Guardian of:</strong> {g.wardName}
              <span class="badge" class:badge-success={g.status === 'active'} class:badge-warning={g.status !== 'active'}>{g.status}</span>
              <span class="mini">{g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleString()}` : 'permanent'}</span>
            </div>
            <div class="guardian-actions">
              {#if g.status === 'pending' && g.initiatedBy === 'ward'}
                <button class="btn btn-primary btn-sm" on:click={() => socket.emit('approveGuardian', { wardUserId: g.wardId })}>Accept</button>
                <button class="btn btn-danger btn-sm" on:click={() => socket.emit('denyGuardian', { wardUserId: g.wardId })}>Decline</button>
              {:else if g.status === 'active'}
                <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(g.wardId, null)}>Revoke</button>
              {:else if g.status === 'pending'}
                <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(g.wardId, null)}>Cancel</button>
              {/if}
            </div>
          </div>
        {/each}
        {#each $myGuardianData.asWard as g}
          <div class="guardian-item">
            <div>
              <strong>My Guardian:</strong> {g.guardianName}
              <span class="badge" class:badge-success={g.status === 'active'} class:badge-warning={g.status !== 'active'}>{g.status}</span>
              <span class="mini">{g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleString()}` : 'permanent'}</span>
            </div>
            <div class="guardian-actions">
              {#if g.status === 'pending' && g.initiatedBy === 'guardian'}
                <button class="btn btn-primary btn-sm" on:click={() => socket.emit('approveGuardian', { guardianUserId: g.guardianId })}>Accept</button>
                <button class="btn btn-danger btn-sm" on:click={() => socket.emit('denyGuardian', { guardianUserId: g.guardianId })}>Decline</button>
              {:else if g.status === 'active'}
                <span class="mini text-muted">Only your guardian can end this</span>
              {:else if g.status === 'pending' && g.initiatedBy === 'ward'}
                <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(null, g.guardianId)}>Cancel</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="panel-shell panel-left panel-base">
    <div class="panel-header">
      <h3>Info</h3>
      <button class="btn btn-icon btn-ghost" aria-label="Close info panel" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <div class="panel-body">
      <div class="section">
        <h4>Your Location</h4>
        {#if $myLocation}
          <div class="metric-grid">
            <div class="metric-card"><span class="metric-label">Latitude</span><span class="metric-value">{formatCoordinate($myLocation.latitude)}</span></div>
            <div class="metric-card"><span class="metric-label">Longitude</span><span class="metric-value">{formatCoordinate($myLocation.longitude)}</span></div>
            <div class="metric-card"><span class="metric-label">Speed</span><span class="metric-value">{$myLocation.speed || '0'} km/h</span></div>
            <div class="metric-card"><span class="metric-label">Updated</span><span class="metric-value">{$myLocation.formattedTime || '-'}</span></div>
          </div>
        {:else}
          <p class="text-sm text-muted">Start tracking to see your location.</p>
        {/if}

        {#if $tracking && $trackingMetrics.fixCount > 0}
          <button class="tracking-stats-toggle" on:click={() => statsOpen = !statsOpen}>
            <span class="accuracy-dot" class:green={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy <= 15} class:yellow={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy > 15 && $trackingMetrics.lastAccuracy <= 50} class:red={$trackingMetrics.lastAccuracy != null && $trackingMetrics.lastAccuracy > 50}></span>
            GPS {$trackingMetrics.lastAccuracy != null ? `~${$trackingMetrics.lastAccuracy}m` : '...'} &middot; {$trackingMetrics.filterState}
            {#if $latencyMetrics.avgE2eMs != null} &middot; {$latencyMetrics.avgE2eMs}ms{/if}
            <svg class="chevron" class:open={statsOpen} xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {#if statsOpen}
            <div class="tracking-stats">
              <div class="stat-row"><span>Accuracy</span><span>{$trackingMetrics.lastAccuracy ?? '-'}m (avg {$trackingMetrics.avgAccuracy ?? '-'}m)</span></div>
              <div class="stat-row"><span>Fixes</span><span>{$trackingMetrics.fixCount}</span></div>
              <div class="stat-row"><span>Rate</span><span>{$trackingMetrics.updatesPerSec}/s</span></div>
              <div class="stat-row"><span>Kalman</span><span>{$trackingMetrics.kalmanCorrectionM}m correction</span></div>
              <div class="stat-row"><span>Filter</span><span>{$trackingMetrics.filterState}</span></div>
              {#if $latencyMetrics.lastE2eMs != null}
                <div class="stat-row"><span>E2E Latency</span><span class="latency-value" class:latency-good={$latencyMetrics.lastE2eMs < 300} class:latency-ok={$latencyMetrics.lastE2eMs >= 300 && $latencyMetrics.lastE2eMs < 800} class:latency-bad={$latencyMetrics.lastE2eMs >= 800}>{$latencyMetrics.lastE2eMs}ms (avg {$latencyMetrics.avgE2eMs}ms)</span></div>
              {/if}
              {#if $latencyMetrics.lastServerHopMs != null}
                <div class="stat-row"><span>Server Hop</span><span>{$latencyMetrics.lastServerHopMs}ms</span></div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
      <hr class="divider" />
      <div class="section">
        <h4>Your Share Code</h4>
        <div class="code-row">
          <span class="code-value text-mono">{$myShareCode || '...'}</span>
          <button class="btn btn-sm btn-secondary" on:click={copyShareCode}>Copy</button>
        </div>
      </div>
      <hr class="divider" />
      <div class="section">
        <h4>Safety</h4>
        <div class="flex-row-wrap">
          <button class="btn" class:btn-danger={!$mySosActive} class:btn-secondary={$mySosActive} on:click={toggleSOS}>
            {$mySosActive ? 'Cancel SOS' : 'SOS'}
          </button>
          <button class="btn btn-secondary" on:click={checkIn}>I'm OK</button>
        </div>
        <label class="toggle mt-3">
          <input type="checkbox" bind:checked={keep48Toggle} on:change={setRetention}>
          <span class="toggle-track"></span>
          Keep location 48h
        </label>
      </div>

      {#if $pendingIncomingRequests.length > 0}
        <hr class="divider" />
        <div class="section">
          <h4>Pending Requests <span class="badge badge-warning">{$pendingIncomingRequests.length}</span></h4>
          {#each $pendingIncomingRequests as req, idx}
            <div class="request-item">
              <div class="text-sm">
                {getRequestLabel(req)}
                {#if req.expiresIn}<span class="mini"> ({req.expiresIn})</span>{/if}
              </div>
              {#if req.type === 'roomAdmin'}
                <div class="vote-info mini">
                  Votes: {req.approvals || 0} approve / {req.denials || 0} deny (need {Math.floor((req.totalEligible || 1) / 2) + 1} of {req.totalEligible || '?'})
                </div>
                <div class="request-actions">
                  {#if req.myVote === 'approve'}
                    <span class="badge badge-success badge-xs">You approved</span>
                  {:else if req.myVote === 'deny'}
                    <span class="badge badge-danger badge-xs">You denied</span>
                  {:else}
                    <button class="btn btn-primary btn-sm" on:click={() => approveRequest(req, idx)}>Approve</button>
                    <button class="btn btn-danger btn-sm" on:click={() => denyRequest(req, idx)}>Deny</button>
                  {/if}
                </div>
              {:else}
                <div class="request-actions">
                  <button class="btn btn-primary btn-sm" on:click={() => approveRequest(req, idx)}>Approve</button>
                  <button class="btn btn-danger btn-sm" on:click={() => denyRequest(req, idx)}>Deny</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if $myGuardianData.asGuardian.length > 0 || $myGuardianData.asWard.length > 0}
        <hr class="divider" />
        <div class="section">
          <h4>Guardian Relationships</h4>
          {#each $myGuardianData.asGuardian as g}
            <div class="guardian-item">
              <div>
                <strong>Guardian of:</strong> {g.wardName}
                <span class="badge" class:badge-success={g.status === 'active'} class:badge-warning={g.status !== 'active'}>{g.status}</span>
                <span class="mini">{g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleString()}` : 'permanent'}</span>
              </div>
              <div class="guardian-actions">
                {#if g.status === 'pending' && g.initiatedBy === 'ward'}
                  <button class="btn btn-primary btn-sm" on:click={() => socket.emit('approveGuardian', { wardUserId: g.wardId })}>Accept</button>
                  <button class="btn btn-danger btn-sm" on:click={() => socket.emit('denyGuardian', { wardUserId: g.wardId })}>Decline</button>
                {:else if g.status === 'active'}
                  <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(g.wardId, null)}>Revoke</button>
                {:else if g.status === 'pending'}
                  <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(g.wardId, null)}>Cancel</button>
                {/if}
              </div>
            </div>
          {/each}
          {#each $myGuardianData.asWard as g}
            <div class="guardian-item">
              <div>
                <strong>My Guardian:</strong> {g.guardianName}
                <span class="badge" class:badge-success={g.status === 'active'} class:badge-warning={g.status !== 'active'}>{g.status}</span>
                <span class="mini">{g.expiresAt ? `until ${new Date(g.expiresAt).toLocaleString()}` : 'permanent'}</span>
              </div>
              <div class="guardian-actions">
                {#if g.status === 'pending' && g.initiatedBy === 'guardian'}
                  <button class="btn btn-primary btn-sm" on:click={() => socket.emit('approveGuardian', { guardianUserId: g.guardianId })}>Accept</button>
                  <button class="btn btn-danger btn-sm" on:click={() => socket.emit('denyGuardian', { guardianUserId: g.guardianId })}>Decline</button>
                {:else if g.status === 'active'}
                  <span class="mini text-muted">Only your guardian can end this</span>
                {:else if g.status === 'pending' && g.initiatedBy === 'ward'}
                  <button class="btn btn-danger btn-sm" on:click={() => revokeGuardian(null, g.guardianId)}>Cancel</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tracking-stats-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 0;
    font-size: var(--text-xs, 12px);
    color: var(--text-secondary, #666);
    width: 100%;
    text-align: left;
  }
  .tracking-stats-toggle:hover {
    color: var(--text-primary, #333);
  }
  .accuracy-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gray-400, #aaa);
    flex-shrink: 0;
  }
  .accuracy-dot.green { background: var(--success-500, #22c55e); }
  .accuracy-dot.yellow { background: var(--warning-500, #eab308); }
  .accuracy-dot.red { background: var(--danger-500, #ef4444); }
  .chevron {
    margin-left: auto;
    transition: transform 0.15s ease;
  }
  .chevron.open {
    transform: rotate(180deg);
  }
  .tracking-stats {
    padding: 4px 0 2px 14px;
    font-size: var(--text-2xs, 10px);
    color: var(--text-secondary, #666);
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    padding: 1px 0;
  }
  .stat-row span:first-child {
    font-weight: 600;
  }
  .vote-info {
    padding: 2px 0;
    color: var(--text-secondary, #666);
  }
  .guardian-actions {
    display: flex;
    gap: var(--space-1, 4px);
    margin-top: var(--space-1, 4px);
  }
  .badge-danger {
    background: var(--danger-500, #ef4444);
    color: #fff;
  }
  .latency-good { color: var(--success-500, #22c55e); font-weight: 600; }
  .latency-ok { color: var(--warning-500, #eab308); font-weight: 600; }
  .latency-bad { color: var(--danger-500, #ef4444); font-weight: 600; }

</style>
