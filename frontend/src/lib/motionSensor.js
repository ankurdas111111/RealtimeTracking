/**
 * motionSensor.js — IMU-aided GPS speed validation using DeviceMotion API.
 *
 * Technique: ZUPT (Zero Velocity Update) — standard inertial navigation.
 * If the accelerometer reports near-zero linear acceleration consistently,
 * the device is stationary regardless of what GPS reports.
 *
 * Works on:
 *   - Android Chrome/WebView (no permission needed)
 *   - iOS Safari 13+ (requires user gesture permission)
 *   - Capacitor WebView (same as browser)
 *   - Desktop: gracefully unavailable (returns null always)
 */

const WINDOW_SIZE = 6;           // samples to average (at ~60Hz → ~100ms window)
const STATIONARY_THRESHOLD = 0.4; // m/s² — below this = stationary (gravity-removed)
const MOVING_THRESHOLD = 1.2;    // m/s² — above this = definitely moving

let _listening = false;
let _supported = false;
let _samples = [];               // ring buffer of linear acceleration magnitudes
let _permissionGranted = false;

/**
 * Request iOS permission and start listening to DeviceMotion events.
 * Safe to call multiple times — idempotent.
 * @returns {Promise<boolean>}  true if sensor is available and listening
 */
export async function startMotionSensor() {
  if (_listening) return _supported;

  if (typeof DeviceMotionEvent === 'undefined') {
    return false; // desktop or old browser
  }

  // iOS 13+ requires explicit permission
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== 'granted') return false;
      _permissionGranted = true;
    } catch {
      return false;
    }
  } else {
    _permissionGranted = true; // Android / non-iOS: always granted
  }

  window.addEventListener('devicemotion', _onDeviceMotion, { passive: true });
  _listening = true;
  _supported = true;
  return true;
}

/** Stop listening — call when tracking stops. */
export function stopMotionSensor() {
  if (!_listening) return;
  window.removeEventListener('devicemotion', _onDeviceMotion);
  _listening = false;
  _samples = [];
}

function _onDeviceMotion(event) {
  const a = event.acceleration; // linear accel with gravity removed
  if (!a || a.x == null) return;

  const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  _samples.push(magnitude);
  if (_samples.length > WINDOW_SIZE) _samples.shift();
}

/**
 * Returns the current motion state based on recent accelerometer samples.
 *
 * @returns {{ stationary: boolean, moving: boolean, available: boolean, avgAccel: number }}
 *
 * - stationary: true  → device definitely not moving (ZUPT applies, force speed = 0)
 * - moving:     true  → device definitely moving (trust GPS speed)
 * - available:  false → sensor not available (ignore, use GPS only)
 * - avgAccel:   average linear acceleration magnitude in m/s²
 */
export function getMotionState() {
  if (!_supported || !_listening || _samples.length < 3) {
    return { stationary: false, moving: false, available: false, avgAccel: null };
  }

  const avg = _samples.reduce((s, v) => s + v, 0) / _samples.length;

  return {
    available: true,
    avgAccel: avg,
    stationary: avg < STATIONARY_THRESHOLD,
    moving: avg > MOVING_THRESHOLD,
  };
}
