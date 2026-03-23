/**
 * Standardized haptic feedback patterns.
 * Falls back silently on devices that don't support navigator.vibrate.
 */

const v = (pattern) => {
  try { navigator.vibrate?.(pattern); } catch (_) {}
};

export const haptics = {
  /** Quick, light tap — button presses, selections */
  tap:     () => v(10),

  /** Double tap — confirmations, toggle on */
  confirm: () => v([10, 40, 10]),

  /** Triple short — success, task complete */
  success: () => v([10, 30, 10, 30, 20]),

  /** Long + short — warnings, important alerts */
  warning: () => v([50, 80, 30]),

  /** Room-online notification */
  notify:  () => v([20, 60, 20]),

  /** SOS triggered — urgent, unmistakable */
  sos:     () => v([200, 100, 200, 100, 200]),

  /** SOS cancelled — relief pattern (long fade-out) */
  sosCancelled: () => v([80, 40, 40, 40, 20]),

  /** Error shake */
  error:   () => v([30, 20, 30, 20, 30]),
};
