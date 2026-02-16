<script>
  import { alertState } from '../lib/stores/sos.js';
  import Modal from './primitives/Modal.svelte';

  let audioCtx = null;
  let oscillator = null;

  $: if ($alertState.visible && $alertState.alarmMs > 0) {
    startAlarm();
    triggerHaptic();
  } else {
    stopAlarm();
  }

  function triggerHaptic() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    } catch (_) {}
  }

  function startAlarm() {
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      oscillator = audioCtx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      oscillator.connect(audioCtx.destination);
      oscillator.start();
      setTimeout(() => stopAlarm(), $alertState.alarmMs);
    } catch (_) {}
  }

  function stopAlarm() {
    try {
      if (oscillator) { oscillator.stop(); oscillator = null; }
      if (audioCtx) { audioCtx.close(); audioCtx = null; }
    } catch (_) {}
  }

  function dismiss() {
    stopAlarm();
    alertState.set({ visible: false, title: '', body: '', actions: [], alarmMs: 0 });
  }
</script>

<Modal open={$alertState.visible} urgent={true} title={$alertState.title || 'Alert'} on:close={dismiss}>
  <p class="alert-body">{$alertState.body}</p>

  <svelte:fragment slot="footer">
    {#each $alertState.actions as action}
      <button class="btn {action.kind || 'btn-primary'} btn-lg" on:click={() => { if (action.onClick) action.onClick(); dismiss(); }}>{action.label}</button>
    {/each}
    <button class="btn btn-secondary btn-lg" on:click={dismiss}>Dismiss</button>
  </svelte:fragment>
</Modal>

<style>
  .alert-body {
    color: var(--text-secondary);
    font-size: var(--text-base);
    text-align: center;
    line-height: var(--leading-relaxed);
  }
</style>
