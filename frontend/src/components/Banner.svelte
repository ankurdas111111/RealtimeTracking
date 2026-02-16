<script>
  import { banner } from '../lib/stores/sos.js';
</script>

{#if $banner.text}
  <div class="banner" class:banner-info={$banner.type === 'info'} class:banner-sos={$banner.type === 'sos'} role="status" aria-live="polite">
    <span class="banner-text">{$banner.text}</span>
    {#if $banner.actions}
      {#each $banner.actions as action}
        <button class="btn btn-sm {action.kind || 'btn-secondary'}" on:click={action.onClick}>{action.label}</button>
      {/each}
    {/if}
    <button class="banner-close" aria-label="Dismiss banner" on:click={() => banner.set({ type: null, text: null, actions: [] })} on:keydown={(e) => ((e.key === 'Enter' || e.key === ' ') && banner.set({ type: null, text: null, actions: [] }))}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: var(--navbar-height, 56px);
    left: 0;
    right: 0;
    z-index: 2500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 500;
    animation: slideDown 0.3s var(--ease-out);
  }
  .banner-info {
    background: var(--primary-600);
    color: white;
  }
  .banner-sos {
    background: var(--danger-500);
    color: white;
  }
  .banner-text { flex: 1; text-align: center; }
  .banner-close {
    background: none; border: none; cursor: pointer; color: inherit; padding: 2px;
    opacity: 0.7;
  }
  .banner-close:hover { opacity: 1; }
  @keyframes slideDown {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
