<script>
  import { createEventDispatcher } from 'svelte';
  import { authUser } from '../lib/stores/auth.js';
  import { socket } from '../lib/socket.js';

  export let visible = false;

  const dispatch = createEventDispatcher();

  let step = 1;
  let contactCode = '';
  let adding = false;
  let addError = '';
  let addSuccess = false;

  $: shareCode = $authUser?.shareCode || '';

  async function handleAddContact() {
    if (!contactCode.trim()) return;
    adding = true;
    addError = '';
    socket.emit('addContact', { code: contactCode.trim().toUpperCase() }, (res) => {
      adding = false;
      if (res?.ok) {
        addSuccess = true;
        setTimeout(() => dispatch('dismiss'), 1200);
      } else {
        addError = res?.error || 'Could not find user with that code.';
      }
    });
  }

  function copyCode() {
    navigator.clipboard?.writeText(shareCode).catch(() => {});
    if (navigator.share) {
      navigator.share({ title: 'Join me on Kinnect', text: `Add me on Kinnect with code: ${shareCode}` }).catch(() => {});
    }
  }
</script>

{#if visible}
  <div class="onboarding-backdrop" on:click|self={() => dispatch('dismiss')} on:keydown={(e) => { if (e.key === 'Escape') dispatch('dismiss'); }} role="dialog" aria-modal="true" aria-label="Get started" tabindex="-1">
    <div class="onboarding-card">
      <!-- Step indicators -->
      <div class="step-indicators" aria-label="Step {step} of 2">
        <span class="step-dot" class:active={step === 1}></span>
        <span class="step-dot" class:active={step === 2}></span>
      </div>

      {#if step === 1}
        <!-- Step 1: Permission education -->
        <div class="onboarding-step" role="tabpanel" aria-label="Step 1: Enable location">
          <div class="brand-icon" aria-hidden="true">
            <svg width="40" height="48" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 1C5.029 1 1 5.029 1 10c0 6.938 8.25 13.1 9 14.1.75-1 9-7.162 9-14.1C19 5.029 14.971 1 10 1z" fill="url(#kpin-grad)"/>
              <path d="M7 7v6M7 10l3.5-3M7 10l3.5 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <defs>
                <linearGradient id="kpin-grad" x1="0" y1="0" x2="20" y2="24" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#818cf8"/>
                  <stop offset="1" stop-color="#4338ca"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 class="onboarding-title">Welcome to Kinnect</h2>
          <p class="onboarding-desc">To share your location with family, Kinnect needs access to your device's GPS. Your location is only shared with people you choose.</p>
          <div class="privacy-note">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Private &amp; end-to-end secure. Never sold.
          </div>
          <div class="onboarding-actions">
            <button class="btn-primary-full" on:click={() => { dispatch('requestPermission'); step = 2; }}>
              Allow location access
            </button>
            <button class="btn-ghost-sm" on:click={() => step = 2}>Skip for now</button>
          </div>
        </div>
      {:else}
        <!-- Step 2: Add first person -->
        <div class="onboarding-step" role="tabpanel" aria-label="Step 2: Add a contact">
          <h2 class="onboarding-title">Add someone</h2>
          <p class="onboarding-desc">Share your code with a family member, or enter their code to connect.</p>

          <!-- Your share code -->
          <div class="code-block">
            <span class="code-label">Your share code</span>
            <div class="code-display">
              <span class="code-value">{shareCode || '—'}</span>
              <button class="copy-btn" on:click={copyCode} aria-label="Copy or share code" disabled={!shareCode}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </div>

          <!-- Enter their code -->
          <div class="input-row">
            <input
              class="code-input"
              placeholder="Enter their code"
              bind:value={contactCode}
              maxlength="10"
              style="text-transform:uppercase"
              on:keydown={(e) => e.key === 'Enter' && handleAddContact()}
            />
            <button class="add-btn" on:click={handleAddContact} disabled={adding || !contactCode.trim() || addSuccess}>
              {#if adding}
                <span class="mini-spinner"></span>
              {:else if addSuccess}
                ✓
              {:else}
                Add
              {/if}
            </button>
          </div>
          {#if addError}
            <span class="add-error">{addError}</span>
          {/if}
          {#if addSuccess}
            <span class="add-success">Connected!</span>
          {/if}

          <button class="btn-ghost-sm" style="margin-top: var(--space-4)" on:click={() => dispatch('dismiss')}>
            Done
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .onboarding-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    animation: fade-in 0.2s ease;
  }

  .onboarding-card {
    background: var(--glass-2, rgba(255,255,255,0.96));
    backdrop-filter: var(--blur-md, blur(24px));
    -webkit-backdrop-filter: var(--blur-md, blur(24px));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.6));
    box-shadow: var(--shadow-glass-lg, 0 8px 40px rgba(0,0,0,0.18));
    border-radius: 24px;
    padding: 28px 24px;
    max-width: 360px;
    width: 100%;
    animation: card-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  :global([data-theme="dark"]) .onboarding-card {
    background: var(--glass-2, rgba(20,27,58,0.96));
  }

  .step-indicators {
    display: flex;
    gap: 6px;
  }

  .step-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border-default, #d1d5db);
    transition: width 0.25s cubic-bezier(0.34,1.56,0.64,1), border-radius 0.25s, background 0.2s;
  }

  .step-dot.active {
    width: 20px;
    border-radius: 3px;
    background: var(--primary-500, #6366f1);
  }

  .onboarding-step {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }

  .brand-icon {
    width: 72px;
    height: 72px;
    background: linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(67,56,202,0.08) 100%);
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(99,102,241,0.15);
  }

  .onboarding-title {
    font-size: 20px;
    font-weight: 800;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .onboarding-desc {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
    max-width: 280px;
  }

  .privacy-note {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-tertiary);
    background: rgba(99,102,241,0.06);
    border: 1px solid rgba(99,102,241,0.12);
    border-radius: 8px;
    padding: 6px 12px;
  }

  .onboarding-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
  }

  .btn-primary-full {
    width: 100%;
    padding: 14px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--primary-500, #6366f1) 0%, var(--primary-700, #4338ca) 100%);
    color: white;
    font-size: 15px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(99,102,241,0.40);
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .btn-primary-full:active {
    transform: scale(0.97);
  }

  .btn-ghost-sm {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: 13px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s;
  }

  .btn-ghost-sm:hover {
    color: var(--text-secondary);
  }

  /* Code block */
  .code-block {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .code-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }

  .code-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--surface-secondary, #f3f4f6);
    border-radius: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border-default);
  }

  :global([data-theme="dark"]) .code-display {
    background: rgba(255,255,255,0.06);
  }

  .code-value {
    font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: var(--primary-600, #4f46e5);
    flex: 1;
    text-align: center;
  }

  .copy-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .copy-btn:hover { color: var(--primary-500); }
  .copy-btn:disabled { opacity: 0.4; cursor: default; }

  /* Input row */
  .input-row {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .code-input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1.5px solid var(--border-default);
    background: var(--surface-primary, white);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  :global([data-theme="dark"]) .code-input {
    background: rgba(255,255,255,0.06);
    color: var(--text-primary);
  }

  .code-input:focus {
    border-color: var(--primary-500);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.12);
  }

  .add-btn {
    padding: 10px 18px;
    border-radius: 10px;
    background: var(--primary-500, #6366f1);
    color: white;
    font-size: 14px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    flex-shrink: 0;
    min-width: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn:hover:not(:disabled) { background: var(--primary-600, #4f46e5); }
  .add-btn:active:not(:disabled) { transform: scale(0.95); }
  .add-btn:disabled { opacity: 0.6; cursor: default; }

  .add-error {
    font-size: 12px;
    color: var(--danger-500, #ef4444);
    align-self: flex-start;
  }

  .add-success {
    font-size: 13px;
    font-weight: 700;
    color: var(--success-500, #22c55e);
  }

  .mini-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes card-in {
    from { opacity: 0; transform: scale(0.88) translateY(20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
</style>
