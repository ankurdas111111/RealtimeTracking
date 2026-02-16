/**
 * Offline position buffer.
 *
 * When the socket is disconnected, positions are buffered here instead of
 * being dropped.  On reconnect, the buffer is drained and the positions
 * are replayed to the server as a batch.
 *
 * Buffer is capped to avoid unbounded memory growth during long outages.
 */

const MAX_BUFFER = 200;
const buffer = [];

/**
 * Add a position payload to the offline buffer.
 * Evicts the oldest entry when full.
 *
 * @param {object} pos  The same payload that would be sent to socket.emit('position', ...).
 */
export function bufferPosition(pos) {
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push(pos);
}

/**
 * Drain all buffered positions and return them.
 * Clears the buffer.
 *
 * @returns {object[]}  Array of position payloads (oldest first).
 */
export function drainBuffer() {
  return buffer.splice(0, buffer.length);
}

/**
 * @returns {boolean}  True if there are buffered positions.
 */
export function hasBuffered() {
  return buffer.length > 0;
}

/**
 * @returns {number}  Current buffer size.
 */
export function bufferSize() {
  return buffer.length;
}

/**
 * Clear the buffer without returning entries.
 */
export function clearBuffer() {
  buffer.length = 0;
}
