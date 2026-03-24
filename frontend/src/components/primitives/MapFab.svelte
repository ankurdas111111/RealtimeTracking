<script>
  import { createEventDispatcher } from 'svelte';
  import { haptics } from '../../lib/haptics.js';

  export let isTracking = false;
  export let followMode = false;

  const dispatch = createEventDispatcher();
</script>

<div class="fab-cluster" role="group" aria-label="Map controls">
  <!-- Secondary: center-on-me -->
  <button
    class="fab fab--secondary"
    on:click={() => { haptics.tap(); dispatch('centerOnMe'); }}
    title="Center map on me"
    aria-label="Center map on me"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 21s-6-4.3-6-9a6 6 0 1 1 12 0c0 4.7-6 9-6 9z"/>
      <circle cx="12" cy="12" r="2.5"/>
    </svg>
  </button>

  <!-- Secondary: follow-mode -->
  <button
    class="fab fab--secondary"
    class:follow-active={followMode}
    on:click={() => { haptics.tap(); dispatch('toggleFollow'); }}
    title={followMode ? 'Stop following me' : 'Follow me automatically'}
    aria-label={followMode ? 'Stop following me' : 'Follow me automatically'}
    aria-pressed={followMode}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="3"/>
      <path d="M6.5 19a5.5 5.5 0 0 1 11 0"/>
      {#if followMode}
        <path d="m17 6 1.7 1.7L22 4.4"/>
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

  /* Primary FAB — 56px, blue gradient */
  .fab--primary {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-700) 100%);
    color: #ffffff;
    box-shadow:
      0 4px 20px rgba(37, 99, 235, 0.50),
      0 0 0 1px rgba(59, 130, 246, 0.20);
  }

  .fab--primary:hover {
    transform: scale(1.05);
    box-shadow:
      0 6px 28px rgba(37, 99, 235, 0.65),
      0 0 0 1px rgba(59, 130, 246, 0.30);
  }

  /* Tracking active — red breathing */
  .fab--primary.tracking {
    background: linear-gradient(135deg, var(--danger-500, #ef4444) 0%, var(--danger-700, #b91c1c) 100%);
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

  /* Secondary FABs — 44px glass */
  .fab--secondary {
    width: 44px;
    height: 44px;
    background: var(--glass-bg, rgba(255,255,255,0.85));
    backdrop-filter: var(--glass-blur-sm, blur(12px) saturate(1.4));
    -webkit-backdrop-filter: var(--glass-blur-sm, blur(12px) saturate(1.4));
    color: var(--text-secondary);
    box-shadow: var(--map-chip-shadow, 0 2px 12px rgba(0,0,0,0.10)), 0 0 0 1px var(--glass-border, rgba(15,23,42,0.10));
  }

  .fab--secondary:hover {
    transform: scale(1.08);
    color: var(--primary-500);
    background: var(--glass-bg-strong, rgba(255,255,255,0.95));
  }

  .fab--secondary.follow-active {
    color: var(--primary-500);
    background: rgba(37, 99, 235, 0.10);
    box-shadow: 0 2px 12px rgba(37, 99, 235, 0.25), 0 0 0 1px rgba(59, 130, 246, 0.30);
  }

  :global([data-theme="dark"]) .fab--secondary {
    background: rgba(30, 41, 59, 0.85);
    box-shadow: 0 2px 12px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
    color: var(--text-secondary);
  }

  :global([data-theme="dark"]) .fab--secondary:hover {
    background: rgba(30, 41, 59, 0.95);
    color: var(--primary-400);
  }

  :global([data-theme="dark"]) .fab--secondary.follow-active {
    background: rgba(37, 99, 235, 0.18);
    box-shadow: 0 2px 12px rgba(59,130,246,0.30), 0 0 0 1px rgba(96,165,250,0.35);
    color: var(--primary-400);
  }

  @media (prefers-reduced-motion: reduce) {
    .fab,
    .fab--primary.tracking {
      animation: none;
      transition: none;
    }
  }
</style>
