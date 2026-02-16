<script>
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  export let activeTab = 'info';
  export let isAdmin = false;
  export let collapsed = false;

  const dispatch = createEventDispatcher();

  const tabs = [
    { id: 'info', label: 'Info', icon: 'info' },
    { id: 'sharing', label: 'Sharing', icon: 'share' },
    { id: 'admin', label: 'Admin', icon: 'shield' },
  ];

  function selectTab(id) {
    if (collapsed) {
      collapsed = false;
      dispatch('toggle', false);
    }
    activeTab = id;
    dispatch('tabChange', id);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('toggle', collapsed);
  }

  function onTabKeydown(e, id) {
    const tabIds = tabs.map(t => t.id);
    const idx = tabIds.indexOf(id);
    if (idx < 0) return;
    var nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabIds.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabIds.length) % tabIds.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabIds.length - 1;
    else return;
    e.preventDefault();
    selectTab(tabIds[nextIdx]);
  }
</script>

<aside
  class="sidebar"
  class:collapsed
  aria-label="Side panel"
  transition:fly={{ x: -400, duration: 250, easing: cubicOut }}
>
  <div class="sidebar-tabs" role="tablist" aria-label="Panel tabs">
    {#each tabs as tab}
      <button
        class="sidebar-tab"
        class:active={activeTab === tab.id && !collapsed}
        on:click={() => selectTab(tab.id)}
        on:keydown={(e) => onTabKeydown(e, tab.id)}
        role="tab"
        aria-selected={activeTab === tab.id && !collapsed}
        tabindex={activeTab === tab.id && !collapsed ? 0 : -1}
        title={tab.label}
        aria-label={tab.id === 'admin' ? (isAdmin ? 'Admin controls' : 'Safety controls') : tab.label}
      >
        {#if tab.icon === 'info'}
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        {:else if tab.icon === 'share'}
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        {:else if tab.icon === 'shield'}
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        {/if}
        {#if !collapsed}
          <span class="sidebar-tab-label">{tab.label}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if !collapsed}
    <div class="sidebar-content" role="tabpanel" aria-label={activeTab}>
      <slot />
    </div>
  {/if}

  <button class="sidebar-collapse-btn btn btn-icon btn-ghost" on:click={toggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:{collapsed ? 'rotate(180deg)' : 'none'};transition:transform 0.2s">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  </button>
</aside>

<style>
  .sidebar {
    display: none;
    flex-direction: column;
    background: var(--surface-2);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid var(--border-default);
    box-shadow: var(--shadow-panel);
    overflow: hidden;
    position: relative;
    width: var(--sidebar-width);
    transition: width var(--duration-normal) var(--ease-out);
    z-index: var(--z-panel);
  }

  .sidebar.collapsed {
    width: var(--sidebar-collapsed);
  }

  .sidebar-tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    border-bottom: 1px solid var(--border-default);
    flex-shrink: 0;
  }

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 600;
    border-radius: var(--radius-md);
    transition:
      color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
    white-space: nowrap;
    min-height: 36px;
  }

  .sidebar-tab:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .sidebar-tab.active {
    color: var(--primary-600);
    background: var(--surface-selected);
  }

  :global([data-theme="dark"]) .sidebar-tab.active {
    color: var(--primary-400);
  }

  .sidebar-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .collapsed .sidebar-tabs {
    flex-direction: column;
    align-items: center;
  }

  .collapsed .sidebar-tab {
    padding: var(--space-2);
    justify-content: center;
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .sidebar-collapse-btn {
    position: absolute;
    bottom: var(--space-3);
    right: var(--space-2);
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    border-radius: 50%;
    opacity: 0.6;
  }

  .sidebar-collapse-btn:hover {
    opacity: 1;
  }

  @media (min-width: 768px) {
    .sidebar {
      display: flex;
    }
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    .sidebar {
      width: var(--sidebar-tablet);
    }
    .sidebar.collapsed {
      width: var(--sidebar-collapsed);
    }
  }
</style>
