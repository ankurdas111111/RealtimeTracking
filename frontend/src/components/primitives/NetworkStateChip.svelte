<script>
  export let isOnline = true;
  export let socketConnected = false;
  export let bufferedCount = 0;
</script>

<div class="network-chip" class:offline={!isOnline || !socketConnected}>
  <span class="dot" aria-hidden="true"></span>
  <span class="label">
    {#if !isOnline}
      Offline
    {:else if !socketConnected}
      Reconnecting
    {:else}
      Live
    {/if}
  </span>
  {#if bufferedCount > 0}
    <span class="buffered">buffering {bufferedCount}</span>
  {/if}
</div>

<style>
  .network-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: var(--success-700, #047857);
    font-size: 11px;
    font-weight: 600;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .network-chip.offline {
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(245, 158, 11, 0.32);
    color: var(--warning-700, #b45309);
  }

  :global([data-theme="dark"]) .network-chip {
    background: rgba(16, 185, 129, 0.18);
    border-color: rgba(52, 211, 153, 0.35);
    color: var(--success-400, #34d399);
  }

  :global([data-theme="dark"]) .network-chip.offline {
    background: rgba(245, 158, 11, 0.18);
    border-color: rgba(251, 191, 36, 0.35);
    color: var(--warning-400, #fbbf24);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .buffered {
    font-weight: 500;
    opacity: 0.9;
  }
</style>
