<script>
  import { onMount, afterUpdate } from 'svelte';

  export let items = [];
  export let itemHeight = 72;   // estimated px per item
  export let overscan = 3;      // extra items above/below viewport

  let containerEl;
  let scrollTop = 0;
  let viewportHeight = 0;
  let rafId = null;

  $: totalHeight = items.length * itemHeight;

  $: startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  $: endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
  );

  $: visibleItems = items.slice(startIndex, endIndex).map((item, i) => ({
    item,
    index: startIndex + i,
    top: (startIndex + i) * itemHeight,
  }));

  function onScroll(e) {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      scrollTop = e.target.scrollTop;
      rafId = null;
    });
  }

  onMount(() => {
    if (containerEl) {
      viewportHeight = containerEl.clientHeight;
      const ro = new ResizeObserver(entries => {
        viewportHeight = entries[0].contentRect.height;
      });
      ro.observe(containerEl);
      return () => ro.disconnect();
    }
  });
</script>

<div
  class="virtual-list"
  bind:this={containerEl}
  on:scroll={onScroll}
>
  <div class="virtual-spacer" style="height:{totalHeight}px; position:relative;">
    {#each visibleItems as { item, index, top } (index)}
      <div
        class="virtual-item"
        style="position:absolute;top:{top}px;left:0;right:0;height:{itemHeight}px;"
      >
        <slot {item} {index} />
      </div>
    {/each}
  </div>
</div>

<style>
  .virtual-list {
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    height: 100%;
    min-height: 0;
    flex: 1;
  }
  .virtual-spacer {
    position: relative;
    overflow: hidden;
  }
  .virtual-item {
    overflow: hidden;
  }
</style>
