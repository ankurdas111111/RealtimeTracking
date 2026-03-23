<script>
  import { banner } from '../lib/stores/sos.js';
</script>

{#if $banner.text}
  <div class="banner" class:banner-info={$banner.type === 'info'} class:banner-sos={$banner.type === 'sos'} role="status" aria-live="polite">
    <span class="banner-text">{$banner.text}</span>
    {#if $banner.actions}
      {#each $banner.actions as action}
        <button class="btn btn-sm banner-action {action.kind || 'btn-secondary'}" on:click={action.onClick}>{action.label}</button>
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
    top: calc(var(--safe-top, 0px) + var(--navbar-height, 56px));
    left: var(--space-4);
    right: var(--space-4);
    z-index: 2500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 500;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: slideDown 0.3s var(--ease-out);
  }

  /* Mobile: position above bottom tab bar */
  @media (max-width: 767px) {
    .banner {
      top: auto;
      bottom: calc(var(--bottom-tab-height, 56px) + var(--safe-bottom, 0px) + var(--space-3));
      animation: slideUp 0.3s var(--ease-out);
    }
  }

  .banner-info {
    background: rgba(37, 99, 235, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  .banner-sos {
    background: rgba(220, 38, 38, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.15);
    animation: slideDown 0.3s var(--ease-out), sos-urgent-pulse 1.5s ease infinite;
  }
  .banner-text { flex: 1; text-align: center; }
  .banner-close {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
  }
  .banner-close:hover { opacity: 1; }
  .banner-action {
    min-height: 40px;
    padding: 0 12px;
  }
  @keyframes slideDown {
    from { transform: translateY(-20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
