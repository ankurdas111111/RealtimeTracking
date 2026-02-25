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
    background: rgba(15, 23, 42, 0.14);
    border: 1px solid rgba(15, 23, 42, 0.2);
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .pill.ok {
    background: rgba(16, 185, 129, 0.14);
    border-color: rgba(16, 185, 129, 0.3);
    color: #047857;
  }

  .pill.warn {
    background: rgba(245, 158, 11, 0.16);
    border-color: rgba(245, 158, 11, 0.38);
    color: #b45309;
  }
</style>
