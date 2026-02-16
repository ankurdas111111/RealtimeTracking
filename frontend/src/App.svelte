<script>
  import Router from 'svelte-spa-router';
  import { onMount } from 'svelte';
  import { authUser, loadSession } from './lib/stores/auth.js';
  import Login from './pages/Login.svelte';
  import Register from './pages/Register.svelte';
  import MainApp from './pages/MainApp.svelte';
  import LiveViewer from './pages/LiveViewer.svelte';
  import WatchViewer from './pages/WatchViewer.svelte';
  import Toast from './components/primitives/Toast.svelte';

  const routes = {
    '/': MainApp,
    '/login': Login,
    '/register': Register,
    '/live/:token': LiveViewer,
    '/watch/:token': WatchViewer
  };

  let loading = true;

  onMount(async () => {
    await loadSession();
    loading = false;
  });

  function conditionsFailed(event) {
    window.location.hash = '#/login';
  }
</script>

{#if loading}
  <div class="app-loading" role="status" aria-live="polite" aria-busy="true">
    <div class="app-loading-spinner"></div>
    <p>Loading Kinnect...</p>
  </div>
{:else}
  <Router {routes} on:conditionsFailed={conditionsFailed} />
{/if}

<Toast />

<style>
  .app-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: var(--space-4);
    color: var(--text-secondary);
    font-family: var(--font-sans);
  }
  .app-loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-default);
    border-top-color: var(--primary-500);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
