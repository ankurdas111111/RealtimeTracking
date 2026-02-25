<script>
  import { createEventDispatcher } from 'svelte';
  import { authUser } from '../lib/stores/auth.js';
  import { tracking } from '../lib/stores/map.js';
  import { socket } from '../lib/socket.js';
  import { apiPost } from '../lib/api.js';
  import ThemeToggle from './ThemeToggle.svelte';

  export let isAdmin = false;
  export let activePanel = null;
  export let isTracking = false;

  const dispatch = createEventDispatcher();

  function toggle(panel) { dispatch('togglePanel', panel); }
  function toggleTracking() { dispatch('toggleTracking'); }

  async function logout() {
    await apiPost('/api/logout');
    window.location.hash = '#/login';
    window.location.reload();
  }

  $: initials = $authUser ? ($authUser.displayName || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '';
</script>

<nav class="navbar" aria-label="Main navigation">
  <div class="navbar-left">
    <div class="navbar-logo" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
    </div>
    <span class="navbar-title">Kinnect</span>
  </div>

  <div class="navbar-right">
    <button class="btn btn-icon btn-ghost nav-toggle" class:active={activePanel === 'sharing'} on:click={() => toggle('sharing')} title="Sharing" aria-label="Toggle sharing panel" aria-pressed={activePanel === 'sharing'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
    </button>
    <button class="btn btn-icon btn-ghost nav-toggle" class:active={activePanel === 'users'} on:click={() => toggle('users')} title="Users" aria-label="Toggle users panel" aria-pressed={activePanel === 'users'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </button>
    <button class="btn btn-icon btn-ghost nav-toggle" class:active={activePanel === 'info'} on:click={() => toggle('info')} title="Info" aria-label="Toggle info panel" aria-pressed={activePanel === 'info'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </button>
    <button class="btn btn-icon btn-ghost nav-toggle" class:active={activePanel === 'admin'} on:click={() => toggle('admin')} title="Admin Controls" aria-label="Toggle admin panel" aria-pressed={activePanel === 'admin'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </button>
    {#if isAdmin}
      <button class="btn btn-icon btn-ghost nav-toggle" class:active={activePanel === 'superAdmin'} on:click={() => toggle('superAdmin')} title="Super Admin" aria-label="Toggle super admin panel" aria-pressed={activePanel === 'superAdmin'}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    {/if}

    <button class="btn btn-sm track-btn" class:btn-danger={isTracking} class:btn-primary={!isTracking} on:click={toggleTracking} aria-label={isTracking ? 'Stop tracking' : 'Start tracking'}>
      {isTracking ? 'Stop' : 'Track'}
    </button>

    <ThemeToggle />

    <div class="navbar-avatar" title={$authUser?.displayName || ''} aria-label="User avatar">{initials}</div>

    <button class="btn btn-icon btn-ghost" on:click={logout} title="Logout" aria-label="Logout">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </button>
  </div>
</nav>

<style>
  .navbar {
    height: var(--navbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-4);
    background: var(--surface-2);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border-default);
    box-shadow: var(--shadow-navbar);
    z-index: var(--z-navbar);
    position: relative;
    flex-shrink: 0;
  }

  .navbar-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .navbar-logo {
    width: 32px;
    height: 32px;
    background: var(--primary-600);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: var(--shadow-sm);
  }

  .navbar-title {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .navbar-right {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .nav-toggle {
    position: relative;
    transition:
      transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.18s ease-out,
      background 0.15s ease-out;
  }

  .nav-toggle:hover:not(.active) {
    background: var(--glass-1, rgba(255, 255, 255, 0.72));
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.12),
      0 0 0 1px rgba(255, 255, 255, 0.50),
      inset 0 1px 0 rgba(255, 255, 255, 0.75);
    transform: translateY(-2px);
  }

  .nav-toggle:active {
    transform: translateY(1px) !important;
    background: rgba(0, 0, 0, 0.05) !important;
    box-shadow:
      inset 0 2px 5px rgba(0, 0, 0, 0.12),
      0 1px 2px rgba(0, 0, 0, 0.06) !important;
    transition-duration: 60ms !important;
  }

  .nav-toggle.active {
    color: var(--primary-500);
    background: var(--surface-selected);
  }

  .nav-toggle.active::after {
    content: '';
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    width: 16px;
    height: 2px;
    background: var(--primary-500);
    border-radius: 1px;
  }

  .track-btn {
    white-space: nowrap;
  }

  .navbar-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--primary-100);
    color: var(--primary-700);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: var(--text-xs);
    flex-shrink: 0;
    user-select: none;
  }

  :global([data-theme="dark"]) .navbar-avatar {
    background: rgba(59, 130, 246, 0.20);
    color: var(--primary-300);
  }

  /* Tablet: compact navbar */
  @media (max-width: 767px) {
    .navbar {
      display: none;
    }
  }

  /* Tablet range: hide text, show icons only */
  @media (min-width: 768px) and (max-width: 1023px) {
    .navbar-title {
      display: none;
    }
    .navbar-right {
      gap: 0;
    }
  }
</style>
