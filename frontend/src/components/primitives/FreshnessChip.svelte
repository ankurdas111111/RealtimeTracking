<script>
  import { onDestroy } from 'svelte';

  /** @type {number|null} timestamp in ms of last position */
  export let lastSeenMs = null;
  /** @type {number|null} accuracy in meters */
  export let accuracy = null;
  /** @type {boolean} */
  export let online = true;
  /** @type {boolean} */
  export let sos = false;

  let now = Date.now();
  const interval = setInterval(() => { now = Date.now(); }, 2000);
  onDestroy(() => clearInterval(interval));

  $: ageMs = lastSeenMs ? now - lastSeenMs : null;
  $: ageSec = ageMs != null ? Math.floor(ageMs / 1000) : null;

  $: state = (() => {
    if (sos) return 'sos';
    if (!online) return 'offline';
    if (ageSec == null) return 'waiting';
    if (ageSec < 5) return 'live';
    if (ageSec < 30) return 'stale';
    return 'old';
  })();

  $: ageLabel = (() => {
    if (ageSec == null) return '';
    if (ageSec < 5) return 'just now';
    if (ageSec < 60) return `${ageSec}s ago`;
    const m = Math.floor(ageSec / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  })();

  $: accLabel = accuracy != null ? `±${Math.round(accuracy)}m` : '';
</script>

<div class="freshness-chip" class:live={state === 'live'} class:stale={state === 'stale'} class:old={state === 'old'} class:offline={state === 'offline'} class:sos={state === 'sos'} class:waiting={state === 'waiting'} aria-label={`Location ${state}: ${ageLabel}`} role="status">
  <span class="dot" aria-hidden="true"></span>
  {#if state === 'offline'}
    <span class="label">Offline</span>
  {:else if state === 'waiting'}
    <span class="label">Waiting…</span>
  {:else if state === 'sos'}
    <span class="label">SOS</span>
  {:else}
    <span class="label">{ageLabel}{accLabel ? ` | ${accLabel}` : ''}</span>
  {/if}
</div>

<style>
  .freshness-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    background: var(--glass-1, rgba(255,255,255,0.85));
    backdrop-filter: var(--blur-sm, blur(16px));
    -webkit-backdrop-filter: var(--blur-sm, blur(16px));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.6));
    box-shadow: var(--shadow-glass-sm, 0 2px 8px rgba(0,0,0,0.08));
    color: var(--text-secondary);
    transition: color 0.2s, background 0.2s;
    white-space: nowrap;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .label {
    line-height: 1;
  }

  /* States */
  .live { color: var(--status-live, #22c55e); }
  .live .dot { animation: pulse-live 2s ease-in-out infinite; }

  .stale { color: var(--status-stale, #f59e0b); }

  .old { color: var(--danger-500, #ef4444); }

  .offline { color: var(--status-offline, #94a3b8); }
  .offline .dot { opacity: 0.5; }

  .sos { color: var(--status-sos, #ef4444); }
  .sos .dot { animation: pulse-sos 1s ease-in-out infinite; }

  .waiting { color: var(--text-tertiary); }
  .waiting .dot { animation: blink 1.4s step-end infinite; }

  @keyframes pulse-live {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }
  @keyframes pulse-sos {
    0%, 100% { opacity: 1; transform: scale(1.2); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
</style>
