<script>
  import { createEventDispatcher } from 'svelte';

  export let activeTab = 'track';
  export let isAdmin = false;
  export let isTracking = false;
  export let hasNotification = false;

  const dispatch = createEventDispatcher();
  const tabOrder = ['track', 'people', 'share', 'safety', 'me'];

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
    class:active={activeTab === 'track'}
    on:click={() => selectTab('track')}
    on:keydown={(e) => onTabKeydown(e, 'track')}
    role="tab"
    aria-selected={activeTab === 'track'}
    tabindex={activeTab === 'track' ? 0 : -1}
    aria-label={isTracking ? 'Track, tracking active' : 'Track'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="9" r="2.5"/></svg>
    <span class="tab-label">Track</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'people'}
    on:click={() => selectTab('people')}
    on:keydown={(e) => onTabKeydown(e, 'people')}
    role="tab"
    aria-selected={activeTab === 'people'}
    tabindex={activeTab === 'people' ? 0 : -1}
    aria-label="People"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    <span class="tab-label">People</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'share'}
    on:click={() => selectTab('share')}
    on:keydown={(e) => onTabKeydown(e, 'share')}
    role="tab"
    aria-selected={activeTab === 'share'}
    tabindex={activeTab === 'share' ? 0 : -1}
    aria-label="Share"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
    <span class="tab-label">Share</span>
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'safety'}
    on:click={() => selectTab('safety')}
    on:keydown={(e) => onTabKeydown(e, 'safety')}
    role="tab"
    aria-selected={activeTab === 'safety'}
    tabindex={activeTab === 'safety' ? 0 : -1}
    aria-label="Safety"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3l-8.47-14.14a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span class="tab-label">Safety</span>
    {#if hasNotification}
      <span class="tab-dot" aria-label="Notification"></span>
    {/if}
  </button>

  <button
    class="tab-item"
    class:active={activeTab === 'me'}
    on:click={() => selectTab('me')}
    on:keydown={(e) => onTabKeydown(e, 'me')}
    role="tab"
    aria-selected={activeTab === 'me'}
    tabindex={activeTab === 'me' ? 0 : -1}
    aria-label={isAdmin ? 'Me and admin options' : 'Me and settings'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>
    <span class="tab-label">Me</span>
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
