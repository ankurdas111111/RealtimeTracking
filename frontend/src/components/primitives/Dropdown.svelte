<script>
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';

  export let open = false;
  export let items = [];
  export let label = 'Select';

  const dispatch = createEventDispatcher();
  let containerEl;
  let activeIndex = -1;
  let triggerEl;
  let listboxEl;
  let optionEls = [];

  function toggle() {
    open = !open;
    if (open) activeIndex = 0;
  }

  function select(item, index) {
    dispatch('select', item);
    open = false;
    activeIndex = index;
  }

  function onKeydown(e) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open = true;
        activeIndex = 0;
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
      triggerEl?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) {
        select(items[activeIndex], activeIndex);
      }
    }
  }

  function onOutsideClick(e) {
    if (containerEl && !containerEl.contains(e.target)) {
      open = false;
    }
  }

  onMount(() => {
    document.addEventListener('click', onOutsideClick, true);
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('click', onOutsideClick, true);
  });

  $: if (open && activeIndex >= 0) {
    tick().then(() => {
      var el = optionEls[activeIndex];
      if (el) el.focus();
      else if (listboxEl) listboxEl.focus();
    });
  }
</script>

<div class="dropdown" bind:this={containerEl}>
  <button
    class="btn btn-sm btn-primary dropdown-trigger"
    bind:this={triggerEl}
    on:click={toggle}
    on:keydown={onKeydown}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
  >
    {label}
    <svg class="dropdown-caret" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:{open ? 'rotate(180deg)' : 'none'}"><polyline points="6 9 12 15 18 9"/></svg>
  </button>

  {#if open}
    <ul class="dropdown-menu" role="listbox" aria-label={label} tabindex="-1" bind:this={listboxEl}>
      {#each items as item, i}
        <li
          class="dropdown-item"
          class:active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          tabindex="-1"
          bind:this={optionEls[i]}
          on:click={() => select(item, i)}
          on:mouseenter={() => activeIndex = i}
          on:keydown={onKeydown}
        >
          {item.label || item}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-block;
  }

  .dropdown-trigger {
    display: inline-flex;
    align-items: center;
  }

  .dropdown-caret {
    margin-left: var(--space-1);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-dropdown, 100);
    overflow: hidden;
    list-style: none;
    padding: var(--space-1) 0;
    animation: fadeIn 0.1s var(--ease-out);
  }

  .dropdown-item {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
    transition: background-color var(--duration-fast);
    min-height: 36px;
    display: flex;
    align-items: center;
  }

  .dropdown-item:hover,
  .dropdown-item.active {
    background: var(--surface-hover);
  }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
</style>
