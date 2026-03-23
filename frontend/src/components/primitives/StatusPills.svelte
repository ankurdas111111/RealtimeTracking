<script>
  import NetworkStateChip from './NetworkStateChip.svelte';

  export let trackingActive = false;
  export let lastAccuracy = null;
  export let latencyMs = null;
  export let isOnline = true;
  export let socketConnected = false;
  export let bufferedCount = 0;
</script>

<div class="status-pills" role="status" aria-live="polite">
  <NetworkStateChip {isOnline} {socketConnected} {bufferedCount} />
  <div class="pill" class:ok={trackingActive} class:warn={!trackingActive}>
    {trackingActive ? 'Tracking On' : 'Tracking Off'}
  </div>
  <div class="pill">
    GPS {#if lastAccuracy != null}~{Math.round(lastAccuracy)}m{:else}--{/if}
  </div>
  {#if latencyMs != null}
    <div class="pill">Latency {Math.round(latencyMs)}ms</div>
  {/if}
</div>

<style>
  .status-pills {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0 2px;
    scrollbar-width: none;
  }

  .status-pills::-webkit-scrollbar {
    display: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--surface-inset, rgba(15, 23, 42, 0.10));
    border: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.15));
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .pill.ok {
    background: rgba(16, 185, 129, 0.14);
    border-color: rgba(16, 185, 129, 0.3);
    color: var(--success-700, #047857);
  }

  .pill.warn {
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(245, 158, 11, 0.32);
    color: var(--warning-700, #b45309);
  }

  :global([data-theme="dark"]) .pill.ok {
    background: rgba(16, 185, 129, 0.18);
    border-color: rgba(52, 211, 153, 0.35);
    color: var(--success-400, #34d399);
  }

  :global([data-theme="dark"]) .pill.warn {
    background: rgba(245, 158, 11, 0.18);
    border-color: rgba(251, 191, 36, 0.35);
    color: var(--warning-400, #fbbf24);
  }
</style>
