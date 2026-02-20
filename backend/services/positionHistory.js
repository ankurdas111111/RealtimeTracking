/**
 * Asynchronous position history recorder.
 *
 * Accumulates position updates from the hot path (via `record()`) in an
 * in-memory buffer, then batch-inserts them into PostgreSQL every 10 seconds.
 * This keeps the hot path (position ingestion → broadcast) completely
 * synchronous and allocation-free.
 *
 * Also runs a daily purge of records older than 7 days.
 */

var db = require("../lib/db");
var config = require("../config");

var log = config.log;

var FLUSH_INTERVAL_MS = 10000; // 10 seconds
var PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
var RETENTION_DAYS = 7;
var MAX_BUFFER_SIZE = 10000; // ~5 min at 100 users × 2Hz; drop oldest on overflow

var _buffer = [];
var _flushTimer = null;
var _purgeTimer = null;

/**
 * Record a position for async persistence.
 * This is called from the hot path and must be non-blocking.
 *
 * @param {string} userId
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [speed]
 * @param {number} [accuracy]
 */
function record(userId, latitude, longitude, speed, accuracy) {
    if (_buffer.length >= MAX_BUFFER_SIZE) {
        _buffer.shift(); // drop oldest entry to bound memory usage
    }
    _buffer.push({ userId: userId, latitude: latitude, longitude: longitude, speed: speed, accuracy: accuracy });
}

/**
 * Flush the buffer to the database.
 */
async function flush() {
    if (_buffer.length === 0) return;
    // Swap is safe: record() is synchronous and flush() is called from setInterval,
    // both run on the same event-loop turn boundary in single-threaded Node.js.
    var batch = _buffer;
    _buffer = [];
    try {
        await db.insertPositionHistory(batch);
    } catch (err) {
        log.error({ err: err.message, batchSize: batch.length }, "Failed to insert position history batch");
    }
}

/**
 * Purge old records.
 */
async function purge() {
    try {
        await db.purgePositionHistory(RETENTION_DAYS);
        log.info({ retentionDays: RETENTION_DAYS }, "Position history purge completed");
    } catch (err) {
        log.error({ err: err.message }, "Failed to purge position history");
    }
}

/**
 * Start the background flush and purge timers.
 */
function start() {
    if (_flushTimer) return;
    _flushTimer = setInterval(function () { flush(); }, FLUSH_INTERVAL_MS);
    _purgeTimer = setInterval(function () { purge(); }, PURGE_INTERVAL_MS);
    // Run initial purge after a short delay
    setTimeout(function () { purge(); }, 30000);
}

/**
 * Stop timers and flush any remaining buffer.
 */
async function stop() {
    if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
    if (_purgeTimer) { clearInterval(_purgeTimer); _purgeTimer = null; }
    await flush();
}

module.exports = {
    record: record,
    flush: flush,
    start: start,
    stop: stop
};
