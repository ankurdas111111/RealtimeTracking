<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { socket } from '../lib/socket.js';
  import { otherUsers } from '../lib/stores/map.js';
  import { authUser } from '../lib/stores/auth.js';
  import { historyPoints, historyLoading, historyTarget, historyDate, historyVisible, historyPlayback } from '../lib/stores/history.js';
  import { myContacts } from '../lib/stores/contacts.js';

  export let embedded = false;

  const dispatch = createEventDispatcher();

  let selectedUserId = '';
  let dateInput = $historyDate;
  let playTimer = null;

  $: visibleUsers = buildUserList($otherUsers, $myContacts, $authUser);

  function buildUserList(others, contacts, auth) {
    const list = [];
    if (auth) list.push({ id: auth.userId, name: 'Me' });
    for (const u of others.values()) {
      if (u.userId) list.push({ id: u.userId, name: u.displayName || u.userId.slice(0, 6) });
    }
    return list;
  }

  function fetchHistory() {
    if (!selectedUserId) return;
    const d = new Date(dateInput);
    const start = d.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    historyLoading.set(true);
    historyTarget.set(selectedUserId);
    historyDate.set(dateInput);
    socket.emit('getHistory', { userId: selectedUserId, start, end }, (res) => {
      historyLoading.set(false);
      if (res && res.ok) {
        historyPoints.set(res.points || []);
        historyVisible.set(true);
        historyPlayback.set({ playing: false, index: 0, speed: 1 });
      } else {
        historyPoints.set([]);
      }
    });
  }

  function clearHistory() {
    historyVisible.set(false);
    historyPoints.set([]);
    historyPlayback.set({ playing: false, index: 0, speed: 1 });
    stopPlayback();
  }

  function togglePlayback() {
    historyPlayback.update(p => {
      if (p.playing) {
        stopPlayback();
        return { ...p, playing: false };
      }
      startPlayback();
      return { ...p, playing: true };
    });
  }

  function startPlayback() {
    stopPlayback();
    playTimer = setInterval(() => {
      historyPlayback.update(p => {
        const pts = $historyPoints;
        if (p.index >= pts.length - 1) {
          stopPlayback();
          return { ...p, playing: false, index: pts.length - 1 };
        }
        return { ...p, index: p.index + 1 };
      });
    }, 200);
  }

  function stopPlayback() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
  }

  function onSlider(e) {
    const val = parseInt(e.target.value, 10);
    historyPlayback.update(p => ({ ...p, index: val }));
  }

  function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onDestroy(() => stopPlayback());
</script>

{#if embedded}
  <div class="panel-body history-panel">
    <h4>Location History</h4>

    <div class="history-controls">
      <label class="field-label">
        User
        <select bind:value={selectedUserId} class="field-input">
          <option value="">Select user...</option>
          {#each visibleUsers as u}
            <option value={u.id}>{u.name}</option>
          {/each}
        </select>
      </label>

      <label class="field-label">
        Date
        <input type="date" bind:value={dateInput} class="field-input" />
      </label>

      <div class="history-actions">
        <button class="btn btn-primary btn-sm" on:click={fetchHistory} disabled={!selectedUserId || $historyLoading}>
          {$historyLoading ? 'Loading...' : 'Show Trail'}
        </button>
        {#if $historyVisible}
          <button class="btn btn-secondary btn-sm" on:click={clearHistory}>Clear</button>
        {/if}
      </div>
    </div>

    {#if $historyVisible && $historyPoints.length > 0}
      <hr class="divider" />
      <div class="history-stats">
        <div class="stat-row">
          <span class="stat-label">Points</span>
          <span class="stat-value">{$historyPoints.length}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">From</span>
          <span class="stat-value">{formatTime($historyPoints[0]?.t)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">To</span>
          <span class="stat-value">{formatTime($historyPoints[$historyPoints.length - 1]?.t)}</span>
        </div>
      </div>

      <hr class="divider" />
      <h4>Playback</h4>
      <div class="playback-controls">
        <button class="btn btn-sm" class:btn-primary={!$historyPlayback.playing} class:btn-secondary={$historyPlayback.playing} on:click={togglePlayback}>
          {$historyPlayback.playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min="0"
          max={Math.max(0, $historyPoints.length - 1)}
          value={$historyPlayback.index}
          on:input={onSlider}
          class="playback-slider"
        />
        <span class="playback-time">{formatTime($historyPoints[$historyPlayback.index]?.t)}</span>
      </div>
      {#if $historyPoints[$historyPlayback.index]}
        <div class="playback-info">
          <span>Speed: {$historyPoints[$historyPlayback.index].speed?.toFixed(1) || '0'} km/h</span>
        </div>
      {/if}
    {:else if $historyVisible}
      <div class="empty-state">No history data for this date.</div>
    {/if}
  </div>
{:else}
  <div class="panel-shell panel-left panel-base">
    <div class="panel-header">
      <h3>Location History</h3>
      <button class="panel-close" on:click={() => dispatch('close')} aria-label="Close">&times;</button>
    </div>
    <div class="panel-body">
      <p>Use the sidebar History tab to view location trails.</p>
    </div>
  </div>
{/if}

<style>
  .history-panel { padding: 0; }

  h4 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary, #666);
    margin: 12px 0 8px;
    padding: 0 16px;
  }

  .history-controls {
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

  .history-actions {
    display: flex;
    gap: 8px;
  }

  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
    min-height: 32px;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border-primary, #eee);
    margin: 8px 0;
  }

  .history-stats {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 2px 0;
  }

  .stat-label { color: var(--text-secondary, #666); }
  .stat-value { font-weight: 600; color: var(--text-primary, #111); }

  .playback-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 8px;
  }

  .playback-slider {
    flex: 1;
    accent-color: var(--primary-500, #3b82f6);
    height: 4px;
  }

  .playback-time {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #666);
    min-width: 50px;
    text-align: right;
  }

  .playback-info {
    padding: 0 16px 12px;
    font-size: 12px;
    color: var(--text-secondary, #666);
  }

  .empty-state {
    padding: 20px 16px;
    text-align: center;
    font-size: 13px;
    color: var(--text-tertiary, #999);
  }
</style>
