<script>
  import { push } from 'svelte-spa-router';
  import { authUser, loadSession } from '../lib/stores/auth.js';
  import { apiPost, fetchCsrf } from '../lib/api.js';
  import { COUNTRY_CODES, COUNTRY_MAP, validateMobileLength } from '../lib/countryCodes.js';
  import { toasts } from '../lib/stores/toast.js';
  import { onMount } from 'svelte';

  let firstName = '';
  let lastName = '';
  let password = '';
  let confirm = '';
  let contactType = 'email';
  let emailValue = '';
  let countryIso = 'IN';
  let mobileDigits = '';
  let error = '';
  let loading = false;
  let redirecting = false;
  let mobileHint = '';
  let emailHint = '';

  let firstNameTouched = false;
  let passwordTouched = false;
  let confirmTouched = false;
  let emailTouched = false;
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

  function validateEmail() {
    if (!emailValue.trim()) { emailHint = ''; return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim())) { emailHint = 'Enter a valid email'; return false; }
    emailHint = '';
    return true;
  }

  $: passwordStrength = getPasswordStrength(password);
  $: emailValid = emailValue.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim());
  $: mobileValid = mobileDigits ? validateMobileLength(countryIso, mobileDigits).valid : false;
  $: confirmMatch = confirm && password === confirm;
  $: confirmError = confirmTouched && confirm && !confirmMatch;

  function onContactToggleKeydown(e, current) {
    var order = ['email', 'mobile'];
    var idx = order.indexOf(current);
    if (idx < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      contactType = order[(idx + 1) % order.length];
    } else if (e.key === 'Home') {
      e.preventDefault();
      contactType = order[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      contactType = order[order.length - 1];
    }
  }

  function getPasswordStrength(pw) {
    if (!pw) return { level: 0, label: '', color: '' };
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { level: 1, label: 'Weak', color: 'var(--danger-500)' };
    if (score <= 2) return { level: 2, label: 'Fair', color: 'var(--warning-500)' };
    if (score <= 3) return { level: 3, label: 'Good', color: 'var(--primary-500)' };
    return { level: 4, label: 'Strong', color: 'var(--success-500)' };
  }

  async function handleSubmit() {
    error = '';
    firstNameTouched = true;
    passwordTouched = true;
    confirmTouched = true;
    emailTouched = true;
    mobileTouched = true;

    if (!firstName.trim()) { error = 'First name is required'; return; }
    if (password.length < 6) { error = 'Password must be at least 6 characters'; return; }
    if (password !== confirm) { error = 'Passwords do not match'; return; }

    const body = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      password,
      confirm,
      contact_type: contactType
    };

    if (contactType === 'email') {
      if (!validateEmail()) { error = emailHint || 'Enter a valid email'; return; }
      body.contact_value = emailValue.trim().toLowerCase();
    } else {
      if (!validateMobile()) { error = mobileHint || 'Enter a valid mobile number'; return; }
      const c = getCountry();
      body.contact_value = c.dial + mobileDigits.replace(/\D/g, '');
    }

    loading = true;
    try {
      const res = await apiPost('/api/register', body);
      if (res.ok) {
        redirecting = true;
        toasts.success('Account created successfully!');
        await loadSession();
        push('/');
      } else {
        error = res.error || 'Registration failed';
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
    <div class="auth-brand-logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 1.892.402 3.13 1.5 4.5L12 22l6.5-7.5c1.098-1.37 1.5-2.608 1.5-4.5a8 8 0 0 0-8-8z"/></svg>
    </div>
    <h1>Kinnect</h1>
    <p>Your family, always close. Track, share, and stay connected in real time.</p>
  </div>

  <div class="auth-form-area">
    <div class="auth-card">
      <h2>Create account</h2>
      <p class="subtitle">Sign up to start tracking and sharing</p>

      {#if error}
        <div class="auth-error" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      {/if}

      <form on:submit|preventDefault={handleSubmit} novalidate>
        <div class="auth-name-row">
          <div class="auth-field">
            <label for="first_name">First name</label>
            <input
              id="first_name"
              class="input"
              class:is-invalid={firstNameTouched && !firstName.trim()}
              bind:value={firstName}
              placeholder="John"
              autocomplete="given-name"
              on:blur={() => firstNameTouched = true}
            />
            {#if firstNameTouched && !firstName.trim()}
              <span class="auth-hint error">Required</span>
            {/if}
          </div>
          <div class="auth-field">
            <label for="last_name">Last name</label>
            <input id="last_name" class="input" bind:value={lastName} placeholder="Doe" autocomplete="family-name" />
          </div>
        </div>

        <div class="auth-field">
          <label for="reg_password">Password</label>
          <input
            id="reg_password"
            type="password"
            class="input"
            class:is-invalid={passwordTouched && password.length > 0 && password.length < 6}
            bind:value={password}
            autocomplete="new-password"
            on:blur={() => passwordTouched = true}
          />
          {#if password}
            <div class="password-strength">
              <div class="strength-bar">
                <div class="strength-fill" style="width:{passwordStrength.level * 25}%;background:{passwordStrength.color}"></div>
              </div>
              <span class="strength-label" style="color:{passwordStrength.color}">{passwordStrength.label}</span>
            </div>
          {:else}
            <span class="auth-hint">Minimum 6 characters</span>
          {/if}
        </div>
        <div class="auth-field">
          <label for="reg_confirm">Confirm password</label>
          <div class="input-wrapper">
            <input
              id="reg_confirm"
              type="password"
              class="input"
              class:is-invalid={confirmError}
              class:is-valid={confirmTouched && confirmMatch}
              bind:value={confirm}
              autocomplete="new-password"
              on:blur={() => confirmTouched = true}
            />
            {#if confirmTouched && confirmMatch}
              <span class="input-icon valid" aria-hidden="true">&#10003;</span>
            {/if}
          </div>
          {#if confirmError}
            <span class="auth-hint error">Passwords do not match</span>
          {/if}
        </div>

        <div class="auth-field" style="margin-bottom: var(--space-2);"><p class="label">Contact method</p></div>
        <div class="auth-toggle" role="tablist" aria-label="Contact method">
          <button type="button" class="auth-toggle-btn" class:active={contactType === 'email'} on:click={() => contactType = 'email'} on:keydown={(e) => onContactToggleKeydown(e, 'email')} role="tab" aria-selected={contactType === 'email'} tabindex={contactType === 'email' ? 0 : -1}>Email</button>
          <button type="button" class="auth-toggle-btn" class:active={contactType === 'mobile'} on:click={() => contactType = 'mobile'} on:keydown={(e) => onContactToggleKeydown(e, 'mobile')} role="tab" aria-selected={contactType === 'mobile'} tabindex={contactType === 'mobile' ? 0 : -1}>Mobile</button>
        </div>

        {#if contactType === 'email'}
          <div class="auth-field">
            <label for="reg_email">Email address</label>
            <div class="input-wrapper">
              <input
                id="reg_email"
                type="email"
                class="input"
                class:is-valid={emailTouched && emailValid}
                class:is-invalid={emailTouched && emailValue.trim() && !emailValid}
                bind:value={emailValue}
                placeholder="you@example.com"
                on:blur={() => { emailTouched = true; validateEmail(); }}
                autocomplete="email"
              />
              {#if emailTouched && emailValid}
                <span class="input-icon valid" aria-hidden="true">&#10003;</span>
              {/if}
            </div>
            {#if emailTouched && emailHint}<span class="auth-hint error">{emailHint}</span>{/if}
          </div>
        {:else}
          <div class="auth-field">
            <label for="reg_mobile">Mobile number</label>
            <div class="auth-phone-row">
              <select class="auth-cc-select" bind:value={countryIso} on:change={validateMobile} aria-label="Country code">
                {#each COUNTRY_CODES as c}
                  <option value={c[1]}>{c[3]} {c[0]}</option>
                {/each}
              </select>
              <input
                id="reg_mobile"
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

        <button class="auth-submit" type="submit" disabled={loading}>
          {#if loading}
            <span class="submit-spinner" aria-hidden="true"></span>
            {redirecting ? 'Opening dashboard...' : 'Creating account...'}
          {:else}
            Create account
          {/if}
        </button>
      </form>

      <p class="auth-link">Already have an account? <a href="#/login">Sign in</a></p>
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
  .is-valid {
    border-color: var(--success-400) !important;
  }

  .password-strength {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .strength-bar {
    flex: 1;
    height: 4px;
    background: var(--gray-200);
    border-radius: 2px;
    overflow: hidden;
  }
  :global([data-theme="dark"]) .strength-bar {
    background: var(--gray-700);
  }
  .strength-fill {
    height: 100%;
    border-radius: 2px;
    transition: width var(--duration-normal) var(--ease-out), background-color var(--duration-normal);
  }
  .strength-label {
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
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
