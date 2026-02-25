<script>
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';

  export let open = false;
  export let title = '';

  const dispatch = createEventDispatcher();

  let sheetEl;
  let dragging = false;
  let startY = 0;
  let currentOffset = 0;
  let snapState = 'peek';
  let lastFocusedEl = null;
  let wasOpen = false;

  const SNAP_PEEK = 0.78;
  const SNAP_HALF = 0.50;
  const SNAP_FULL = 0.10;

  $: viewH = typeof window !== 'undefined' ? window.innerHeight : 800;
  $: peekY = viewH * SNAP_PEEK;
  $: halfY = viewH * SNAP_HALF;
  $: fullY = viewH * SNAP_FULL;

  $: if (open && snapState === 'closed') {
    snapState = 'peek';
    currentOffset = peekY;
  }

  $: if (!open) {
    snapState = 'closed';
    currentOffset = viewH;
  }

  $: translateY = snapState === 'closed' ? viewH : currentOffset;

  function onPointerDown(e) {
    if (e.target.closest('.sheet-body')) return;
    dragging = true;
    startY = e.clientY;
    if (sheetEl) sheetEl.style.transition = 'none';
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const newOffset = currentOffset + delta;
    const clamped = Math.max(fullY, Math.min(viewH, newOffset));
    if (sheetEl) sheetEl.style.transform = `translateY(${clamped}px)`;
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    if (sheetEl) sheetEl.style.transition = '';

    const delta = e.clientY - startY;
    const rawOffset = currentOffset + delta;

    if (delta > 80) {
      if (snapState === 'full') { snap('half'); }
      else if (snapState === 'half') { snap('peek'); }
      else { dismiss(); }
    } else if (delta < -80) {
      if (snapState === 'peek') { snap('half'); }
      else if (snapState === 'half') { snap('full'); }
    } else {
      snap(snapState);
    }
  }

  function snap(state) {
    snapState = state;
    if (state === 'peek') currentOffset = peekY;
    else if (state === 'half') currentOffset = halfY;
    else if (state === 'full') currentOffset = fullY;
  }

  function dismiss() {
    snapState = 'closed';
    currentOffset = viewH;
    dispatch('close');
  }

  function onBackdropClick() {
    dismiss();
  }

  function handleResize() {
    viewH = window.innerHeight;
    snap(snapState);
  }

  function getFocusable() {
    if (!sheetEl) return [];
    return Array.from(sheetEl.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  function onKeydown(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return;
    }
    if (e.key !== 'Tab') return;
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

  onMount(() => {
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', onKeydown);
    if (open) {
      snapState = 'peek';
      currentOffset = peekY;
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', handleResize);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
  });

  $: if (open && !wasOpen) {
    wasOpen = true;
    lastFocusedEl = document.activeElement;
    tick().then(() => {
      var focusable = getFocusable();
      if (focusable.length) focusable[0].focus();
      else sheetEl?.focus();
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
  <div class="sheet-backdrop" class:visible={snapState !== 'closed'} on:click={onBackdropClick} aria-hidden="true"></div>
  <div
    class="sheet"
    bind:this={sheetEl}
    tabindex="-1"
    style="transform: translateY({translateY}px)"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    role="dialog"
    aria-modal="true"
    aria-label={title || 'Bottom sheet'}
  >
    <div class="sheet-handle-area">
      <div class="sheet-handle"></div>
    </div>
    {#if title}
      <div class="sheet-header">
        <h3>{title}</h3>
        <button class="btn btn-icon btn-ghost" on:click={dismiss} aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    {/if}
    <div class="sheet-body">
      <slot />
    </div>
  </div>
{/if}

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-panel) - 1);
    background: rgba(0, 0, 0, 0.3);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-out);
    touch-action: none;
  }

  .sheet-backdrop.visible {
    opacity: 1;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 90vh;
    z-index: var(--z-panel);
    background: var(--surface-2);
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    box-shadow: var(--shadow-sheet);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
    touch-action: none;
  }

  .sheet-handle-area {
    padding: var(--space-2) 0 var(--space-1);
    display: flex;
    justify-content: center;
    cursor: grab;
    flex-shrink: 0;
    touch-action: none;
    min-height: 28px;
  }

  .sheet-handle-area:active {
    cursor: grabbing;
  }

  .sheet-handle {
    width: 44px;
    height: 5px;
    background: var(--gray-300);
    border-radius: 999px;
  }

  :global([data-theme="dark"]) .sheet-handle {
    background: var(--gray-600);
  }

  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--space-4) var(--space-2);
    flex-shrink: 0;
  }

  .sheet-header h3 {
    font-size: var(--text-lg);
    font-weight: 700;
    margin: 0;
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    padding: 0 var(--space-4) var(--space-4);
    padding-bottom: calc(var(--space-4) + var(--safe-bottom));
  }

  @media (min-width: 768px) {
    .sheet-backdrop, .sheet {
      display: none;
    }
  }
</style>
