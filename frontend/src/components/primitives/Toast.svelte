<script>
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { toasts } from '../../lib/stores/toast.js';

  function typeIcon(type) {
    if (type === 'success') return '&#10003;';
    if (type === 'error') return '&#10007;';
    if (type === 'warning') return '&#9888;';
    return '&#8505;';
  }
</script>

<div class="toast-container" aria-live="polite" aria-relevant="additions">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      in:fly={{ y: -30, duration: 250, easing: cubicOut }}
      out:fade={{ duration: 150 }}
      role="status"
    >
      <span class="toast-icon" aria-hidden="true">{@html typeIcon(toast.type)}</span>
      <span class="toast-message">{toast.message}</span>
      <button class="toast-close" on:click={() => toasts.remove(toast.id)} aria-label="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      {#if toast.duration > 0}
        <div class="toast-progress" style="animation-duration:{toast.duration}ms"></div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: var(--space-4);
    right: var(--space-4);
    z-index: var(--z-toast, 6000);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 380px;
    pointer-events: none;
  }

  @media (max-width: 767px) {
    .toast-container {
      top: var(--space-3);
      left: var(--space-3);
      right: var(--space-3);
      max-width: none;
    }
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    font-size: var(--text-sm);
    color: var(--text-primary);
    pointer-events: auto;
    position: relative;
    overflow: hidden;
  }

  .toast-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
  }

  .toast-info .toast-icon {
    background: var(--primary-100);
    color: var(--primary-600);
  }
  .toast-success .toast-icon {
    background: rgba(16, 185, 129, 0.12);
    color: var(--success-600);
  }
  .toast-error .toast-icon {
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger-600);
  }
  .toast-warning .toast-icon {
    background: rgba(245, 158, 11, 0.12);
    color: var(--warning-600);
  }

  :global([data-theme="dark"]) .toast-info .toast-icon {
    background: rgba(59, 130, 246, 0.15);
    color: var(--primary-400);
  }
  :global([data-theme="dark"]) .toast-success .toast-icon {
    background: rgba(52, 211, 153, 0.15);
    color: var(--success-400);
  }
  :global([data-theme="dark"]) .toast-error .toast-icon {
    background: rgba(248, 113, 113, 0.15);
    color: var(--danger-400);
  }
  :global([data-theme="dark"]) .toast-warning .toast-icon {
    background: rgba(251, 191, 36, 0.15);
    color: var(--warning-400);
  }

  .toast-message {
    flex: 1;
    min-width: 0;
  }

  .toast-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 2px;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity var(--duration-fast);
  }
  .toast-close:hover {
    opacity: 1;
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    transform-origin: left;
    animation: toast-progress linear forwards;
  }

  .toast-info .toast-progress { background: var(--primary-500); }
  .toast-success .toast-progress { background: var(--success-500); }
  .toast-error .toast-progress { background: var(--danger-500); }
  .toast-warning .toast-progress { background: var(--warning-500); }

  @keyframes toast-progress {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }
</style>
