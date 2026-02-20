/**
 * Unified GPS provider that abstracts browser Geolocation and Capacitor native
 * location APIs behind a single interface.
 *
 * On native (Capacitor): uses @capacitor/geolocation which delegates to
 * Google Play Services (fused provider) on Android and CoreLocation on iOS.
 *
 * On web (browser): uses navigator.geolocation with high-accuracy + fallback
 * watchPosition strategy, parallel getCurrentPosition for fast first fix.
 *
 * Both paths produce normalised position objects with the same shape and feed
 * into the caller's applyFix pipeline (Kalman, accuracy filter, throttle).
 */

let isNative = false;
let nativeDetected = false;

function detectNative() {
  if (nativeDetected) return;
  nativeDetected = true;
  try {
    // Capacitor global is injected by the native shell at load time
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform) {
      isNative = window.Capacitor.isNativePlatform();
    }
  } catch (_) {
    isNative = false;
  }
}

// Run detection immediately
detectNative();

// ── State shared across providers ───────────────────────────────────────────
let primaryWatchId = null;
let fallbackWatchId = null;
let nativeWatchId = null;
let active = false;
let _CapGeolocation = null; // cached after startNative() loads the module
let _primaryGoodFixes = 0;  // counts consecutive accurate web fixes (used to retire fallback watcher)

/** Call onFix only if normalise() returned a valid object. */
function safeFix(onFix, pos, force) {
  const n = normalise(pos);
  if (n) onFix(n, force);
}

// ── Native (Capacitor) provider ─────────────────────────────────────────────
async function startNative(onFix, onError) {
  const { Geolocation } = await import('@capacitor/geolocation');
  _CapGeolocation = Geolocation; // cache for stopNative()

  // Request permission first (no-op if already granted)
  const perm = await Geolocation.checkPermissions();
  if (perm.location !== 'granted') {
    const req = await Geolocation.requestPermissions();
    if (req.location !== 'granted') {
      onError({ code: 1, message: 'Location permission denied' });
      return;
    }
  }

  // Quick first fix
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 5000
    });
    safeFix(onFix, pos, true);
  } catch (_) {
    // Fallback: lower accuracy
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000
      });
      safeFix(onFix, pos, true);
    } catch (_2) {}
  }

  // Continuous watch using fused provider
  nativeWatchId = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 },
    (pos, err) => {
      if (err) {
        onError({ code: 2, message: err.message || 'Position unavailable' });
        return;
      }
      if (pos) safeFix(onFix, pos, false);
    }
  );
}

function stopNative() {
  if (nativeWatchId != null) {
    const id = nativeWatchId;
    nativeWatchId = null;
    // Use the cached module reference — avoids a dangling dynamic import on teardown
    if (_CapGeolocation) {
      _CapGeolocation.clearWatch({ id }).catch(() => {});
    }
  }
}

// ── Web (browser) provider ──────────────────────────────────────────────────
function startWeb(onFix, onError) {
  if (!navigator.geolocation) {
    onError({ code: 0, message: 'Geolocation not supported' });
    return;
  }
  _primaryGoodFixes = 0;

  // Immediate high-accuracy attempt
  navigator.geolocation.getCurrentPosition(
    (pos) => safeFix(onFix, pos, true),
    () => {
      // Fallback: lower accuracy
      navigator.geolocation.getCurrentPosition(
        (pos) => safeFix(onFix, pos, true),
        () => {},
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
      );
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
  );

  // Parallel low-accuracy attempt for fast first fix
  navigator.geolocation.getCurrentPosition(
    (pos) => safeFix(onFix, pos, false),
    () => {},
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
  );

  // Start fallback watch immediately
  startFallbackWatch(onFix);

  // Primary high-accuracy watch
  primaryWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      // Once we have 3 consecutive accurate fixes the fallback watcher is redundant
      if (pos.coords.accuracy != null && pos.coords.accuracy <= 50) {
        _primaryGoodFixes++;
        if (_primaryGoodFixes >= 3 && fallbackWatchId != null) {
          navigator.geolocation.clearWatch(fallbackWatchId);
          fallbackWatchId = null;
        }
      } else {
        _primaryGoodFixes = 0; // reset on coarse fix so the counter reflects recent quality
      }
      safeFix(onFix, pos, false);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError({ code: 1, message: 'Location permission denied' });
        return;
      }
      if (err.code === err.TIMEOUT) {
        startFallbackWatch(onFix);
        return;
      }
      onError({ code: err.code, message: err.message || 'Position error' });
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function startFallbackWatch(onFix) {
  if (fallbackWatchId != null) return;
  fallbackWatchId = navigator.geolocation.watchPosition(
    (pos) => safeFix(onFix, pos, false),
    () => {},
    { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
  );
}

function stopWeb() {
  _primaryGoodFixes = 0;
  if (primaryWatchId != null) {
    navigator.geolocation.clearWatch(primaryWatchId);
    primaryWatchId = null;
  }
  if (fallbackWatchId != null) {
    navigator.geolocation.clearWatch(fallbackWatchId);
    fallbackWatchId = null;
  }
}

// ── Shared utilities ────────────────────────────────────────────────────────

/**
 * Normalise a GeolocationPosition (browser or Capacitor) into a flat object.
 * Both APIs return { coords: { latitude, longitude, accuracy, speed } }.
 */
function normalise(pos) {
  if (!pos || !pos.coords) return null;
  const c = pos.coords;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy,
    speed: c.speed,
    timestamp: pos.timestamp || Date.now()
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start receiving GPS fixes.
 *
 * @param {function} onFix   Called with (normalisedPos, forceEmit) for each fix.
 * @param {function} onError Called with { code, message } on errors.
 */
export function startGeo(onFix, onError) {
  if (active) return;
  active = true;
  if (isNative) {
    startNative(onFix, onError);
  } else {
    startWeb(onFix, onError);
  }
}

/**
 * Stop receiving GPS fixes and clean up all watchers.
 */
export function stopGeo() {
  if (!active) return;
  active = false;
  if (isNative) {
    stopNative();
  } else {
    stopWeb();
  }
}

/**
 * Warm up GPS hardware (call early so the first real fix is faster).
 */
export function warmUp() {
  if (isNative) {
    import('@capacitor/geolocation').then(({ Geolocation }) => {
      Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 }).catch(() => {});
    }).catch(() => {});
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(() => {}, () => {}, {
      enableHighAccuracy: true, timeout: 10000, maximumAge: 30000
    });
  }
}

/**
 * Check geolocation permission status.
 * @returns {Promise<string>} 'granted' | 'denied' | 'prompt' | 'unknown'
 */
export async function checkPermission() {
  if (isNative) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.checkPermissions();
      return perm.location || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state;
    } catch (_) {}
  }
  return 'unknown';
}

/**
 * @returns {boolean} Whether we're running inside a Capacitor native shell.
 */
export function isNativePlatform() {
  return isNative;
}
