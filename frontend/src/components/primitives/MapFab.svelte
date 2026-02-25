<script>
  import { createEventDispatcher } from 'svelte';

  export let isTracking = false;
  export let followMode = false;

  const dispatch = createEventDispatcher();
</script>

<div class="fab-cluster" role="group" aria-label="Map controls">
  <!-- Secondary: center-on-me -->
  <button
    class="fab fab--secondary"
    on:click={() => dispatch('centerOnMe')}
    title="Center on my location"
    aria-label="Center on my location"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
    </svg>
  </button>

  <!-- Secondary: follow-mode -->
  <button
    class="fab fab--secondary"
    class:follow-active={followMode}
    on:click={() => dispatch('toggleFollow')}
    title={followMode ? 'Exit follow mode' : 'Follow my location'}
    aria-label={followMode ? 'Exit follow mode' : 'Follow my location'}
    aria-pressed={followMode}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {#if followMode}
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      {:else}
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      {/if}
    </svg>
  </button>

  <!-- Primary: tracking toggle -->
  <button
    class="fab fab--primary"
    class:tracking={isTracking}
    on:click={() => dispatch('toggleTracking')}
    title={isTracking ? 'Stop sharing location' : 'Share my location'}
    aria-label={isTracking ? 'Stop sharing location' : 'Share my location'}
    aria-pressed={isTracking}
  >
    {#if isTracking}
      <!-- Stop icon -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>
    {:else}
      <!-- Location pin icon -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    {/if}
  </button>
</div>

<style>
  .fab-cluster {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .fab {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    border-radius: 50%;
    transition:
      transform var(--dur-fast, 150ms) var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1)),
      box-shadow var(--dur-normal, 250ms) var(--ease-out, ease-out),
      background var(--dur-fast, 150ms);
    -webkit-tap-highlight-color: transparent;
  }

  .fab:active {
    transform: scale(0.93) !important;
  }

  /* Primary FAB — 56px, violet gradient */
  .fab--primary {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, var(--primary-500, #6366f1) 0%, var(--primary-700, #4338ca) 100%);
    color: #ffffff;
    box-shadow:
      0 4px 20px rgba(99, 102, 241, 0.50),
      0 0 0 1px rgba(99, 102, 241, 0.20);
  }

  .fab--primary:hover {
    transform: scale(1.05);
    box-shadow:
      0 6px 28px rgba(99, 102, 241, 0.65),
      0 0 0 1px rgba(99, 102, 241, 0.30);
  }

  /* Tracking active — red breathing */
  .fab--primary.tracking {
    background: linear-gradient(135deg, var(--danger-500, #ef4444) 0%, #b91c1c 100%);
    box-shadow:
      0 4px 20px rgba(239, 68, 68, 0.55),
      0 0 0 1px rgba(239, 68, 68, 0.25);
    animation: track-breathe 3s ease-in-out infinite;
  }

  @keyframes track-breathe {
    0%, 100% {
      box-shadow: 0 4px 20px rgba(239,68,68,0.55), 0 0 0 1px rgba(239,68,68,0.25);
    }
    50% {
      box-shadow: 0 4px 32px rgba(239,68,68,0.85), 0 0 0 6px rgba(239,68,68,0.12);
    }
  }

  /* Secondary FABs — 40px glass */
  .fab--secondary {
    width: 44px;
    height: 44px;
    background: var(--glass-1, rgba(255,255,255,0.85));
    backdrop-filter: var(--blur-sm, blur(16px));
    -webkit-backdrop-filter: var(--blur-sm, blur(16px));
    color: var(--text-secondary);
    box-shadow: var(--shadow-glass-sm, 0 2px 12px rgba(0,0,0,0.10)), 0 0 0 1px var(--glass-border, rgba(255,255,255,0.6));
  }

  .fab--secondary:hover {
    transform: scale(1.08);
    color: var(--primary-500, #6366f1);
    background: var(--glass-2, rgba(255,255,255,0.95));
  }

  .fab--secondary.follow-active {
    color: var(--primary-500, #6366f1);
    background: rgba(99, 102, 241, 0.12);
    box-shadow: 0 2px 12px rgba(99,102,241,0.25), 0 0 0 1px rgba(99,102,241,0.30);
  }

  @media (prefers-reduced-motion: reduce) {
    .fab,
    .fab--primary.tracking {
      animation: none;
      transition: none;
    }
  }
</style>
