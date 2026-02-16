/**
 * Lightweight 1-D Kalman filter for GPS coordinate smoothing.
 *
 * Two instances are used (one for latitude, one for longitude).
 * The filter adapts its measurement-noise estimate (R) from the GPS
 * accuracy field, and its process-noise estimate (Q) can be tuned
 * dynamically based on movement speed.
 *
 * References:
 *   - https://en.wikipedia.org/wiki/Kalman_filter#Details
 *   - Adapted for single-dimension scalar signals typical of GPS lat/lng.
 */

export class KalmanFilter {
  /**
   * @param {object} opts
   * @param {number} opts.Q  Process noise covariance (default 3).
   *                          Higher = trusts measurements more, tracks fast changes.
   *                          Lower  = smoother output, slower to react.
   * @param {number} opts.R  Default measurement noise covariance (default 10).
   *                          Overridden per-call when GPS accuracy is available.
   * @param {number} opts.minR  Floor for R to prevent over-trusting a single good fix (default 1).
   */
  constructor({ Q = 3, R = 10, minR = 1 } = {}) {
    this._defaultQ = Q;
    this._defaultR = R;
    this._minR = minR;
    this.reset();
  }

  /** Clear all state — use when tracking restarts. */
  reset() {
    this._x = null;  // estimated state (coordinate)
    this._p = null;  // estimate covariance
    this._q = this._defaultQ;
  }

  /**
   * Dynamically adjust process noise based on speed.
   * Call this before filter() when speed information is available.
   *
   * @param {number} speedKmh  Current speed in km/h.
   */
  setSpeed(speedKmh) {
    if (speedKmh > 80) {
      this._q = this._defaultQ * 6;   // highway driving: trust GPS heavily
    } else if (speedKmh > 20) {
      this._q = this._defaultQ * 3;   // city driving
    } else if (speedKmh > 4) {
      this._q = this._defaultQ * 1.5; // walking / jogging
    } else {
      this._q = this._defaultQ;       // stationary
    }
  }

  /**
   * Feed a new measurement into the filter.
   *
   * @param {number}  measurement  Raw GPS coordinate (lat or lng).
   * @param {number}  [accuracy]   GPS accuracy in metres.  Used to derive R.
   *                                Pass null/undefined to use the default R.
   * @returns {{ value: number, correction: number }}
   *   value      — the filtered (smoothed) coordinate
   *   correction — metres-equivalent of the correction applied (for metrics)
   */
  filter(measurement, accuracy) {
    // Derive R from accuracy.  accuracy² is a good proxy for measurement
    // variance because accuracy is already the 68 % confidence radius.
    const R = accuracy != null && Number.isFinite(accuracy) && accuracy > 0
      ? Math.max(accuracy * accuracy, this._minR)
      : this._defaultR;

    // --- Cold start: initialise from first measurement ---
    if (this._x === null) {
      this._x = measurement;
      this._p = R;
      return { value: measurement, correction: 0 };
    }

    // --- Predict step ---
    // State prediction is identity (we assume constant position between updates).
    // Covariance grows by Q.
    this._p += this._q;

    // --- Update step ---
    const K = this._p / (this._p + R);       // Kalman gain
    const innovation = measurement - this._x; // measurement residual
    this._x += K * innovation;                // updated state
    this._p *= (1 - K);                       // updated covariance

    // correction in the same unit as measurement (degrees).
    // For display purposes the caller can convert to metres if needed.
    const correction = Math.abs(K * innovation);

    return { value: this._x, correction };
  }

  /**
   * Return the current predicted state without incorporating a new measurement.
   * Useful for extrapolation between GPS fixes.
   *
   * @returns {number|null}  Predicted coordinate, or null if filter is cold.
   */
  predict() {
    return this._x;
  }

  /** @returns {boolean} Whether the filter has received at least one measurement. */
  get isWarm() {
    return this._x !== null;
  }
}

/**
 * Pre-configured pair of Kalman filters for GPS lat/lng smoothing.
 * Provides a convenient API that feeds both axes simultaneously.
 */
export class GPSKalmanFilter {
  /**
   * @param {object} [opts]  Passed through to each axis filter.
   */
  constructor(opts) {
    this.latFilter = new KalmanFilter(opts);
    this.lngFilter = new KalmanFilter(opts);
  }

  reset() {
    this.latFilter.reset();
    this.lngFilter.reset();
  }

  /**
   * Adjust process noise for both axes based on speed.
   * @param {number} speedKmh
   */
  setSpeed(speedKmh) {
    this.latFilter.setSpeed(speedKmh);
    this.lngFilter.setSpeed(speedKmh);
  }

  /**
   * Filter a raw GPS position.
   *
   * @param {number} lat       Raw latitude.
   * @param {number} lng       Raw longitude.
   * @param {number} [accuracy]  GPS accuracy in metres.
   * @returns {{ lat: number, lng: number, correctionM: number }}
   *   lat/lng       — smoothed coordinates
   *   correctionM   — approximate correction in metres (for metrics)
   */
  filter(lat, lng, accuracy) {
    const latResult = this.latFilter.filter(lat, accuracy);
    const lngResult = this.lngFilter.filter(lng, accuracy);

    // Convert degree-correction to approximate metres for display.
    // 1 degree latitude ≈ 111,320 m.  Longitude correction depends on latitude.
    const latCorrM = latResult.correction * 111320;
    const lngCorrM = lngResult.correction * 111320 * Math.cos((lat * Math.PI) / 180);
    const correctionM = Math.sqrt(latCorrM * latCorrM + lngCorrM * lngCorrM);

    return {
      lat: latResult.value,
      lng: lngResult.value,
      correctionM
    };
  }

  /** @returns {boolean} */
  get isWarm() {
    return this.latFilter.isWarm && this.lngFilter.isWarm;
  }
}
