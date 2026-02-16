<script>
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  export let open = false;
  export let urgent = false;
  export let title = '';
  export let size = 'md';

  const dispatch = createEventDispatcher();
  let dialogEl;
  let lastFocusedEl = null;
  let wasOpen = false;

  function dismiss() {
    dispatch('close');
  }

  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return;
    }
    if (e.key !== 'Tab' || !dialogEl) return;
    var focusable = getFocusable();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) dismiss();
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
  });

  function getFocusable() {
    if (!dialogEl) return [];
    return Array.from(dialogEl.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  $: if (open && !wasOpen) {
    wasOpen = true;
    lastFocusedEl = document.activeElement;
    tick().then(() => {
      var focusable = getFocusable();
      if (focusable.length) focusable[0].focus();
      else dialogEl?.focus();
    });
  }

  $: if (!open && wasOpen) {
    wasOpen = false;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
  }
</script>

{#if open}
  <div
    class="modal-backdrop"
    class:urgent
    on:click={onBackdropClick}
    transition:fade={{ duration: 150 }}
    role="presentation"
  >
    <div
      class="modal-card {size}"
      class:urgent
      bind:this={dialogEl}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Modal dialog'}
      transition:scale={{ start: 0.95, duration: 200, easing: cubicOut }}
    >
      {#if title}
        <div class="modal-header">
          <h3 class="modal-title" class:urgent>{title}</h3>
          <button class="btn btn-icon btn-ghost modal-close" on:click={dismiss} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      {/if}
      <div class="modal-body">
        <slot />
      </div>
      {#if $$slots.footer}
        <div class="modal-footer">
          <slot name="footer" />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 5000);
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .modal-backdrop.urgent {
    background: rgba(127, 29, 29, 0.3);
  }

  .modal-card {
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }

  .modal-card.sm { width: 340px; max-width: 100%; }
  .modal-card.md { width: 420px; max-width: 100%; }
  .modal-card.lg { width: 560px; max-width: 100%; }

  .modal-card.urgent {
    border-color: var(--danger-500);
    animation: urgent-pulse 2s ease-in-out infinite;
  }

  @keyframes urgent-pulse {
    0%, 100% { box-shadow: var(--shadow-xl), 0 0 0 0 rgba(239, 68, 68, 0.3); }
    50% { box-shadow: var(--shadow-xl), 0 0 0 8px rgba(239, 68, 68, 0); }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-6) 0;
  }

  .modal-title {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .modal-title.urgent {
    color: var(--danger-500);
  }

  .modal-close {
    flex-shrink: 0;
  }

  .modal-body {
    padding: var(--space-4) var(--space-6);
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
    padding: 0 var(--space-6) var(--space-4);
    flex-wrap: wrap;
  }

  @media (max-width: 767px) {
    .modal-card {
      width: calc(100% - var(--space-4));
      max-width: 100%;
    }
    .modal-body {
      padding: var(--space-3) var(--space-4);
    }
    .modal-header {
      padding: var(--space-3) var(--space-4) 0;
    }
    .modal-footer {
      padding: 0 var(--space-4) var(--space-3);
      justify-content: stretch;
    }
    .modal-footer :global(.btn) {
      flex: 1;
      min-height: 48px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-card.urgent {
      animation: none;
      box-shadow: var(--shadow-xl), 0 0 0 3px var(--danger-500);
    }
  }
</style>
