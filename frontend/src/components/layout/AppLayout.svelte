<script>
  import { onMount, onDestroy } from 'svelte';

  export let sidebarOpen = true;
  export let rightPanelOpen = false;

  let isMobile = false;
  let isTablet = false;

  function checkBreakpoint() {
    const w = window.innerWidth;
    isMobile = w < 768;
    isTablet = w >= 768 && w < 1024;
  }

  onMount(() => {
    checkBreakpoint();
    window.addEventListener('resize', checkBreakpoint);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', checkBreakpoint);
  });
</script>

<a href="#main-content" class="skip-link">Skip to map</a>

<div
  class="app-layout"
  class:sidebar-open={sidebarOpen && !isMobile}
  class:sidebar-closed={!sidebarOpen || isMobile}
  class:right-open={rightPanelOpen && !isMobile}
  class:mobile={isMobile}
  class:tablet={isTablet}
>
  {#if !isMobile}
    <div class="layout-navbar">
      <slot name="navbar" />
    </div>
  {/if}

  <div class="layout-body">
    {#if !isMobile}
      <div class="layout-sidebar">
        <slot name="sidebar" />
      </div>
    {/if}

    <div class="layout-map" id="main-content">
      <slot name="map" />
      <slot name="banner" />
    </div>

    {#if rightPanelOpen && !isMobile}
      <div class="layout-right">
        <slot name="rightPanel" />
      </div>
    {/if}
  </div>

  {#if isMobile}
    <slot name="bottomSheet" />
    <div class="layout-tabs">
      <slot name="bottomTabs" />
    </div>
  {/if}

  <slot name="overlay" />
</div>

<style>
  .app-layout {
    height: 100vh;
    height: 100dvh;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .layout-navbar {
    flex-shrink: 0;
    z-index: var(--z-navbar);
  }

  .layout-body {
    flex: 1;
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: 1fr;
    overflow: hidden;
    position: relative;
  }

  .layout-sidebar {
    grid-column: 1;
    grid-row: 1;
    z-index: var(--z-panel);
    overflow: hidden;
  }

  .layout-map {
    grid-column: 2;
    grid-row: 1;
    position: relative;
    overflow: hidden;
    min-width: 0;
  }

  .layout-right {
    grid-column: 3;
    grid-row: 1;
    z-index: var(--z-panel);
    overflow: hidden;
  }

  /* Mobile: single column, map fills everything */
  .app-layout.mobile .layout-body {
    grid-template-columns: 1fr;
  }

  .app-layout.mobile .layout-map {
    grid-column: 1;
  }

  .layout-tabs {
    flex-shrink: 0;
    z-index: var(--z-navbar);
  }
</style>
