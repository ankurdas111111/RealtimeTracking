/**
 * Returns a debounced version of `fn` that delays invocation by `delay` ms.
 * The leading call fires immediately; subsequent calls within the window are
 * coalesced and fire once after the last call.
 *
 * @param {Function} fn
 * @param {number} delay ms
 * @returns {Function}
 */
export function debounce(fn, delay = 100) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  };
}
