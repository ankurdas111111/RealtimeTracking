<script>
  import { createEventDispatcher } from 'svelte';
  import StatusPills from './StatusPills.svelte';
  import ThemeToggle from '../ThemeToggle.svelte';

  export let activeTab = 'track';
  export let trackingActive = false;
  export let hasNotification = false;
  export let lastAccuracy = null;
  export let latencyMs = null;
  export let isOnline = true;
  export let socketConnected = false;
  export let bufferedCount = 0;

  const dispatch = createEventDispatcher();

  const tabTitles = {
    track: 'Track',
    people: 'People',
    share: 'Share',
    safety: 'Safety',
    me: 'Me'
  };

  $: title = tabTitles[activeTab] || 'Track';
</script>

<header class="mobile-top-bar">
  <div class="bar-main">
    <div class="title-wrap">
      <h1>{title}</h1>
      <p>{trackingActive ? 'Live location active' : 'Tracking paused'}</p>
    </div>
    <div class="top-actions">
      <ThemeToggle />
      <button class="icon-btn" aria-label="Open profile tab" on:click={() => dispatch('openMe')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21a8 8 0 0 0-16 0"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        {#if hasNotification}
          <span class="dot" aria-hidden="true"></span>
        {/if}
      </button>
    </div>
  </div>
  <StatusPills
    {trackingActive}
    {lastAccuracy}
    {latencyMs}
    {isOnline}
    {socketConnected}
    {bufferedCount}
  />
</header>

<style>
  .mobile-top-bar {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    z-index: calc(var(--z-navbar) + 1);
    padding: calc(var(--safe-top, 0px) + 8px) 12px 8px;
    background: var(--glass-bg, rgba(255, 255, 255, 0.85));
    backdrop-filter: var(--glass-blur, blur(20px) saturate(1.8));
    -webkit-backdrop-filter: var(--glass-blur, blur(20px) saturate(1.8));
    border-bottom: 1px solid var(--glass-border, rgba(15, 23, 42, 0.08));
    box-shadow: 0 1px 12px rgba(0, 0, 0, 0.06);
  }

  .bar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 8px;
  }

  .title-wrap h1 {
    margin: 0;
    font-size: 19px;
    line-height: 1.2;
    letter-spacing: 0.01em;
  }

  .title-wrap p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-btn {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    border: 1px solid var(--border-default);
    background: var(--surface-2);
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .icon-btn:active {
    background: var(--surface-active);
  }

  .dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger-500, #ef4444);
    border: 2px solid var(--surface-2);
  }

  @media (min-width: 768px) {
    .mobile-top-bar {
      display: none;
    }
  }
</style>
