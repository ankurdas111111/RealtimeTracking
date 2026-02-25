<script>
  import { push } from 'svelte-spa-router';
  import { authUser, loadSession } from '../lib/stores/auth.js';
  import { apiPost, fetchCsrf } from '../lib/api.js';
  import { COUNTRY_CODES, COUNTRY_MAP, validateMobileLength } from '../lib/countryCodes.js';
  import { toasts } from '../lib/stores/toast.js';
  import { onMount } from 'svelte';

  let mode = 'email';
  let loginId = '';
  let password = '';
  let showPassword = false;
  let countryIso = 'IN';
  let mobileDigits = '';
  let error = '';
  let loading = false;
  let redirecting = false;
  let mobileHint = '';
  let emailTouched = false;
  let passwordTouched = false;
  let mobileTouched = false;

  onMount(() => {
    if ($authUser) push('/');
    fetchCsrf();
  });

  function getCountry() { return COUNTRY_MAP[countryIso]; }

  function mobilePlaceholder() {
    const c = getCountry();
    if (!c) return '';
    return c.min === c.max ? `${c.min} digits` : `${c.min}-${c.max} digits`;
  }

  function validateMobile() {
    if (!mobileDigits) { mobileHint = ''; return false; }
    const r = validateMobileLength(countryIso, mobileDigits);
    mobileHint = r.valid ? '' : r.msg;
    return r.valid;
  }

  $: emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId.trim());
  $: emailError = emailTouched && loginId.trim() && !emailValid;
  $: mobileValid = mobileDigits ? validateMobileLength(countryIso, mobileDigits).valid : false;
  $: passwordError = passwordTouched && password.length > 0 && password.length < 6;

  function onModeToggleKeydown(e, current) {
    var order = ['email', 'mobile'];
    var idx = order.indexOf(current);
    if (idx < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      mode = order[(idx + 1) % order.length];
    } else if (e.key === 'Home') {
      e.preventDefault();
      mode = order[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      mode = order[order.length - 1];
    }
  }

  async function handleSubmit() {
    error = '';
    emailTouched = true;
    passwordTouched = true;
    mobileTouched = true;

    if (mode === 'email') {
      if (!emailValid) { error = 'Enter a valid email'; return; }
    } else {
      if (!validateMobile()) { error = mobileHint || 'Enter a valid mobile number'; return; }
    }
    if (!password) { error = 'Password is required'; return; }
    if (password.length < 6) { error = 'Password must be at least 6 characters'; return; }

    loading = true;
    try {
      const body = { password };
      if (mode === 'email') {
        body.login_id = loginId.trim().toLowerCase();
        body.login_method = 'email';
      } else {
        const c = getCountry();
        body.login_id = c.dial + mobileDigits.replace(/\D/g, '');
        body.login_method = 'mobile';
      }
      const res = await apiPost('/api/login', body);
      if (res.ok) {
        redirecting = true;
        toasts.success('Welcome back!');
        await loadSession();
        push('/');
      } else {
        error = res.error || 'Login failed';
      }
    } catch (e) {
      error = 'Network error';
    }
    loading = false;
  }
</script>

<div class="auth-page">
  <div class="auth-bg"><div class="auth-bg-blob"></div></div>

  <div class="auth-brand">
    <div class="auth-brand-inner">
      <div class="auth-brand-logo">
        <svg width="24" height="29" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 1C5.029 1 1 5.029 1 10c0 6.938 8.25 13.1 9 14.1.75-1 9-7.162 9-14.1C19 5.029 14.971 1 10 1z" fill="white" fill-opacity="0.95"/>
          <path d="M7 7v6M7 10l3.5-3M7 10l3.5 3" stroke="rgba(255,255,255,0.90)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="auth-brand-badge">Kinnect = Kin + Connect</div>
      <h1>Keep your<br>family close</h1>
      <p>Real-time GPS location sharing for families. Stay connected, stay safe.</p>
      <ul class="auth-brand-features">
        <li><span class="feature-check" aria-hidden="true"></span> Live location sharing</li>
        <li><span class="feature-check" aria-hidden="true"></span> SOS emergency alerts</li>
        <li><span class="feature-check" aria-hidden="true"></span> Safe zone notifications</li>
        <li><span class="feature-check" aria-hidden="true"></span> Works on all devices</li>
      </ul>
    </div>
  </div>

  <div class="auth-form-area">
    <div class="auth-card">
      <h2>Welcome back</h2>
      <p class="subtitle">Sign in to your tracking account</p>

      {#if error}
        <div class="auth-error" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      {/if}

      <form on:submit|preventDefault={handleSubmit} novalidate>
        <div class="auth-toggle" role="tablist" aria-label="Login method">
          <button type="button" class="auth-toggle-btn" class:active={mode === 'email'} on:click={() => mode = 'email'} on:keydown={(e) => onModeToggleKeydown(e, 'email')} role="tab" aria-selected={mode === 'email'} tabindex={mode === 'email' ? 0 : -1}>Email</button>
          <button type="button" class="auth-toggle-btn" class:active={mode === 'mobile'} on:click={() => mode = 'mobile'} on:keydown={(e) => onModeToggleKeydown(e, 'mobile')} role="tab" aria-selected={mode === 'mobile'} tabindex={mode === 'mobile' ? 0 : -1}>Mobile</button>
        </div>

        {#if mode === 'email'}
          <div class="auth-field">
            <label for="login_email">Email address</label>
            <div class="input-wrapper">
              <input
                id="login_email"
                type="email"
                class="input"
                class:is-valid={emailTouched && emailValid}
                class:is-invalid={emailError}
                bind:value={loginId}
                placeholder="you@example.com"
                autocomplete="email"
                on:blur={() => emailTouched = true}
              />
              {#if emailTouched && emailValid}
                <span class="input-icon valid" aria-hidden="true">&#10003;</span>
              {/if}
            </div>
            {#if emailError}
              <span class="auth-hint error">Enter a valid email address</span>
            {/if}
          </div>
        {:else}
          <div class="auth-field">
            <label for="login_mobile">Mobile number</label>
            <div class="auth-phone-row">
              <select class="auth-cc-select" bind:value={countryIso} on:change={validateMobile} aria-label="Country code">
                {#each COUNTRY_CODES as c}
                  <option value={c[1]}>{c[3]} {c[0]}</option>
                {/each}
              </select>
              <input
                id="login_mobile"
                type="tel"
                class="input"
                class:is-valid={mobileTouched && mobileValid}
                class:is-invalid={mobileTouched && mobileDigits && !mobileValid}
                bind:value={mobileDigits}
                placeholder={mobilePlaceholder()}
                inputmode="numeric"
                on:blur={() => { mobileTouched = true; validateMobile(); }}
              />
            </div>
            {#if mobileTouched && mobileHint}<span class="auth-hint error">{mobileHint}</span>{/if}
          </div>
        {/if}

        <div class="auth-field">
          <label for="password">Password</label>
          <div class="input-wrapper">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              class="input"
              class:is-invalid={passwordError}
              bind:value={password}
              autocomplete="current-password"
              on:blur={() => passwordTouched = true}
            />
            <button type="button" class="input-icon input-icon--toggle" on:click={() => showPassword = !showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {#if showPassword}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {/if}
            </button>
          </div>
          {#if passwordError}
            <span class="auth-hint error">At least 6 characters</span>
          {/if}
        </div>

        <button class="auth-submit" type="submit" disabled={loading}>
          {#if loading}
            <span class="submit-spinner" aria-hidden="true"></span>
            {redirecting ? 'Opening dashboard...' : 'Signing in...'}
          {:else}
            Sign in
          {/if}
        </button>
      </form>

      <p class="auth-link">Don't have an account? <a href="#/register">Create one</a></p>
    </div>
  </div>
</div>

<style>
  @import '../styles/auth.css';

  .input-wrapper {
    position: relative;
  }
  .input-wrapper .input {
    padding-right: var(--space-8);
  }
  .input-icon {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--text-sm);
    pointer-events: none;
  }
  .input-icon.valid {
    color: var(--success-500);
  }
  .input-icon--toggle {
    pointer-events: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    padding: 2px;
    border-radius: 4px;
    transition: color 0.15s;
  }
  .input-icon--toggle:hover { color: var(--text-secondary); }
  .is-valid {
    border-color: var(--success-400) !important;
  }
  .submit-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    margin-right: var(--space-2);
    vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
