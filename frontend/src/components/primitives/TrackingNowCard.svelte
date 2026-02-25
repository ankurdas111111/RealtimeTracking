<script>
  import { createEventDispatcher } from 'svelte';

  export let location = null;
  export let trackingActive = false;
  export let bufferedCount = 0;
  export let socketConnected = false;

  const dispatch = createEventDispatcher();
</script>

<section class="now-card">
  <div class="head">
    <div>
      <h3>Now</h3>
      <p>{trackingActive ? 'Realtime tracking is active' : 'Tracking is paused'}</p>
    </div>
    <button
      class="btn btn-primary toggle"
      class:live={trackingActive}
      on:click={() => dispatch('toggleTracking')}
      aria-pressed={trackingActive}
    >
      {trackingActive ? 'Stop' : 'Start'}
    </button>
  </div>

  {#if location}
    <div class="stats">
      <div class="stat">
        <span>Speed</span>
        <strong>{location.speed || 0} km/h</strong>
      </div>
      <div class="stat">
        <span>Accuracy</span>
        <strong>~{Math.round(location.accuracy || 0)} m</strong>
      </div>
      <div class="stat wide">
        <span>Last update</span>
        <strong>{location.formattedTime || '--'}</strong>
      </div>
    </div>
  {:else}
    <div class="skeleton">
      <div class="line"></div>
      <div class="line short"></div>
    </div>
  {/if}

  <div class="footer">
    <button class="btn btn-secondary" on:click={() => dispatch('centerOnMe')}>Center Me</button>
    <button class="btn btn-secondary" on:click={() => dispatch('toggleFollow')}>Follow</button>
    <span class="meta">
      {#if !socketConnected}
        reconnecting
      {:else if bufferedCount > 0}
        buffered {bufferedCount}
      {:else}
        live
      {/if}
    </span>
  </div>
</section>

<style>
  .now-card {
    background: var(--surface-2, #fff);
    border: 1px solid var(--border-default, #e2e8f0);
    border-radius: 18px;
    padding: 14px;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
    margin-bottom: 12px;
  }

  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  h3 {
    margin: 0;
    font-size: 17px;
  }

  p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }

  .toggle {
    min-width: 82px;
    min-height: 44px;
  }

  .toggle.live {
    background: var(--danger-500, #ef4444);
  }

  .stats {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stat {
    background: var(--surface-secondary, #f8fafc);
    border-radius: 12px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat.wide {
    grid-column: span 2;
  }

  .stat span {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }

  .stat strong {
    font-size: 14px;
  }

  .footer {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .footer .btn {
    min-height: 44px;
  }

  .meta {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    margin-left: auto;
  }

  .skeleton {
    margin-top: 12px;
  }

  .line {
    height: 12px;
    border-radius: 999px;
    background: linear-gradient(90deg, #e2e8f0, #f1f5f9, #e2e8f0);
    background-size: 220% 100%;
    animation: shimmer 1.2s linear infinite;
    margin-bottom: 8px;
  }

  .line.short {
    width: 65%;
  }

  @keyframes shimmer {
    from { background-position: 200% 0; }
    to { background-position: -20% 0; }
  }
</style>
