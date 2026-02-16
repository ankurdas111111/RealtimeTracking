<script>
  import { createEventDispatcher } from 'svelte';

  export let activeTab = 'map';
  export let isAdmin = false;
  export let isTracking = false;
  export let hasNotification = false;

  const dispatch = createEventDispatcher();
  const tabOrder = ['map', 'sharing', 'users', 'info', 'more'];

  function selectTab(tab) {
    dispatch('tabChange', tab);
  }

  function onTabKeydown(e, tab) {
    const idx = tabOrder.indexOf(tab);
    if (idx < 0) return;
    var nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabOrder.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabOrder.length - 1;
    else return;
    e.preventDefault();
    selectTab(tabOrder[nextIdx]);
  }
</script>

<div class="bottom-tabs" role="tablist" aria-label="Navigation">
  <button
    class="tab-item"
    class:active={activeTab === 'map'}
    on:click={() => selectTab('map')}
    on:keydown={(e) => onTabKeydown(e, 'map')}
    role="tab"
    aria-selected={activeTab === 'map'}
    tabindex={activeTab === 'map' ? 0 : -1}
    aria-label={isTracking ? 'Map, tracking active' : 'Map'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
    <span class="tab-label">Map</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'sharing'}
    on:click={() => selectTab('sharing')}
    on:keydown={(e) => onTabKeydown(e, 'sharing')}
    role="tab"
    aria-selected={activeTab === 'sharing'}
    tabindex={activeTab === 'sharing' ? 0 : -1}
    aria-label="Sharing"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
    <span class="tab-label">Share</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'users'}
    on:click={() => selectTab('users')}
    on:keydown={(e) => onTabKeydown(e, 'users')}
    role="tab"
    aria-selected={activeTab === 'users'}
    tabindex={activeTab === 'users' ? 0 : -1}
    aria-label="Users"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    <span class="tab-label">Users</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'info'}
    on:click={() => selectTab('info')}
    on:keydown={(e) => onTabKeydown(e, 'info')}
    role="tab"
    aria-selected={activeTab === 'info'}
    tabindex={activeTab === 'info' ? 0 : -1}
    aria-label={hasNotification ? 'Info, has notification' : 'Info'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    <span class="tab-label">Info</span>
    {#if hasNotification}
      <span class="tab-dot" aria-label="Notification"></span>
    {/if}
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'more'}
    on:click={() => selectTab('more')}
    on:keydown={(e) => onTabKeydown(e, 'more')}
    role="tab"
    aria-selected={activeTab === 'more'}
    tabindex={activeTab === 'more' ? 0 : -1}
    aria-label={isAdmin ? 'More admin options' : 'More options'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
    <span class="tab-label">More</span>
  </button>
</div>

<style>
  .bottom-tabs {
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    background: var(--surface-2);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid var(--border-default);
    padding-bottom: var(--safe-bottom);
    z-index: var(--z-navbar);
    position: relative;
    flex-shrink: 0;
  }

  .tab-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--space-1-5) 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
    position: relative;
    min-height: var(--bottom-tab-height);
    min-width: 48px;
    -webkit-tap-highlight-color: transparent;
  }

  .tab-item:active {
    background: var(--surface-active);
  }

  .tab-item.active {
    color: var(--primary-500);
  }

  .tab-item.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 20px;
    height: 2px;
    background: var(--primary-500);
    border-radius: 0 0 1px 1px;
  }

  .tab-label {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .tab-dot {
    position: absolute;
    top: 6px;
    right: calc(50% - 14px);
    width: 6px;
    height: 6px;
    background: var(--danger-500);
    border-radius: 50%;
    border: 1.5px solid var(--surface-2);
  }

  @media (min-width: 768px) {
    .bottom-tabs {
      display: none;
    }
  }
</style>
